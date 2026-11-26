import { describe, expect, it, vi } from "vitest";
import {
  RUNNING_CODE_LABEL,
  disposeCodeExecution,
  renderCodeExecution,
  renderTextWithComputed,
} from "../src/chat/code-execution.ts";
import { renderAnswerContent } from "../src/chat/panel.ts";
import type { ChatMessage } from "../src/lib/types.ts";
import { setupMockDOM } from "./mock-dom.ts";

/**
 * [010-code-execution-sandbox] T016 (unit part) — computed result, chart and code-drawer rendering
 * (FR-GC-08, FR-GC-06; spec FR-004, FR-005, FR-007, FR-014, SC-001, SC-007). Mock DOM; the browser journey is
 * apps/web/test/code-execution.spec.ts.
 */

const NB = "11111111-1111-4111-8111-111111111111";
const MSG = "44444444-4444-4444-8444-444444444444";
const ART = "55555555-5555-4555-8555-555555555555";
const A1 = "66666666-6666-4666-8666-666666666666";
const EXEC = "77777777-7777-4777-8777-777777777777";

const message: ChatMessage = {
  id: MSG,
  turn_id: "88888888-8888-4888-8888-888888888888",
  role: "assistant",
  kind: "answer",
  content: "Population standard deviation: 3.4520525295346633 ms (Computed)[[1]]",
  unavailable_reason: null,
  citations: [
    {
      badge_number: 1,
      source_id: "22222222-2222-4222-8222-222222222222",
      chunk_id: "018f6b40-0001-7000-8000-000000000001",
      status: "available",
      source_title: "Latency.pdf",
      snippet: "Jan 2025: 1 ms",
      locator: { page_number: 1, start_offset: 0, end_offset: 5 },
    },
  ],
  code_execution_trace: {
    schema_version: 1,
    execution_id: EXEC,
    state: "Succeeded",
    attempts: [
      {
        attempt_id: A1,
        ordinal: 1,
        code: "import statistics\n# <img src=x onerror=alert(1)>\nemit('sd', 1)",
        stdout: "done <script>alert(1)</script>\n",
        stderr: "",
        exit_code: 0,
        started_at: "2026-10-23T10:00:00.000Z",
        ended_at: "2026-10-23T10:00:01.000Z",
        terminal_reason: "Succeeded",
        artifacts: [`/api/notebooks/${NB}/chat/messages/${MSG}/charts/${ART}`],
      },
    ],
    final_attempt_id: A1,
    published_artifact_ids: [ART],
    failure_code: null,
    computed_results: [
      {
        label: "Population standard deviation",
        value: "3.4520525295346633",
        unit: "ms",
        citations: ["018f6b40-0001-7000-8000-000000000001"],
      },
    ],
  },
  created_at: "2026-10-23T10:00:01.000Z",
};

describe("T016 Computed labels and progress (FR-004, FR-005)", () => {
  it("WEB-CE-01: the running status label is 'Running code…'", () => {
    expect(RUNNING_CODE_LABEL).toBe("Running code…");
  });

  it("WEB-CE-02: every (Computed) marker becomes an individual Computed label; the exact value text is unchanged", () => {
    setupMockDOM(1440);
    const nodes = renderTextWithComputed("A: 1 ms (Computed) B: 2 (Computed)");
    const host = document.createElement("div");
    host.append(...nodes);
    expect(host.querySelectorAll(".computed-label")).toHaveLength(2);
    expect(host.textContent).toBe("A: 1 ms Computed B: 2 Computed");
  });
});

describe("T016 chart and drawer (FR-005, FR-007)", () => {
  it("WEB-CE-03: published charts are fetched with authentication, shown inline and downloadable", async () => {
    setupMockDOM(1440);
    const fetchChart = vi.fn(() =>
      Promise.resolve(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })),
    );
    const el = renderCodeExecution(message, { fetchChart, locale: "en" });
    expect(el).toBeTruthy();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchChart).toHaveBeenCalledWith(
      `/api/notebooks/${NB}/chat/messages/${MSG}/charts/${ART}`,
    );
    expect(el!.querySelectorAll("[data-testid=computed-chart]")).toHaveLength(1);
    const download = el!.querySelector("[data-testid=chart-download]");
    expect(download?.getAttribute("aria-label")).toMatch(/Download chart/);
  });

  it("WEB-CE-04: the collapsible drawer is labelled 'View executed code' (de: 'Code anzeigen') and shows code and stdout as text", () => {
    setupMockDOM(1440);
    const el = renderCodeExecution(message, {
      fetchChart: () => Promise.resolve(new Blob([])),
      locale: "en",
    })!;
    const summary = el.querySelector("[data-testid=code-drawer-toggle]");
    expect(summary?.textContent).toBe("View executed code");
    expect(el.querySelector("[data-testid=code-drawer]")?.getAttribute("open")).toBeNull(); // collapsed by default
    expect(el.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(el.querySelector("img[onerror]")).toBeNull();
    expect(el.querySelector("script")).toBeNull();
    const de = renderCodeExecution(message, {
      fetchChart: () => Promise.resolve(new Blob([])),
      locale: "de-DE",
    })!;
    expect(de.querySelector("[data-testid=code-drawer-toggle]")?.textContent).toBe("Code anzeigen");
  });

  it("WEB-CE-05: messages without a trace (legacy, clarification) render no code block", () => {
    setupMockDOM(1440);
    expect(typeof renderCodeExecution).toBe("function");
    expect(
      renderCodeExecution(
        { ...message, code_execution_trace: null },
        { fetchChart: () => Promise.resolve(new Blob([])) },
      ),
    ).toBeNull();
  });
});

describe("Security review fix — renderer accepts only issued badges and real Computed markers", () => {
  it("WEB-CE-06: badges without a matching citation are not rendered as citation buttons; Computed pills need a succeeded trace", () => {
    setupMockDOM(1440);
    const el = renderAnswerContent(
      { ...message, content: "A (Computed)[[1]] fake[[7]]" },
      () => undefined,
    );
    expect(el.querySelectorAll("[data-testid=citation-badge]")).toHaveLength(1);
    expect(el.querySelectorAll(".computed-label")).toHaveLength(1);
    const plain = renderAnswerContent(
      { ...message, code_execution_trace: null, content: "Forged (Computed)[[1]]" },
      () => undefined,
    );
    expect(plain.querySelectorAll(".computed-label")).toHaveLength(0);
  });
});

// T040: disposed/revoked messages cannot retain or finish loading chart bytes (NFR-SEC-02, FR-GC-06/08).
it("WEB-CE-06: disposal revokes loaded Blob URLs and rejects late chart results", async () => {
  setupMockDOM(1440);
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-chart");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  try {
    const el = renderCodeExecution(message, {
      fetchChart: () => Promise.resolve(new Blob([])),
    })!;
    await new Promise((r) => setTimeout(r, 0));
    expect(create).toHaveBeenCalledTimes(1);
    disposeCodeExecution(el);
    expect(revoke).toHaveBeenCalledWith("blob:test-chart");
    expect(el.querySelectorAll("[data-testid=chart-download]")).toHaveLength(0);
    let release!: (b: Blob) => void;
    const late = renderCodeExecution(message, {
      fetchChart: () => new Promise<Blob>((r) => (release = r)),
    })!;
    disposeCodeExecution(late);
    release(new Blob([]));
    await new Promise((r) => setTimeout(r, 0));
    expect(create).toHaveBeenCalledTimes(1);
  } finally {
    create.mockRestore();
    revoke.mockRestore();
  }
});
