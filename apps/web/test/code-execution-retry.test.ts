import { describe, expect, it, vi } from "vitest";
import { renderCodeExecution } from "../src/chat/code-execution.ts";
import type { ChatMessage, CodeExecutionTrace } from "../src/lib/types.ts";
import { setupMockDOM } from "./mock-dom.ts";

/**
 * [010-code-execution-sandbox] T027 — retry/error drawer (FR-GC-08; spec FR-005, FR-006, FR-007, SC-004, SC-007).
 * Both attempts in order with final/published markers; transparent terminal errors without guessed numbers or
 * failed-attempt downloads. Mock DOM.
 */

const NB = "11111111-1111-4111-8111-111111111111";
const MSG = "44444444-4444-4444-8444-444444444444";
const A1 = "66666666-6666-4666-8666-666666666661";
const A2 = "66666666-6666-4666-8666-666666666662";
const ART = "55555555-5555-4555-8555-555555555555";
const url = (a: string) => `/api/notebooks/${NB}/chat/messages/${MSG}/charts/${a}`;

type TraceAttempt = CodeExecutionTrace["attempts"][number];
type FailureCase = readonly [
  CodeExecutionTrace["state"],
  NonNullable<CodeExecutionTrace["failure_code"]>,
  string,
];

const attempt = (id: string, ordinal: 1 | 2, extra: Partial<TraceAttempt>): TraceAttempt => ({
  attempt_id: id,
  ordinal,
  code: `# attempt ${ordinal}`,
  stdout: "",
  stderr: "",
  exit_code: 0,
  started_at: "2026-10-23T10:00:00.000Z",
  ended_at: "2026-10-23T10:00:01.000Z",
  terminal_reason: "Succeeded",
  artifacts: [],
  ...extra,
});

const base = {
  id: MSG,
  turn_id: "t",
  role: "assistant" as const,
  unavailable_reason: null,
  citations: [],
  created_at: "2026-10-23T10:00:01.000Z",
};

describe("T027 retry drawer and terminal errors", () => {
  it("WEB-RTY-01: after a correction both attempts appear in order; only the final one is marked final and published", () => {
    setupMockDOM(1440);
    const message: ChatMessage = {
      ...base,
      kind: "answer",
      content: "sd: 1 ms (Computed)",
      code_execution_trace: {
        schema_version: 1,
        execution_id: "77777777-7777-4777-8777-777777777777",
        state: "Succeeded",
        attempts: [
          attempt(A1, 1, {
            exit_code: 1,
            stderr: "ZeroDivisionError: division by zero",
            terminal_reason: "PythonException",
          }),
          attempt(A2, 2, { artifacts: [url(ART)] }),
        ],
        final_attempt_id: A2,
        published_artifact_ids: [ART],
        failure_code: null,
        computed_results: [
          {
            label: "sd",
            value: "1",
            unit: "ms",
            citations: ["018f6b40-0001-7000-8000-000000000001"],
          },
        ],
      },
    };
    const fetchChart = vi.fn(() => Promise.resolve(new Blob([], { type: "image/png" })));
    const el = renderCodeExecution(message, { fetchChart, locale: "en" })!;
    const attempts = [...el.querySelectorAll("[data-testid=code-attempt]")];
    expect(attempts.map((a) => a.getAttribute("data-ordinal"))).toEqual(["1", "2"]);
    expect(attempts.map((a) => a.getAttribute("data-final"))).toEqual(["false", "true"]);
    expect(attempts[0]!.textContent).toContain("ZeroDivisionError");
    expect(attempts[0]!.textContent).toContain("not published");
    expect(attempts[1]!.textContent).toContain("Final attempt");
    expect(attempts[1]!.querySelector("[data-testid=code-published]")).toBeTruthy();
    expect(fetchChart).toHaveBeenCalledTimes(1);
    expect(fetchChart).toHaveBeenCalledWith(url(ART));
  });

  const failureCases: FailureCase[] = [
    [
      "TimedOut",
      "ExecutionTimeout",
      "The calculation could not be completed, so no computed result is shown. The code ran longer than the 15 seconds allowed and was stopped.",
    ],
    [
      "Failed",
      "MemoryLimitExceeded",
      "The calculation could not be completed, so no computed result is shown. The code exceeded the sandbox memory limit and was stopped.",
    ],
    [
      "Failed",
      "PythonException",
      "The calculation could not be completed, so no computed result is shown. The generated code failed with an error, also after one automatic correction attempt.",
    ],
  ];

  it.each(failureCases)(
    "WEB-RTY-02 (%s/%s): a terminal error shows the drawer but no chart, download or Computed label",
    (state, failure, content) => {
      setupMockDOM(1440);
      const attempts: TraceAttempt[] =
        failure === "PythonException"
          ? [
              attempt(A1, 1, { exit_code: 1, terminal_reason: "PythonException", artifacts: [] }),
              attempt(A2, 2, { exit_code: 1, terminal_reason: "PythonException", artifacts: [] }),
            ]
          : [attempt(A1, 1, { exit_code: null, terminal_reason: failure, artifacts: [] })];
      const message: ChatMessage = {
        ...base,
        kind: "refusal",
        content,
        code_execution_trace: {
          schema_version: 1,
          execution_id: "77777777-7777-4777-8777-777777777777",
          state,
          attempts,
          final_attempt_id: attempts.at(-1)!.attempt_id,
          published_artifact_ids: [],
          failure_code: failure,
          computed_results: [],
        },
      };
      const fetchChart = vi.fn(() => Promise.resolve(new Blob([])));
      const el = renderCodeExecution(message, { fetchChart, locale: "en" })!;
      expect(fetchChart).not.toHaveBeenCalled();
      expect(el.querySelectorAll("[data-testid=chart-download]")).toHaveLength(0);
      expect(el.querySelectorAll("[data-testid=code-attempt]")).toHaveLength(attempts.length);
      expect(el.querySelectorAll("[data-testid=code-published]")).toHaveLength(0);
      expect(el.textContent).not.toMatch(/\d+\.\d+/);
      if (failure !== "PythonException") {
        expect(el.textContent).toContain("Exit code: none");
      }
    },
  );

  it("WEB-RTY-03: stderr and code containing markup stay text", () => {
    setupMockDOM(1440);
    const message: ChatMessage = {
      ...base,
      kind: "refusal",
      content: "x",
      code_execution_trace: {
        schema_version: 1,
        execution_id: "77777777-7777-4777-8777-777777777777",
        state: "Failed",
        attempts: [
          attempt(A1, 1, {
            exit_code: 1,
            code: "<script>alert(1)</script>",
            stderr: "<img src=x onerror=alert(2)>",
            terminal_reason: "PythonException",
          }),
        ],
        final_attempt_id: A1,
        published_artifact_ids: [],
        failure_code: "PythonException",
        computed_results: [],
      },
    };
    const el = renderCodeExecution(message, {
      fetchChart: () => Promise.resolve(new Blob([])),
      locale: "en",
    })!;
    expect(el.querySelector("script")).toBeNull();
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toContain("<img src=x onerror=alert(2)>");
  });
});
