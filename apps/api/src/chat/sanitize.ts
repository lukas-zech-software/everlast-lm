/**
 * Model/sandbox text neutralization (FR-GC-02, FR-GC-08, D13; specs/010 security review fix).
 * Only the verifier and `composeComputedAnswer` may emit `[[n]]` citation badges and the " (Computed)" label.
 * Every bracket pair is collapsed until nothing changes, so nested input such as "[[[1]]]" can never recombine
 * into a badge, and any model-written "(Computed)" marker is removed.
 */
export function neutralizeMarkers(text: string): string {
  let out = text;
  for (let previous = ""; previous !== out; ) {
    previous = out;
    out = out.replace(/\[\[/g, "[").replace(/\]\]/g, "]");
  }
  return out.replace(/\(\s*computed\s*\)/gi, "").replace(/[ \t]{2,}/g, " ");
}
