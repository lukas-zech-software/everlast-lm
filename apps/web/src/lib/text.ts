/** Unicode code-point limits shared by UI validation (FR-WM-01, FR-GC-01); the server re-validates. */

export function codePointLength(value: string): number {
  let n = 0;
  for (const _ of value) n++;
  return n;
}

export function validateTitle(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const value = raw.trim();
  const length = codePointLength(value);
  if (length < 1) return { ok: false, message: "Title cannot be empty." };
  if (length > 100) return { ok: false, message: "Title must be 100 characters or fewer." };
  return { ok: true, value };
}

export function validateMessage(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  const value = raw.trim();
  const length = codePointLength(value);
  if (length < 1) return { ok: false, message: "Enter a question." };
  if (length > 10_000) return { ok: false, message: "Messages are limited to 10,000 characters." };
  return { ok: true, value };
}
