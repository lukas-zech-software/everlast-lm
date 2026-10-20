import { describe, expect, it } from "vitest";
import { validateReportPayload } from "@everlast/worker/studio/runner";

/**
 * [008-studio-text-reports] T042 — Gate v2.0 #3 (deterministic): all four standard templates run through the
 * runtime path (StudioJobRunner → ReportGeneratorPlugin → validateReportPayload) on the declared two-source
 * fixture (dated events + technical definitions, plus one unselected source for leakage). Every template must
 * reach Completed with every required section key, every factual sentence of a required section must end in a
 * `[n]` marker that resolves to a chunk of the captured snapshot, citation-ID precision 1.0, leakage 0 and
 * P95 ≤ 25.0 s. The report model is the deterministic TEST DOUBLE; the Vertex Flash release variant is
 * UNAVAILABLE unless Vertex is configured. Per Gate v2.0 #3, FR-ST-10, FR-017, SC-001, NFR-EVAL-02/04.
 */

const TEMPLATES = ["briefing_doc", "study_guide", "faq", "timeline"];

describe("Gate v2.0 #3 Studio reports (deterministic)", () => {
  it("all four templates complete with required sections, per-sentence citations in scope, precision 1.0, leakage 0", async () => {
    const { runStudioReportsGate } = await import("../src/studio-gate.ts");
    const result = await runStudioReportsGate();
    expect(result.cases.map((c) => c.subtype)).toEqual(TEMPLATES);
    for (const c of result.cases) {
      expect(c.status, c.subtype).toBe("Completed");
      expect(c.problem, c.subtype).toBeNull();
      expect(c.missing_sections, c.subtype).toEqual([]);
    }
    expect(result.validity_rate).toBe(1);
    expect(result.citation_precision).toBe(1);
    expect(result.leakage).toBe(0);
    expect(result.p95_ms).toBeLessThanOrEqual(25_000);
    expect(result.model).toMatch(/deterministic/);
    expect(result.passed).toBe(true);
  });

  it("validateReportPayload rejects a payload missing a required key or holding an uncited factual sentence", async () => {
    const { runStudioReportsGate } = await import("../src/studio-gate.ts");
    const result = await runStudioReportsGate();
    const briefing = result.cases.find((c) => c.subtype === "briefing_doc")!;
    const payload = briefing.payload!;
    const { chunks, snapshot } = result.fixture;
    expect(validateReportPayload(payload, chunks, snapshot, "briefing_doc")).toBeNull();

    const withoutQuotes = {
      ...payload,
      sections: payload.sections.filter((s) => s.key !== "quotes"),
      content_md: payload.content_md.slice(0, payload.content_md.indexOf("## Quotes")),
    };
    expect(validateReportPayload(withoutQuotes, chunks, snapshot, "briefing_doc")).toMatch(/quotes/);

    const uncited = { ...payload, content_md: payload.content_md.replace("## Key Takeaways\n\n", "## Key Takeaways\n\n- An unsupported claim without a badge.\n") };
    expect(validateReportPayload(uncited, chunks, snapshot, "briefing_doc")).toMatch(/uncited/i);

    const twoSentences = { ...payload, content_md: payload.content_md.replace(/(## Key Takeaways\n\n- [^\n]*?)( \[\d+\])/, "$1 A second unsupported sentence.$2") };
    expect(validateReportPayload(twoSentences, chunks, snapshot, "briefing_doc")).toMatch(/uncited/i);
  });

  it("the Vertex Flash release variant reports UNAVAILABLE unless Vertex is configured", async () => {
    const { runStudioReportsReleaseGate } = await import("../src/studio-gate.ts");
    const release = await runStudioReportsReleaseGate({});
    expect(release).toMatchObject({ status: "unavailable" });
  });
});
