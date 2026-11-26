/**
 * Model/sandbox text neutralization (FR-GC-02, FR-GC-08 FR-005, D13; specs/010 security review rounds 1–2).
 * Only the verifier and `composeComputedAnswer` may emit `[[n]]` citation badges and the " (Computed)" label.
 *
 * Every step REPLACES characters instead of deleting them, so no later step can join neighbours into a marker:
 * ASCII square brackets become fullwidth lookalikes (［ ］), angle brackets become ‹ ›, control characters become
 * spaces, and any "(computed)" spelling loses its parentheses. All steps run inside one loop until a fixed point,
 * which makes the function idempotent: neutralizeMarkers(neutralizeMarkers(x)) === neutralizeMarkers(x).
 */
function replaceControlChars(input: string): string {
  let result = "";
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    const isControl =
      (code >= 0x00 && code <= 0x08) || (code >= 0x0b && code <= 0x1f) || code === 0x7f;
    result += isControl ? " " : input.charAt(i);
  }
  return result;
}

export function neutralizeMarkers(text: string): string {
  // Answer prose keeps ordinary brackets and comparisons ("[0, 1]", "p < 0.05"); only bracket runs that a renderer
  // could read as a badge ("[[n]]" in chat, "[n]" in notes) are replaced (PR #159 review).
  return fixpoint(text, (out) =>
    replaceControlChars(out)
      .replace(/\[(?=\s*\[)/g, "［")
      .replace(/(?<=\]\s*)\]/g, "］")
      .replace(/\[(\s*\d{1,6}\s*)\]/g, "［$1］")
      .replace(/\(\s*computed\s*\)/gi, "computed")
      .replace(/[ \t]{2,}/g, " "),
  );
}

/** Every bracket and angle bracket replaced: for short sandbox-provided labels and units, never prose. */
function neutralizeAll(text: string): string {
  return fixpoint(text, (out) =>
    replaceControlChars(out)
      .replace(/\[/g, "［")
      .replace(/\]/g, "］")
      .replace(/</g, "‹")
      .replace(/>/g, "›")
      .replace(/\(\s*computed\s*\)/gi, "computed")
      .replace(/[ \t]{2,}/g, " "),
  );
}

function fixpoint(text: string, step: (s: string) => string): string {
  let out = text;
  for (let previous: string | null = null; previous !== out;) {
    previous = out;
    out = step(out);
  }
  return out;
}

/** Single-line plain text for sandbox labels/units: the shared neutralization plus whitespace folding and a cap. */
export function plainLabel(text: string, max: number): string {
  return neutralizeAll(text.replace(/\s+/g, " ")).trim().slice(0, max).trim();
}
