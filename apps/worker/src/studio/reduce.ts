import { OriginalCoverageSchema } from "@everlast/contracts";

export function validateCoverageManifest(raw: unknown): void {
  OriginalCoverageSchema.parse(raw);
}

export interface ReduceFindingsOptions<T extends { citations: string[] }> {
  findings: T[];
  maxBatchFindings?: number;
  reduceBatch: (batch: T[]) => Promise<T>;
}

function preserveSliceCitations<T extends { citations: string[] }>(reduced: T, slice: T[]): T {
  const existing = new Set(reduced.citations);
  for (const item of slice) {
    for (const cit of item.citations) {
      if (!existing.has(cit)) {
        existing.add(cit);
        reduced.citations.push(cit);
      }
    }
  }
  return reduced;
}

async function reduceRound<T extends { citations: string[] }>(
  current: T[],
  maxBatch: number,
  reduceBatch: (batch: T[]) => Promise<T>,
): Promise<T[]> {
  const nextRound: T[] = [];
  for (let i = 0; i < current.length; i += maxBatch) {
    const slice = current.slice(i, i + maxBatch);
    if (slice.length === 1) {
      const single = slice[0];
      if (single) nextRound.push(single);
    } else {
      const reduced = await reduceBatch(slice);
      nextRound.push(preserveSliceCitations(reduced, slice));
    }
  }
  return nextRound;
}

export async function reduceOriginalFindings<T extends { citations: string[] }>(
  options: ReduceFindingsOptions<T>,
): Promise<T> {
  const maxBatch = Math.max(2, options.maxBatchFindings ?? 5);
  let current = [...options.findings];

  if (current.length === 0) {
    throw new Error("Cannot reduce empty findings");
  }

  while (current.length > 1) {
    current = await reduceRound(current, maxBatch, options.reduceBatch);
  }

  const final = current[0];
  if (!final) throw new Error("Cannot reduce empty findings");
  return final;
}
