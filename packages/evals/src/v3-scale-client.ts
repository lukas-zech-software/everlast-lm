/** NFR-PERF-01, D13: ordinary SSE final receipt, never progress/model-token timing. */
export interface FinalReceipt {
  terminal_status: "answer" | "refusal" | "replayed" | "error" | "missing";
  client_first_validated_answer_ms: number | null;
  latency_ms: number | null;
  answer: string;
  cited_chunk_ids: string[];
}
function emptyFinalReceipt(terminal_status: FinalReceipt["terminal_status"]): FinalReceipt {
  return {
    terminal_status,
    client_first_validated_answer_ms: null,
    latency_ms: null,
    answer: "",
    cited_chunk_ids: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseFinalPayload(payload: unknown, submitted: number, received: number): FinalReceipt {
  if (!isRecord(payload)) {
    throw new Error("Malformed final");
  }
  if (payload.replayed === true) {
    return emptyFinalReceipt("replayed");
  }
  if (payload.replayed !== false || !Array.isArray(payload.messages)) {
    throw new Error("Malformed final");
  }
  const rawMessages: unknown[] = payload.messages;
  const assistantMessages = rawMessages.filter(
    (m): m is Record<string, unknown> => isRecord(m) && m.role === "assistant",
  );
  if (assistantMessages.length !== 1) {
    return emptyFinalReceipt("missing");
  }
  const message = assistantMessages[0];
  if (!message) {
    return emptyFinalReceipt("missing");
  }
  if (message.kind !== "answer") {
    return emptyFinalReceipt("refusal");
  }
  if (
    Boolean(message.code_execution_trace) ||
    typeof message.content !== "string" ||
    !message.content.trim() ||
    Boolean(message.unavailable_reason) ||
    !Array.isArray(message.citations) ||
    message.citations.length === 0
  ) {
    return emptyFinalReceipt("missing");
  }
  const rawCitations: unknown[] = message.citations;
  const citedChunkIds: string[] = [];
  for (const citation of rawCitations) {
    const chunkId = isRecord(citation) ? citation.chunk_id : undefined;
    if (typeof chunkId !== "string") {
      throw new Error("Invalid final receipt");
    }
    citedChunkIds.push(chunkId);
  }
  if (!Number.isFinite(submitted) || !Number.isFinite(received) || received < submitted) {
    throw new Error("Invalid final receipt");
  }
  return {
    terminal_status: "answer",
    client_first_validated_answer_ms: received,
    latency_ms: received - submitted,
    answer: message.content,
    cited_chunk_ids: citedChunkIds,
  };
}

function processSseBlock(
  block: string,
  submitted: number,
  clock: () => number,
): FinalReceipt | null {
  const lines = block.split("\n");
  const event = lines
    .find((l) => l.startsWith("event:"))
    ?.slice(6)
    .trim();
  if (event === "error") {
    return emptyFinalReceipt("error");
  }
  if (event !== "final") {
    return null;
  }
  const received = clock();
  const payload: unknown = JSON.parse(
    lines
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n"),
  );
  return parseFinalPayload(payload, submitted, received);
}

export async function collectFreshFinal(
  response: Response,
  submitted: number,
  clock: () => number = () => performance.now(),
  options: { timeoutMs?: number } = {},
): Promise<FinalReceipt> {
  if (
    !response.ok ||
    !response.headers.get("content-type")?.startsWith("text/event-stream") ||
    !response.body
  ) {
    return emptyFinalReceipt("error");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let bytes = 0;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Invalid transport timeout");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error("Benchmark SSE timeout"));
      void reader.cancel().catch(() => undefined);
    }, timeoutMs);
  });
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) {
        break;
      }
      bytes += value.byteLength;
      if (bytes > 2000000) {
        throw new Error("Benchmark SSE exceeds transport limit");
      }
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const receipt = processSseBlock(block, submitted, clock);
        if (receipt !== null) {
          return receipt;
        }
      }
    }
    decoder.decode();
    return emptyFinalReceipt("missing");
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
