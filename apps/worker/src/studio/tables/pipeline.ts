import {
  DATA_TABLE_MAX_COLUMNS,
  DATA_TABLE_MAX_ROWS,
  type DataTableSchemaId,
  type SourceRevisionPair,
  type StudioDataTablePayload,
  type StudioFailureCode,
  type StudioGenerationOutcome,
  type StudioProgress,
  type UnifiedDocumentChunk,
} from "@everlast/contracts";
import { processAllOriginalEvidenceBatches, verifyEvidenceCoverage, type EvidenceBatchLimits } from "../evidence.ts";
import type { DataTableModelClient, TableObservation } from "./model.ts";
import { validateDataTablePayload } from "./validation.ts";

/**
 * [011-studio-mindmaps-data-tables] T042 — Data Table pipeline over all original C-02 chunks
 * (FR-ST-18, C-02/C-03, FR-GC-02; FR-007, FR-008, FR-010, FR-011, FR-013, FR-015, FR-016, SC-006, SC-008, SC-009, SC-010).
 */

export interface GenerateDataTableInput {
  chunks: readonly UnifiedDocumentChunk[];
  snapshot: readonly SourceRevisionPair[];
  model: DataTableModelClient;
  focus_prompt?: string | undefined;
  schema_id?: DataTableSchemaId | undefined;
  output_language?: string | undefined;
  limits?: EvidenceBatchLimits | undefined;
  signal: AbortSignal;
  reportProgress(stage: StudioProgress["stage"], percent: number): void;
}

const refuse = (code: StudioFailureCode, message: string): StudioGenerationOutcome<StudioDataTablePayload> => ({
  status: "refused",
  code,
  message,
});

function dedupeObservations(observations: TableObservation[]): TableObservation[] {
  const seen = new Set<string>();
  return observations.filter((o) => {
    const key = `${o.item_label.toLowerCase()}|${o.attribute_id}|${o.value_text}|${o.chunk_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function generateDataTable(input: GenerateDataTableInput): Promise<StudioGenerationOutcome<StudioDataTablePayload>> {
  const { chunks, snapshot, model, focus_prompt, schema_id, output_language, signal } = input;
  signal.throwIfAborted();

  if (chunks.length === 0) {
    return refuse("InsufficientEvidence", "The selected sources contain no readable content to extract a data table.");
  }

  input.reportProgress("reading", 5);
  const { items: rawObservations, coverage } = await processAllOriginalEvidenceBatches({
    chunks,
    snapshot,
    limits: input.limits,
    signal,
    onBatchComplete: (done, total) => {
      input.reportProgress("extracting", 10 + Math.round((done / Math.max(1, total)) * 60));
    },
    extractBatch: (batch) =>
      model.extract({
        chunks: batch,
        focus_prompt,
        schema_id,
        output_language,
        signal,
      }),
  });

  const coverageError = verifyEvidenceCoverage(coverage, chunks, snapshot);
  if (coverageError) {
    return refuse("CitationValidationFailed", coverageError);
  }

  const observations = dedupeObservations(rawObservations);
  if (observations.length === 0) {
    return refuse("InsufficientEvidence", "The selected sources do not contain enough structured evidence to populate a comparison table.");
  }

  signal.throwIfAborted();
  input.reportProgress("composing", 75);
  const { payload: composed, rawRowCount, rawColumnCount } = await model.compose({
    observations,
    chunks,
    focus_prompt,
    schema_id,
    output_language,
    signal,
  });

  // FR-015 / SC-009: Whole-result overflow (>500 rows or >25 columns) fails the job with a narrowing message and publishes no partial table!
  if (rawRowCount > DATA_TABLE_MAX_ROWS || rawColumnCount > DATA_TABLE_MAX_COLUMNS) {
    return refuse(
      "TableBoundsExceeded",
      `Extracted table (${rawRowCount} rows × ${rawColumnCount} columns) exceeds the maximum of ${DATA_TABLE_MAX_ROWS} rows and ${DATA_TABLE_MAX_COLUMNS} columns. Please narrow your source selection or specify a more focused prompt.`
    );
  }

  const payload = {
    ...composed,
    coverage,
  };

  signal.throwIfAborted();
  input.reportProgress("validating", 90);
  const validationError = validateDataTablePayload(payload, chunks, snapshot);
  if (validationError) {
    return refuse("CitationValidationFailed", validationError);
  }

  input.reportProgress("publishing", 95);
  return {
    status: "completed",
    payload,
  };
}
