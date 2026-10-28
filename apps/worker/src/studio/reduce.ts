import { OriginalCoverageSchema } from '@everlast/contracts';

export function validateCoverageManifest(raw: unknown): void {
  OriginalCoverageSchema.parse(raw);
}

export interface ReduceFindingsOptions<T extends { citations: string[] }> {
  findings: T[];
  maxBatchFindings?: number;
  reduceBatch: (batch: T[]) => Promise<T>;
}

export async function reduceOriginalFindings<T extends { citations: string[] }>(
  options: ReduceFindingsOptions<T>
): Promise<T> {
  const maxBatch = Math.max(2, options.maxBatchFindings ?? 5);
  let current = [...options.findings];

  if (current.length === 0) {
    throw new Error('Cannot reduce empty findings');
  }

  while (current.length > 1) {
    const nextRound: T[] = [];
    for (let i = 0; i < current.length; i += maxBatch) {
      const slice = current.slice(i, i + maxBatch);
      if (slice.length === 1) {
        nextRound.push(slice[0]!);
      } else {
        const reduced = await options.reduceBatch(slice);
        // Verify no citation IDs were dropped
        const expectedCitations = new Set(slice.flatMap(s => s.citations));
        for (const cit of expectedCitations) {
          if (!reduced.citations.includes(cit)) {
            reduced.citations.push(cit);
          }
        }
        nextRound.push(reduced);
      }
    }
    current = nextRound;
  }

  return current[0]!;
}
