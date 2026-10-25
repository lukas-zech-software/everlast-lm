import { describe, expect, it } from "vitest";
import { groundedDraftResponseSchema, GroundedDraftSchema } from "../src/chat/draft.ts";
import { groundingInstruction } from "../src/chat/prompt.ts";

/** PR #159 review fixes (specs/010 FR-GC-08). */
describe("[010-code-execution-sandbox] review: compute only offered when a sandbox runtime is configured (FR-GC-01/08)", () => {
  it("without code execution the prompt and response schema match v2 (no compute/clarify)", () => {
    const text = groundingInstruction({ codeExecution: false });
    expect(text).not.toMatch(/"compute"|"clarify"/);
    const schema = groundedDraftResponseSchema({ codeExecution: false }) as any;
    expect(schema.properties.status.enum).toEqual(["answered", "not_in_sources"]);
    expect(schema.properties.computation).toBeUndefined();
    expect(schema.properties.clarification_question).toBeUndefined();
  });
  it("with code execution the compute and clarify rules and schema are offered", () => {
    expect(groundingInstruction({ codeExecution: true })).toMatch(/status "compute"/);
    const schema = groundedDraftResponseSchema({ codeExecution: true }) as any;
    expect(schema.properties.status.enum).toEqual(["answered", "not_in_sources", "compute", "clarify"]);
  });
});

describe("[010-code-execution-sandbox] review: an empty unit means unitless (FR-GC-08)", () => {
  it("accepts unit '' and normalizes it to null", () => {
    const draft = GroundedDraftSchema.parse({
      status: "compute",
      sentences: [],
      computation: { intent: "mean", dataset: [{ label: "a", value: "3", unit: "", chunk_id: "c1" }], code: "emit('x', 1)" },
    });
    expect(draft.computation!.dataset[0]!.unit).toBeNull();
  });
});

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { numericTokens } from "../src/chat/execution/manifest.ts";
import { buildHarness, looksLikeMemory } from "../src/chat/execution/runtime.ts";

describe("[010-code-execution-sandbox] review: source numbers are read as written (FR-GC-08 FR-004)", () => {
  it("a hyphen between numbers is a range or ID separator, not a minus sign", () => {
    expect(numericTokens("FY2023-2024")).toEqual(expect.arrayContaining([2023, 2024]));
    expect(numericTokens("10-20 ms")).toEqual(expect.arrayContaining([10, 20]));
    expect(numericTokens("a change of -3.5%")).toContain(-3.5);
  });
  it("decimal-comma formats are understood", () => {
    expect(numericTokens("Umsatz 1.234,5 €")).toContain(1234.5);
    expect(numericTokens("Wert 3,75")).toContain(3.75);
    expect(numericTokens("1,200 users")).toContain(1200);
    expect(numericTokens("1,200 users")).not.toContain(1.2);
  });
});

describe("[010-code-execution-sandbox] review: memory classification needs a memory signal (FR-GC-08 FR-006)", () => {
  it("words that merely contain 'oom' are not memory errors", () => {
    expect(looksLikeMemory("KeyError: 'room_count'")).toBe(false);
    expect(looksLikeMemory("Bloomberg zoom")).toBe(false);
    expect(looksLikeMemory("MemoryError")).toBe(true);
    expect(looksLikeMemory("process OOM-killed")).toBe(true);
    expect(looksLikeMemory("Killed")).toBe(true);
    expect(looksLikeMemory("out of memory")).toBe(true);
  });
});

const numpy = (() => {
  try {
    execFileSync("python3", ["-c", "import numpy"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!numpy)("[010-code-execution-sandbox] review: numpy integers stay exact integers (local CPython+numpy; UNAVAILABLE otherwise)", () => {
  it("emit(np.int64) publishes an integer string without float rounding", () => {
    const dir = mkdtempSync(join(tmpdir(), "everlast-harness-np-"));
    writeFileSync(join(dir, "run.py"), buildHarness("import numpy as np\nemit('a', np.int64(15))\nemit('b', np.int64(12345678901234567))\nemit('c', np.float64(1.5))\nemit('d', np.bool_(True))"));
    try {
      execFileSync("python3", ["run.py"], { cwd: dir, stdio: "pipe", timeout: 20_000 });
    } catch {
      // non-zero exits are part of the contract
    }
    const out = JSON.parse(readFileSync(join(dir, "everlast_result.json"), "utf8"));
    expect(out.status).toBe("exception");
    const ok = (code: string) => {
      writeFileSync(join(dir, "run.py"), buildHarness(code));
      execFileSync("python3", ["run.py"], { cwd: dir, stdio: "pipe", timeout: 20_000 });
      return JSON.parse(readFileSync(join(dir, "everlast_result.json"), "utf8"));
    };
    expect(ok("import numpy as np\nemit('a', np.int64(15))\nemit('b', np.int64(12345678901234567))\nemit('c', np.float64(1.5))").results.map((r: any) => r.value)).toEqual([
      "15",
      "12345678901234567",
      "1.5",
    ]);
  });
});

import { neutralizeMarkers, plainLabel } from "../src/chat/sanitize.ts";

describe("[010-code-execution-sandbox] review: answer prose keeps its own brackets (FR-GC-02)", () => {
  it("ordinary brackets and comparisons are unchanged", () => {
    expect(neutralizeMarkers("significant at p < 0.05 for values in [0, 1]")).toBe("significant at p < 0.05 for values in [0, 1]");
    expect(neutralizeMarkers("see [Appendix A] and a<b>c")).toBe("see [Appendix A] and a<b>c");
  });
  it("anything that could render as a badge is still neutralized, idempotently", () => {
    const badge = /\[\[\d+\]\]|\[\d{1,6}\]/;
    for (const s of ["[[1]]", "[[[1]]]", "[ [1] ]", "[(computed)[1]]", "[<[1]>]", "[\u00001]", "x [12] y", "[[\t2\t]]"]) {
      const out = neutralizeMarkers(s);
      expect(out, s).not.toMatch(badge);
      expect(neutralizeMarkers(out)).toBe(out);
    }
    expect(neutralizeMarkers("a (Computed) b")).not.toMatch(/\(computed\)/i);
  });
  it("sandbox labels stay fully neutralized", () => {
    expect(plainLabel("a <b> [c]", 100)).not.toMatch(/[<>[\]]/);
  });
});
