/**
 * Model/sandbox text neutralization (FR-GC-02, FR-GC-08 FR-005, D13; specs/010 security review rounds 1–2).
 * Only the verifier and `composeComputedAnswer` may emit `[[n]]` citation badges and the " (Computed)" label.
 *
 * Every step REPLACES characters instead of deleting them, so no later step can join neighbours into a marker:
 * ASCII square brackets become fullwidth lookalikes (［ ］), angle brackets become ‹ ›, control characters become
 * spaces, and any "(computed)" spelling loses its parentheses. All steps run inside one loop until a fixed point,
 * which makes the function idempotent: neutralizeMarkers(neutralizeMarkers(x)) === neutralizeMarkers(x).
 */
export function neutralizeMarkers(text: string): string {
  let out = text;
  for (let previous: string | null = null; previous !== out; ) {
    previous = out;
    out = out
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")
      .replace(/\[/g, "［")
      .replace(/\]/g, "］")
      .replace(/</g, "‹")
      .replace(/>/g, "›")
      .replace(/\(\s*computed\s*\)/gi, "computed")
      .replace(/[ \t]{2,}/g, " ");
  }
  return out;
}

/** Single-line plain text for sandbox labels/units: the shared neutralization plus whitespace folding and a cap. */
export function plainLabel(text: string, max: number): string {
  return neutralizeMarkers(text.replace(/\s+/g, " ")).trim().slice(0, max).trim();
}
