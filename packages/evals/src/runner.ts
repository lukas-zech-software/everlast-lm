import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnifiedDocumentChunkSchema, isAppError } from "@everlast/contracts";
import {
  acceptReceivedSource,
  clearThread,
  createNotebook,
  getSourceById,
  reserveSources,
  type Pool,
} from "@everlast/db";
import { LocalObjectStorage, type Embedder, type OcrEngine } from "@everlast/cloud";
import { ChatService, type TurnObservation } from "@everlast/api/chat/service";
import type { GroundedModel } from "@everlast/api/chat/model";
import { stripBadges } from "@everlast/api/chat/verifier";
import { processIngestJob } from "@everlast/worker/ingestion/pipeline";
import { buildPdf, wrapLines } from "@everlast/testkit/pdf-builder";
import { buildCorpus, type CorpusDocument } from "./corpus.ts";
import type { GoldenCaseV1 } from "./dataset.ts";
import type { Judge, JudgeAttempt } from "./judge.ts";
import type { ResponseLength, ResponseLengthRunner } from "./response-length.ts";
import { containsForbidden, judgeMetric, ratio, type MetricResult } from "./metrics.ts";

/**
 * Gate v1.0 evaluation runner (NFR-EVAL-01..04). Every case runs through the production chat pipeline
 * (C-02 snapshot capture, hybrid retrieval, provenance-filtered history, model, D13 verifier, fenced
 * publication). Metrics are computed from observed retrieval logs, prompt inputs and published responses —
 * nothing is assumed or hardcoded. Judged metrics are UNAVAILABLE without a judge, never passed.
 */

export interface EvalEnvironment {
  pool: Pool;
  embedder: Embedder;
  model: GroundedModel;
  ocr: OcrEngine;
  judge: Judge | null;
  concurrency?: number;
  log?: (line: string) => void;
}

export interface UploadEvidence {
  documents: Array<{
    key: string;
    title: string;
    media_type: string;
    status: string;
    chunks: number;
    valid_chunks: number;
    failure?: string | null;
  }>;
  passed: boolean;
}

export interface CaseResult {
  id: string;
  category: GoldenCaseV1["category"];
  question: string;
  kind: "answer" | "refusal" | "error";
  response: string;
  citations: Array<{ badge_number: number; chunk_id: string; source_id: string }>;
  sentences: Array<{ text: string; kind: "claim" | "meta"; citations: string[] }>;
  turns: TurnObservation[];
  leakage: { retrieved: number; prompt: number; response: number; details: string[] };
  invalid_citations: number;
  /** Judge findings for diagnosis (filled by the judged suite). */
  judged?: {
    unsupported_statements: Array<{ turn: number; text: string; reason: string }>;
    unsupported_citations: Array<{ turn: number; sentence: string; chunk: string }>;
    rejection?: { refused: boolean; leaked_answer: boolean };
  };
  error?: string;
}

export interface NotebookContext {
  pool: Pool;
  notebookId: string;
  ownerId: string;
  sources: Map<string, string>;
  chat: ChatService;
  observations: TurnObservation[];
}

function corpusText(doc: CorpusDocument): string {
  return doc.pages.join("\n\n");
}

function requireSourceId(sources: Map<string, string>, key: string): string {
  const id = sources.get(key);
  if (id === undefined) {
    throw new Error(`Missing source ID for corpus key: ${key}`);
  }
  return id;
}

function requireDoc(docs: Map<string, CorpusDocument>, key: string): CorpusDocument {
  const doc = docs.get(key);
  if (!doc) {
    throw new Error(`Missing corpus document: ${key}`);
  }
  return doc;
}

async function ingestCorpus(
  env: EvalEnvironment,
  storage: LocalObjectStorage,
  ownerId: string,
  notebookId: string,
  corpus: CorpusDocument[],
) {
  const sources = new Map<string, string>();
  const evidence: UploadEvidence["documents"] = [];
  for (const doc of corpus) {
    const bytes =
      doc.mediaType === "application/pdf"
        ? buildPdf(doc.pages.map((page) => ({ kind: "text" as const, lines: wrapLines(page) })))
        : Buffer.from(corpusText(doc), "utf8");
    const attemptId = randomUUID();
    const [admitted] = await reserveSources(env.pool, ownerId, notebookId, [
      {
        attempt_id: attemptId,
        title: doc.title,
        media_type: doc.mediaType,
        declared_bytes: bytes.length,
      },
    ]);
    const source = admitted?.source;
    if (!source) {
      throw new Error(`Failed to reserve corpus source: ${doc.title}`);
    }
    const objectName = `notebooks/${notebookId}/sources/${source.id}/raw`;
    const written = await storage.write(objectName, bytes, doc.mediaType);
    await acceptReceivedSource(env.pool, {
      sourceId: source.id,
      attemptId,
      actualBytes: written.size,
      objectName,
      objectGeneration: written.generation,
    });
    await processIngestJob(
      { pool: env.pool, storage, embedder: env.embedder, ocr: env.ocr },
      { source_id: source.id, attempt_id: attemptId },
    );
    const record = await getSourceById(env.pool, source.id);
    const rows = await env.pool.query(
      "SELECT chunk_id, source_id, revision, locator, token_count, text FROM chunks WHERE source_id = $1",
      [source.id],
    );
    const valid = rows.rows.filter((r) => UnifiedDocumentChunkSchema.safeParse(r).success).length;
    evidence.push({
      key: doc.key,
      title: doc.title,
      media_type: doc.mediaType,
      status: record?.status ?? "missing",
      chunks: rows.rows.length,
      valid_chunks: valid,
      failure: record?.failure_message ?? null,
    });
    sources.set(doc.key, source.id);
  }
  return { sources, evidence };
}

async function runTurn(ctx: NotebookContext, question: string, activeKeys: string[]) {
  const ids = activeKeys.map((k) => requireSourceId(ctx.sources, k));
  const iterator = ctx.chat.runTurn({
    ownerId: ctx.ownerId,
    notebookId: ctx.notebookId,
    message: question,
    activeSourceIds: ids,
    requestId: randomUUID(),
  });
  let final = null;
  for await (const event of iterator) {
    if (event.type === "final") {
      final = event;
    }
  }
  return final;
}

function recordCaseLeakage(
  base: CaseResult,
  testCase: GoldenCaseV1,
  active: Set<string>,
  observation: TurnObservation,
): void {
  // NFR-EVAL-04: deselected-source content in the retrieval log, the prompt (chunks + history) or the response.
  for (const chunk of observation.retrieved) {
    if (!active.has(chunk.source_id)) {
      base.leakage.retrieved++;
      base.leakage.details.push(`retrieved chunk ${chunk.chunk_id} from inactive source`);
    }
  }
  for (const chunk of observation.modelInput?.chunks ?? []) {
    if (!active.has(chunk.source_id)) {
      base.leakage.prompt++;
      base.leakage.details.push(`prompt chunk ${chunk.chunk_id} from inactive source`);
    }
  }
  if (testCase.category !== "deselected_source" && testCase.category !== "history_carryover") {
    return;
  }
  const promptText = JSON.stringify({
    chunks: observation.modelInput?.chunks ?? [],
    history: observation.modelInput?.history ?? [],
  });
  for (const forbidden of testCase.forbidden) {
    if (containsForbidden(promptText, forbidden)) {
      base.leakage.prompt++;
      base.leakage.details.push(`prompt contains deselected fact "${forbidden}"`);
    }
    if (containsForbidden(base.response, forbidden)) {
      base.leakage.response++;
      base.leakage.details.push(`response contains deselected fact "${forbidden}"`);
    }
  }
}

function countInvalidTurnCitations(turns: readonly TurnObservation[]): number {
  let invalid = 0;
  for (const turn of turns) {
    if (turn.result.kind !== "answer") {
      continue;
    }
    const retrieved = new Map(turn.retrieved.map((r) => [r.chunk_id, r]));
    const snapshot = new Set(turn.snapshot.map((p) => p.source_id));
    for (const citation of turn.result.citations) {
      const hit = retrieved.get(citation.chunk_id);
      if (hit?.source_id !== citation.source_id || !snapshot.has(citation.source_id)) {
        invalid++;
      }
    }
  }
  return invalid;
}

export async function runCase(ctx: NotebookContext, c: GoldenCaseV1): Promise<CaseResult> {
  // Each case starts from an empty thread so history only comes from the case's own turns.
  await clearThread(ctx.pool, ctx.ownerId, ctx.notebookId);
  ctx.observations.length = 0;
  const active = new Set(c.active.map((k) => requireSourceId(ctx.sources, k)));
  const base: CaseResult = {
    id: c.id,
    category: c.category,
    question: c.question,
    kind: "error",
    response: "",
    citations: [],
    sentences: [],
    turns: [],
    leakage: { retrieved: 0, prompt: 0, response: 0, details: [] },
    invalid_citations: 0,
  };
  try {
    for (const h of c.history) {
      await runTurn(ctx, h.question, h.active);
    }
    const final = await runTurn(ctx, c.question, c.active);
    const answer = final?.messages.find((m) => m.role === "assistant");
    const observation = ctx.observations.at(-1);
    if (!observation) {
      throw new Error(`No turn observation captured for case ${c.id}`);
    }
    base.turns = [...ctx.observations];
    base.kind = answer?.kind === "answer" ? "answer" : "refusal";
    base.response = stripBadges(answer?.content ?? "");
    base.citations = (answer?.citations ?? []).map((x) => ({
      badge_number: x.badge_number,
      chunk_id: x.chunk_id,
      source_id: x.source_id,
    }));
    base.sentences =
      observation.result.kind === "answer" && observation.draft ? observation.draft.sentences : [];

    recordCaseLeakage(base, c, active, observation);
    // NFR-EVAL-02 (deterministic): each published badge must resolve to a retrieved chunk of an active source.
    base.invalid_citations = countInvalidTurnCitations(base.turns);
  } catch (err) {
    base.kind = "error";
    base.error = isAppError(err) ? `${err.code}: ${err.message}` : (err as Error).message;
  }
  return base;
}

export interface EvalRunResult {
  upload: UploadEvidence;
  cases: CaseResult[];
  metrics: MetricResult[];
  judged: boolean;
  judge_attempts?: readonly JudgeAttempt[];
  errored: string[];
}

export async function runEvaluation(
  env: EvalEnvironment,
  cases: GoldenCaseV1[],
): Promise<EvalRunResult> {
  const log = env.log ?? (() => undefined);
  const judgeAttemptOffset = env.judge?.attempts?.length ?? 0;
  const corpus = buildCorpus();
  const docsByKey = new Map(corpus.map((d) => [d.key, d]));
  const dir = await mkdtemp(join(tmpdir(), "everlast-eval-"));
  const storage = new LocalObjectStorage({ root: dir, publicBaseUrl: "http://localhost" });
  const { rows } = await env.pool.query<{ id: string }>(
    "INSERT INTO users (id, issuer, subject) VALUES ($1, 'https://eval.everlast.local', $2) RETURNING id",
    [randomUUID(), `eval-${randomUUID()}`],
  );
  const ownerRow = rows[0];
  if (!ownerRow) {
    throw new Error("Failed to insert eval owner");
  }
  const ownerId = ownerRow.id;
  const lanes = Math.max(1, Math.min(env.concurrency ?? 4, cases.length));
  const contexts: NotebookContext[] = [];
  let upload: UploadEvidence = { documents: [], passed: false };
  try {
    for (let lane = 0; lane < lanes; lane++) {
      const { notebook } = await createNotebook(env.pool, ownerId, {
        title: `Gate v1.0 eval lane ${lane + 1}`,
      });
      const { sources, evidence } = await ingestCorpus(env, storage, ownerId, notebook.id, corpus);
      if (lane === 0)
        upload = {
          documents: evidence,
          passed: evidence.every(
            (d) => d.status === "Ready" && d.chunks > 0 && d.valid_chunks === d.chunks,
          ),
        };
      log(
        `lane ${lane + 1}: corpus ingested (${evidence.map((d) => `${d.key}:${d.status}/${d.chunks}`).join(", ")})`,
      );
      const observations: TurnObservation[] = [];
      const chat = new ChatService({
        pool: env.pool,
        embedder: env.embedder,
        model: env.model,
        observer: (o) => observations.push(o),
      });
      contexts.push({
        pool: env.pool,
        notebookId: notebook.id,
        ownerId,
        sources,
        chat,
        observations,
      });
    }

    const results = new Array<CaseResult>(cases.length);
    let next = 0;
    let done = 0;
    await Promise.all(
      contexts.map(async (ctx) => {
        while (next < cases.length) {
          const index = next++;
          const testCase = cases[index];
          if (!testCase) {
            continue;
          }
          results[index] = await runCase(ctx, testCase);
          done++;
          if (done % 10 === 0 || done === cases.length) {
            log(`cases ${done}/${cases.length}`);
          }
        }
      }),
    );

    const metrics = await computeMetrics(env, cases, results, docsByKey);
    return {
      upload,
      cases: results,
      metrics,
      judged: env.judge !== null,
      ...(env.judge?.attempts
        ? { judge_attempts: env.judge.attempts.slice(judgeAttemptOffset) }
        : {}),
      errored: results.filter((r) => r.kind === "error" || r.error !== undefined).map((r) => r.id),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

interface JudgedCounters {
  statements: number;
  unsupported: number;
  hallucinating: Set<string>;
  supportPairs: number;
  supported: number;
  unsupportedCitations: Set<string>;
}

async function judgeTurnSupport(options: {
  turn: TurnObservation;
  sentences: NonNullable<TurnObservation["draft"]>["sentences"];
  turnIndex: number;
  result: CaseResult;
  judged: NonNullable<CaseResult["judged"]>;
  judge: Judge;
  counters: JudgedCounters;
}): Promise<void> {
  const { turn, sentences, turnIndex, result, judged, judge, counters } = options;
  const chunkText = new Map(turn.retrieved.map((x) => [x.chunk_id, x.text]));
  for (const [si, sentence] of sentences.entries()) {
    const context = sentences
      .slice(0, si)
      .map((x) => x.text)
      .join(" ");
    for (const id of new Set(sentence.citations)) {
      const text = chunkText.get(id);
      if (!text) {
        continue;
      }
      counters.supportPairs++;
      const entailed = await judge.judgeSupport({
        sentence: sentence.text,
        chunk: text,
        ...(context ? { context } : {}),
      });
      if (entailed) {
        counters.supported++;
      } else {
        counters.unsupportedCitations.add(result.id);
        judged.unsupported_citations.push({
          turn: turnIndex,
          sentence: sentence.text,
          chunk: text.slice(0, 600),
        });
      }
    }
  }
}

async function judgeCaseTurns(
  result: CaseResult,
  testCase: GoldenCaseV1,
  docs: Map<string, CorpusDocument>,
  judge: Judge,
  counters: JudgedCounters,
): Promise<void> {
  for (const [index, turn] of result.turns.entries()) {
    if (turn.result.kind !== "answer" || !turn.draft) {
      continue;
    }
    const historyEntry = testCase.history[index];
    // History turns ran with their own selection; the final turn with the case's selection.
    const keys = historyEntry ? historyEntry.active : testCase.active;
    const activeText = keys
      .map((k) => {
        const doc = requireDoc(docs, k);
        return `### ${doc.title}\n${corpusText(doc)}`;
      })
      .join("\n\n");
    const sentences = turn.draft.sentences;
    const question = historyEntry ? historyEntry.question : result.question;
    const verdicts = await judge.judgeClaims({
      question,
      activeSourcesText: activeText,
      sentences: sentences.map((s) => s.text),
    });
    result.judged ??= { unsupported_statements: [], unsupported_citations: [] };
    for (const v of verdicts.filter((x) => !x.supported)) {
      result.judged.unsupported_statements.push({
        turn: index,
        text: sentences[v.index]?.text ?? "",
        reason: v.reason,
      });
    }
    counters.statements += verdicts.length;
    const bad = verdicts.filter((v) => !v.supported).length;
    counters.unsupported += bad;
    if (bad > 0) {
      counters.hallucinating.add(result.id);
    }
    await judgeTurnSupport({
      turn,
      sentences,
      turnIndex: index,
      result,
      judged: result.judged,
      judge,
      counters,
    });
  }
}

async function computeMetrics(
  env: EvalEnvironment,
  cases: GoldenCaseV1[],
  results: CaseResult[],
  docs: Map<string, CorpusDocument>,
): Promise<MetricResult[]> {
  const metrics: MetricResult[] = [];
  const byId = new Map(cases.map((c) => [c.id, c]));

  // NFR-EVAL-02 deterministic: Precision_ID over every published badge.
  const totalBadges = results.reduce(
    (n, r) =>
      n +
      r.turns.reduce((m, t) => m + (t.result.kind === "answer" ? t.result.citations.length : 0), 0),
    0,
  );
  const invalid = results.reduce((n, r) => n + r.invalid_citations, 0);
  const precisionFailing = results.filter((r) => r.invalid_citations > 0).map((r) => r.id);
  metrics.push(
    totalBadges === 0
      ? judgeMetric("citation_precision", null, {
          failing_cases: [],
          unavailable: "no citation badges were produced (fails closed)",
        })
      : judgeMetric(
          "citation_precision",
          ratio(totalBadges - invalid, totalBadges, "Precision_ID"),
          {
            numerator: totalBadges - invalid,
            denominator: totalBadges,
            failing_cases: precisionFailing,
          },
        ),
  );

  // NFR-EVAL-04 deterministic: leakage count across retrieval log, prompt and response.
  const leakage = results.reduce(
    (n, r) => n + r.leakage.retrieved + r.leakage.prompt + r.leakage.response,
    0,
  );
  metrics.push(
    judgeMetric("scoping_leakage_count", leakage, {
      failing_cases: results
        .filter((r) => r.leakage.retrieved + r.leakage.prompt + r.leakage.response > 0)
        .map((r) => r.id),
    }),
  );

  if (!env.judge) {
    for (const name of [
      "hallucination_rate",
      "semantic_support_rate",
      "negative_rejection_rate",
    ] as const) {
      metrics.push(
        judgeMetric(name, null, {
          failing_cases: [],
          unavailable: "UNAVAILABLE: judged suite requires the Vertex AI enterprise endpoint",
        }),
      );
    }
    return metrics;
  }
  const judge = env.judge;

  // NFR-EVAL-01: unsupported statements / all statements in published answers, judged against ACTIVE sources.
  const counters: JudgedCounters = {
    statements: 0,
    unsupported: 0,
    hallucinating: new Set<string>(),
    supportPairs: 0,
    supported: 0,
    unsupportedCitations: new Set<string>(),
  };
  await mapLimit(results, 4, async (r) => {
    try {
      const testCase = byId.get(r.id);
      if (!testCase) {
        throw new Error(`Missing golden case definition for ${r.id}`);
      }
      await judgeCaseTurns(r, testCase, docs, judge, counters);
    } catch (error) {
      recordJudgeFailure(r, error);
    }
  });
  metrics.push(
    counters.statements === 0
      ? judgeMetric("hallucination_rate", null, {
          failing_cases: [],
          unavailable: "no answered statements to judge (fails closed)",
        })
      : judgeMetric(
          "hallucination_rate",
          ratio(counters.unsupported, counters.statements, "hallucination"),
          {
            numerator: counters.unsupported,
            denominator: counters.statements,
            failing_cases: [...counters.hallucinating],
          },
        ),
  );
  metrics.push(
    counters.supportPairs === 0
      ? judgeMetric("semantic_support_rate", null, {
          failing_cases: [],
          unavailable: "no citations to judge (fails closed)",
        })
      : judgeMetric(
          "semantic_support_rate",
          ratio(counters.supported, counters.supportPairs, "semantic support"),
          {
            numerator: counters.supported,
            denominator: counters.supportPairs,
            failing_cases: [...counters.unsupportedCitations],
          },
        ),
  );

  // NFR-EVAL-03: refused world-knowledge questions without leaking the answer.
  const negatives = results.filter((r) => r.category === "unanswerable");
  let rejected = 0;
  const notRejected: string[] = [];
  await mapLimit(negatives, 4, async (r) => {
    try {
      const c = byId.get(r.id);
      if (!c) {
        throw new Error(`Missing golden case definition for ${r.id}`);
      }
      if (r.kind !== "refusal") {
        notRejected.push(r.id);
        return;
      }
      if (c.forbidden.some((f) => containsForbidden(r.response, f))) {
        notRejected.push(r.id);
        return;
      }
      const verdict = await judge.judgeRejection({ question: r.question, response: r.response });
      r.judged = { unsupported_statements: [], unsupported_citations: [], rejection: verdict };
      if (verdict.refused && !verdict.leaked_answer) {
        rejected++;
      } else {
        notRejected.push(r.id);
      }
    } catch (error) {
      recordJudgeFailure(r, error);
      notRejected.push(r.id);
    }
  });
  metrics.push(
    negatives.length === 0
      ? judgeMetric("negative_rejection_rate", null, {
          failing_cases: [],
          unavailable: "no unanswerable cases (fails closed)",
        })
      : judgeMetric("negative_rejection_rate", ratio(rejected, negatives.length, "rejection"), {
          numerator: rejected,
          denominator: negatives.length,
          failing_cases: notRejected.sort(),
        }),
  );
  // A partial judged population cannot certify a metric. Keep cases and denominators in the report.
  const judgeFailures = results.filter((r) => r.error?.startsWith("Judge evaluation unavailable"));
  if (judgeFailures.length) {
    for (const metric of metrics) {
      if (
        ["hallucination_rate", "semantic_support_rate", "negative_rejection_rate"].includes(
          metric.name,
        )
      ) {
        metric.status = "unavailable";
        metric.passed = false;
        metric.detail =
          "Judge provider or verdict failure; original cases retained in errored_cases";
      }
    }
  }
  return metrics;
}

function recordJudgeFailure(result: CaseResult, error: unknown): void {
  const status =
    error !== null && typeof error === "object" && "status" in error ? error.status : undefined;
  result.error = `Judge evaluation unavailable${typeof status === "number" ? ` (HTTP ${status})` : " (invalid verdict or provider failure)"}`;
}

async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        if (item !== undefined) {
          await fn(item);
        }
      }
    }),
  );
}

/**
 * FR-GC-07 response-length runner for the judged release run: one notebook with the ingested corpus, each
 * answer from an empty thread through the production chat pipeline with the requested response length.
 */
export async function createResponseLengthRunner(
  env: EvalEnvironment,
): Promise<ResponseLengthRunner & { close: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "everlast-eval-length-"));
  const storage = new LocalObjectStorage({ root: dir, publicBaseUrl: "http://localhost" });
  const { rows } = await env.pool.query<{ id: string }>(
    "INSERT INTO users (id, issuer, subject) VALUES ($1, 'https://eval.everlast.local', $2) RETURNING id",
    [randomUUID(), `eval-length-${randomUUID()}`],
  );
  const ownerRow = rows[0];
  if (!ownerRow) {
    throw new Error("Failed to insert eval owner");
  }
  const ownerId = ownerRow.id;
  const { notebook } = await createNotebook(env.pool, ownerId, {
    title: "FR-GC-07 response length",
  });
  const { sources } = await ingestCorpus(env, storage, ownerId, notebook.id, buildCorpus());
  let length: ResponseLength = "default";
  const chat = new ChatService({
    pool: env.pool,
    embedder: env.embedder,
    model: env.model,
    resolvePreferences: () =>
      Promise.resolve({
        style: "default",
        response_length: length,
        input_language: "auto",
        output_language: "en-US",
      }),
  });
  const ctx: NotebookContext = {
    pool: env.pool,
    notebookId: notebook.id,
    ownerId,
    sources,
    chat,
    observations: [],
  };
  return {
    async answer(testCase, requested) {
      await clearThread(env.pool, ownerId, notebook.id);
      length = requested;
      const final = await runTurn(ctx, testCase.question, testCase.active);
      const answer = final?.messages.find((m) => m.role === "assistant");
      // A refusal (or no assistant answer) is `null`: excluded for Default, fail-closed for Shorter/Longer (FR-GC-07).
      return answer?.kind === "answer" ? stripBadges(answer.content ?? "") : null;
    },
    async close() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
