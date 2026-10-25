import { describe, expect, it } from "vitest";
import { neutralizeMarkers } from "../src/chat/sanitize.ts";
import { validateComputedResults } from "../src/chat/execution/output.ts";

/**
 * [010-code-execution-sandbox] security review round 2 — model/sandbox text can never form a citation badge or
 * the Computed marker, whatever the order of neutralization steps (FR-GC-02, FR-GC-08 FR-005, D13). Pure unit.
 */

const BADGE = /\[\[\d+\]\]/;
const C1 = "0190f0b5-7d1c-7a4e-9b2a-3c4d5e6f7a01";

describe("SAN round 2: recombination bypasses", () => {
  it("SAN-R2-01: '[(computed)[1]]' cannot become a badge after the marker is neutralized", () => {
    for (const input of ["[(computed)[1]]", "[(computed)[1](computed)]", "[( Computed )[7]( COMPUTED )]"]) {
      const out = neutralizeMarkers(input);
      expect(out, input).not.toMatch(BADGE);
      expect(out, input).not.toContain("(Computed)");
    }
  });

  it("SAN-R2-02: '[<[1]>]' cannot become a badge in sandbox labels/units (output.ts uses the shared helper)", () => {
    expect(neutralizeMarkers("[<[1]>]")).not.toMatch(BADGE);
    const [r] = validateComputedResults([{ label: "sd [<[1]>]", value: "1", unit: "[<[2]>]", sources: [C1] }], [C1]);
    expect(r!.label).not.toMatch(BADGE);
    expect(r!.unit ?? "").not.toMatch(BADGE);
    const [s] = validateComputedResults([{ label: "x [\u0001[1]\u0001]", value: "1", unit: "( Computed )", sources: [C1] }], [C1]);
    expect(`${s!.label} ${s!.unit}`).not.toMatch(BADGE);
    expect(`${s!.label} ${s!.unit}`).not.toContain("(Computed)");
  });

  it("SAN-R2-03: property — idempotent, never a badge, never '(Computed)' (2,000 generated strings)", () => {
    const alphabet = ["[", "]", "[[", "]]", "(", ")", "<", ">", "computed", "Computed", "COMPUTED", " ", "\t", "\u0001", "\n", "1", "42", "x"];
    let seed = 0x2f6e2b1;
    const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (let i = 0; i < 2000; i++) {
      const input = Array.from({ length: 1 + Math.floor(rand() * 24) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");
      const once = neutralizeMarkers(input);
      expect(neutralizeMarkers(once), JSON.stringify(input)).toBe(once);
      expect(once, JSON.stringify(input)).not.toMatch(BADGE);
      expect(once, JSON.stringify(input)).not.toContain("(Computed)");
      expect(once.toLowerCase(), JSON.stringify(input)).not.toMatch(/\(\s*computed\s*\)/);
    }
  });
});
