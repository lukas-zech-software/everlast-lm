import { h } from "../lib/dom.ts";
import type { ChatMessage, CodeExecutionTrace } from "../lib/types.ts";

/**
 * Computed results, charts and the executed-code drawer (FR-GC-08, FR-GC-06; specs/010 T022/T030).
 * All code, stdout and stderr are rendered as text nodes (never HTML). Charts are fetched with the caller's bearer
 * token from the authorized chart route and shown from a local blob URL; only published final-attempt charts are
 * ever requested. After a correction retry both attempts are listed in execution order, the final attempt and its
 * published outputs explicitly marked; failed-attempt outputs are never offered.
 */

export const RUNNING_CODE_LABEL = "Running code…";
const COMPUTED_MARKER = " (Computed)";

export interface CodeExecutionRenderOptions {
  fetchChart(url: string): Promise<Blob>;
  locale?: string | undefined;
}

/** Text with every " (Computed)" marker replaced by an individual "Computed" label (FR-005). */
export function renderTextWithComputed(text: string): Node[] {
  const nodes: Node[] = [];
  const parts = text.split(COMPUTED_MARKER);
  parts.forEach((part, index) => {
    if (part) nodes.push(document.createTextNode(part));
    if (index < parts.length - 1) {
      nodes.push(document.createTextNode(" "));
      nodes.push(h("span", { class: "computed-label", "data-testid": "computed-label", title: "Calculated by running code on your sources", text: "Computed" }));
    }
  });
  return nodes;
}

function drawerLabel(locale: string | undefined): string {
  return (locale ?? (typeof navigator !== "undefined" ? navigator.language : "en")).toLowerCase().startsWith("de") ? "Code anzeigen" : "View executed code";
}

const REASON: Record<string, string> = {
  Succeeded: "Succeeded",
  PythonException: "Failed with an error",
  ExecutionTimeout: "Stopped after 15 seconds",
  MemoryLimitExceeded: "Stopped: memory limit",
  TemporaryStorageLimit: "Stopped: file limit",
  SecurityViolation: "Blocked by sandbox policy",
  InvalidOutput: "Returned no valid result",
  CitationInvalid: "Referred to data outside the sources",
  ExecutionOutcomeUnknown: "Outcome unknown",
  ProviderUnavailable: "Sandbox unavailable",
  GenerationCancelled: "Cancelled",
  ScopeChanged: "Sources changed",
  AccessRevoked: "Access revoked",
};

function renderChart(url: string, index: number, options: CodeExecutionRenderOptions): HTMLElement {
  const figure = h("figure", { class: "computed-chart-figure" });
  const img = h("img", { class: "computed-chart", "data-testid": "computed-chart", alt: `Computed chart ${index + 1}` });
  const download = h("a", {
    class: "btn chart-download",
    "data-testid": "chart-download",
    role: "button",
    tabindex: 0,
    "aria-label": `Download chart ${index + 1}`,
    text: "Download",
  });
  figure.append(img, h("figcaption", {}, download));
  void options
    .fetchChart(url)
    .then((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      img.setAttribute("src", objectUrl);
      download.setAttribute("href", objectUrl);
      download.setAttribute("download", `chart-${index + 1}.${blob.type === "image/svg+xml" ? "svg" : "png"}`);
    })
    .catch(() => {
      figure.replaceChildren(h("em", { class: "muted", "data-testid": "chart-unavailable", text: "This chart is no longer available." }));
    });
  return figure;
}

/** Charts + drawer for a message with an execution trace; null for legacy/clarification messages. */
export function renderCodeExecution(message: ChatMessage, options: CodeExecutionRenderOptions): HTMLElement | null {
  const trace: CodeExecutionTrace | null | undefined = message.code_execution_trace;
  if (!trace || message.content === null) return null;
  const container = h("div", { class: "code-execution", "data-testid": "code-execution", "data-state": trace.state });
  const final = trace.attempts.find((a) => a.attempt_id === trace.final_attempt_id);
  if (trace.state === "Succeeded" && final) {
    const published = final.artifacts.filter((url) => trace.published_artifact_ids.some((id) => url.endsWith(`/charts/${id}`)));
    published.forEach((url, i) => container.append(renderChart(url, i, options)));
  }
  if (trace.attempts.length === 0) return container.childNodes.length > 0 ? container : null;
  const drawer = h("details", { class: "code-drawer", "data-testid": "code-drawer" });
  const summary = h("summary", { class: "code-drawer-toggle", "data-testid": "code-drawer-toggle", text: drawerLabel(options.locale) });
  drawer.append(summary);
  for (const attempt of trace.attempts) {
    const isFinal = attempt.attempt_id === trace.final_attempt_id;
    const heading = [`Attempt ${attempt.ordinal}`, isFinal ? "Final attempt" : null, REASON[attempt.terminal_reason ?? ""] ?? null].filter(Boolean).join(" · ");
    const section = h(
      "section",
      { class: `code-attempt${isFinal ? " final" : ""}`, "data-testid": "code-attempt", "data-ordinal": attempt.ordinal, "data-final": isFinal ? "true" : "false" },
      h("h4", { class: "code-attempt-title", text: heading }),
      isFinal && trace.state === "Succeeded"
        ? h("div", { class: "code-published", "data-testid": "code-published", text: `Published outputs: ${trace.computed_results.length} value(s), ${trace.published_artifact_ids.length} chart(s)` })
        : h("div", { class: "code-unpublished muted", "data-testid": "code-unpublished", text: "Outputs of this attempt were not published." }),
      h("pre", { class: "code-source", "data-testid": "code-source" }, h("code", { text: attempt.code })),
      h("div", { class: "code-label", text: "stdout" }),
      h("pre", { class: "code-stdout", "data-testid": "code-stdout", text: attempt.stdout || "(empty)" }),
      attempt.stderr ? h("div", { class: "code-label", text: "stderr" }) : null,
      attempt.stderr ? h("pre", { class: "code-stderr", "data-testid": "code-stderr", text: attempt.stderr }) : null,
      h("div", { class: "code-exit muted", text: `Exit code: ${attempt.exit_code === null ? "none (stopped or unknown)" : attempt.exit_code}` })
    );
    drawer.append(section);
  }
  container.append(drawer);
  return container;
}
