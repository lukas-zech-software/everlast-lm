import { describe, expect, it } from "vitest";
import { buildGoldenDataset, assertDatasetMinimums, datasetCounts, GoldenCaseV1Schema, datasetHash, releaseSample } from "../src/dataset.ts";
import { judgeMetric, ratio, containsForbidden } from "../src/metrics.ts";
import { buildCorpus } from "../src/corpus.ts";

/** T013 — NFR-EVAL-01..04 thresholds, dataset minimums and fail-closed denominators (exact boundaries). */

describe("golden dataset (NFR-EVAL-01..04)", () => {
  it("EVB-01: meets category minimums: >=100 unanswerable, >=50 deselection incl. history, >=50 synthesis", () => {
    const cases = buildGoldenDataset();
    expect(datasetCounts(cases)).toMatchObject({ unanswerable: 110, synthesis: 60 });
    expect(datasetCounts(cases).deselection).toBeGreaterThanOrEqual(50);
    expect(datasetCounts(cases).history).toBeGreaterThan(0);
    expect(() => assertDatasetMinimums(cases)).not.toThrow();
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  it("EVB-02: 99 unanswerable / 49 deselection / 49 synthesis cases fail the minimums", () => {
    const cases = buildGoldenDataset();
    const drop = (category: string, keep: number) => {
      let n = 0;
      return cases.filter((c) => (c.category === category || (category === "deselection" && c.category === "deselected_source") ? n++ < keep : true));
    };
    expect(() => assertDatasetMinimums(drop("unanswerable", 99))).toThrow(/unanswerable 99 < 100/);
    expect(() => assertDatasetMinimums(drop("synthesis", 49))).toThrow(/synthesis 49 < 50/);
    const fewDes = cases.filter((c) => c.category !== "history_carryover").filter((c, i, all) => c.category !== "deselected_source" || all.filter((x) => x.category === "deselected_source").indexOf(c) < 0);
    expect(() => assertDatasetMinimums(fewDes)).toThrow(/deselection/);
  });

  it("EVB-03: dataset is deterministic, schema-valid and hashed; corpus contains no real company content", () => {
    const a = buildGoldenDataset();
    const b = buildGoldenDataset();
    expect(datasetHash(a)).toBe(datasetHash(b));
    for (const c of a) expect(GoldenCaseV1Schema.safeParse(c).success).toBe(true);
    const corpus = JSON.stringify(buildCorpus());
    expect(corpus).toContain("Kestrel Vantage");
    for (const c of a.filter((x) => x.category === "unanswerable")) {
      for (const f of c.forbidden) expect(containsForbidden(corpus, f), `${c.id} answer "${f}" appears in corpus`).toBe(false);
    }
  });
});

describe("judged release sample (Constitution v2.0.0)", () => {
  it("EVB-10: exactly 50 cases, deterministic, proportional and covering every category", () => {
    const cases = buildGoldenDataset();
    const a = releaseSample(cases);
    expect(a).toHaveLength(50);
    expect(releaseSample(buildGoldenDataset()).map((c) => c.id)).toEqual(a.map((c) => c.id));
    expect(new Set(a.map((c) => c.id)).size).toBe(50);
    expect(datasetCounts(a)).toMatchObject({ unanswerable: 25, synthesis: 14, history: 4, deselection: 11 });
  });
});

describe("gate thresholds", () => {
  it("EVB-04: hallucination 0.049 passes, 0.05 and 0.051 fail (strict < 0.05)", () => {
    expect(judgeMetric("hallucination_rate", 0.049, { failing_cases: [] }).passed).toBe(true);
    expect(judgeMetric("hallucination_rate", 0.05, { failing_cases: [] }).passed).toBe(false);
    expect(judgeMetric("hallucination_rate", 0.051, { failing_cases: [] }).passed).toBe(false);
  });

  it("EVB-05: Precision_ID 1.0 passes, 0.99 fails", () => {
    expect(judgeMetric("citation_precision", 1, { failing_cases: [] }).passed).toBe(true);
    expect(judgeMetric("citation_precision", 0.99, { failing_cases: [] }).passed).toBe(false);
  });

  it("EVB-06: rejection 0.98 fails, 0.99 and 1.0 pass", () => {
    expect(judgeMetric("negative_rejection_rate", 0.98, { failing_cases: [] }).passed).toBe(false);
    expect(judgeMetric("negative_rejection_rate", 0.99, { failing_cases: [] }).passed).toBe(true);
    expect(judgeMetric("negative_rejection_rate", 1, { failing_cases: [] }).passed).toBe(true);
  });

  it("EVB-07: leakage 0 passes, 1 fails; semantic support below 1.0 fails", () => {
    expect(judgeMetric("scoping_leakage_count", 0, { failing_cases: [] }).passed).toBe(true);
    expect(judgeMetric("scoping_leakage_count", 1, { failing_cases: [] }).passed).toBe(false);
    expect(judgeMetric("semantic_support_rate", 0.999, { failing_cases: [] }).passed).toBe(false);
  });

  it("EVB-08: zero denominators and invalid numerators fail closed; missing judge results are unavailable, not passed", () => {
    expect(() => ratio(0, 0, "x")).toThrow(/fails closed/);
    expect(() => ratio(3, 2, "x")).toThrow(/invalid numerator/);
    expect(() => ratio(-1, 2, "x")).toThrow();
    const missing = judgeMetric("hallucination_rate", null, { failing_cases: [], unavailable: "UNAVAILABLE" });
    expect(missing).toMatchObject({ status: "unavailable", passed: false });
  });

  it("EVB-09: forbidden-string matching is case-insensitive and token-bounded", () => {
    expect(containsForbidden("The winner was ARGENTINA.", "Argentina")).toBe(true);
    expect(containsForbidden("Budget €1.37M approved", "€1.37M")).toBe(true);
    expect(containsForbidden("catalog of logs", "log")).toBe(false);
    expect(containsForbidden("This costs €11.37M", "€1.37M")).toBe(false);
  });
});
