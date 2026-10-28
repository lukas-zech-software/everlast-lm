import { toVectorLiteral, retrieveScopedChunks, type Pool, type ScopeSnapshot, type RetrievedChunk } from '@everlast/db';

export interface CalibrationResult {
  retrievedChunks: RetrievedChunk[];
  retrievedChunkIds: string[];
  exactTopChunkIds: string[];
  needleRecalled: boolean;
  recallVsExact: number;
  queryPlan: string;
  scopePreserved: boolean;
}

export async function calibrateScopedRetrieval(
  pool: Pool,
  snapshot: ScopeSnapshot,
  options: {
    queryText: string;
    queryEmbedding: number[];
    needleChunkId?: string | undefined;
    limit?: number;
    candidates?: number;
  }
): Promise<CalibrationResult> {
  const limit = options.limit ?? 12;
  const candidates = options.candidates ?? 40;

  const retrieved = await retrieveScopedChunks(pool, snapshot, {
    queryText: options.queryText,
    queryEmbedding: options.queryEmbedding,
    limit,
    candidates,
  });

  const sourceIds = snapshot.sources.map(s => s.source_id);
  const revisions = snapshot.sources.map(s => s.revision);
  const vectorLiteral = toVectorLiteral(options.queryEmbedding);

  const exactRes = await pool.query<{ chunk_id: string; distance: number }>(
    `SELECT c.chunk_id, (c.embedding <=> $4::vector)::float8 AS distance
     FROM chunks c
     JOIN unnest($2::uuid[], $3::int[]) AS s(source_id, revision)
       ON s.source_id = c.source_id AND s.revision = c.revision
     WHERE c.notebook_id = $1
     ORDER BY distance, c.chunk_id
     LIMIT $5`,
    [snapshot.notebook_id, sourceIds, revisions, vectorLiteral, limit]
  );

  const planRes = await pool.query<{ ['QUERY PLAN']: string }>(
    `EXPLAIN
     SELECT c.chunk_id
     FROM chunks c
     JOIN unnest($2::uuid[], $3::int[]) AS s(source_id, revision)
       ON s.source_id = c.source_id AND s.revision = c.revision
     WHERE c.notebook_id = $1
     ORDER BY c.embedding <=> $4::vector, c.chunk_id
     LIMIT $5`,
    [snapshot.notebook_id, sourceIds, revisions, vectorLiteral, candidates]
  );

  const retrievedIds = retrieved.map(c => c.chunk_id);
  const exactIds = exactRes.rows.map((r: { chunk_id: string }) => r.chunk_id);

  const allowedSources = new Map(snapshot.sources.map(s => [s.source_id, s.revision]));
  const scopePreserved = retrieved.every(
    c => allowedSources.get(c.source_id) === c.revision
  );

  const needleRecalled = options.needleChunkId ? retrievedIds.includes(options.needleChunkId) : true;
  const exactSet = new Set(exactIds);
  const matched = retrievedIds.filter(id => exactSet.has(id)).length;
  const recallVsExact = exactIds.length > 0 ? matched / exactIds.length : 1.0;

  return {
    retrievedChunks: retrieved,
    retrievedChunkIds: retrievedIds,
    exactTopChunkIds: exactIds,
    needleRecalled,
    recallVsExact,
    queryPlan: planRes.rows.map((r: { ['QUERY PLAN']: string }) => r['QUERY PLAN']).join('\n'),
    scopePreserved,
  };
}
