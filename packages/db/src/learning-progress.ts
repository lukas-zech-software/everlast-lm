import type { Pool } from "pg";
import type {
  LearningItemOutcome,
  LearningItemState,
  LearningProgressDto,
  StudioPluginType,
} from "@everlast/contracts";
import { withTransaction } from "./transaction.ts";

/**
 * [014-studio-active-learning-suite] T006 — Per-user, per-artifact LearningProgress persistence
 * (FR-ST-15, Gate v4.0 #2, NFR-SEC-02).
 */

export interface RecordLearningProgressInput {
  userId: string;
  artifactId: string;
  notebookId: string;
  itemId: string;
  outcome: LearningItemOutcome;
}

export interface LearningProgressRepository {
  get(userId: string, artifactId: string): Promise<LearningProgressDto | null>;
  recordAttempt(input: RecordLearningProgressInput): Promise<LearningProgressDto>;
  reset(userId: string, artifactId: string): Promise<LearningProgressDto>;
}

/**
 * Extracts all valid UUID item IDs (flashcards + quiz questions) belonging to a Completed Studio artifact.
 */
export function extractArtifactLearningItemIds(pluginType: StudioPluginType, payload: unknown): Set<string> {
  const ids = new Set<string>();
  if (!payload || typeof payload !== "object") return ids;
  const record = payload as Record<string, unknown>;
  if (pluginType === "flashcards" && Array.isArray(record.cards)) {
    for (const card of record.cards) {
      if (card && typeof card === "object" && typeof (card as { id?: unknown }).id === "string") {
        ids.add((card as { id: string }).id);
      }
    }
  } else if (pluginType === "quiz" && Array.isArray(record.questions)) {
    for (const q of record.questions) {
      if (q && typeof q === "object" && typeof (q as { id?: unknown }).id === "string") {
        ids.add((q as { id: string }).id);
      }
    }
  } else if (pluginType === "learning_overview" && Array.isArray(record.modules)) {
    for (const mod of record.modules) {
      if (!mod || typeof mod !== "object") continue;
      const m = mod as { flashcards?: unknown; checkpoint_quiz?: unknown };
      if (Array.isArray(m.flashcards)) {
        for (const card of m.flashcards) {
          if (card && typeof card === "object" && typeof (card as { id?: unknown }).id === "string") {
            ids.add((card as { id: string }).id);
          }
        }
      }
      if (Array.isArray(m.checkpoint_quiz)) {
        for (const q of m.checkpoint_quiz) {
          if (q && typeof q === "object" && typeof (q as { id?: unknown }).id === "string") {
            ids.add((q as { id: string }).id);
          }
        }
      }
    }
  }
  return ids;
}

export class InMemoryLearningProgressRepository implements LearningProgressRepository {
  private readonly store = new Map<string, LearningProgressDto>();

  private key(userId: string, artifactId: string): string {
    return `${userId}|${artifactId}`;
  }

  async get(userId: string, artifactId: string): Promise<LearningProgressDto | null> {
    const found = this.store.get(this.key(userId, artifactId));
    return found ? structuredClone(found) : null;
  }

  async recordAttempt(input: RecordLearningProgressInput): Promise<LearningProgressDto> {
    const k = this.key(input.userId, input.artifactId);
    const now = new Date().toISOString();
    const existing = this.store.get(k);
    const states: Record<string, LearningItemState> = existing ? { ...existing.item_states_json } : {};
    const prev = states[input.itemId];
    states[input.itemId] = {
      status: input.outcome,
      attempts: (prev?.attempts ?? 0) + 1,
      last_reviewed_at: now,
    };
    const next: LearningProgressDto = {
      user_id: input.userId,
      artifact_id: input.artifactId,
      notebook_id: input.notebookId,
      item_states_json: states,
      updated_at: now,
    };
    this.store.set(k, next);
    return structuredClone(next);
  }

  async reset(userId: string, artifactId: string): Promise<LearningProgressDto> {
    const k = this.key(userId, artifactId);
    const now = new Date().toISOString();
    const existing = this.store.get(k);
    const next: LearningProgressDto = {
      user_id: userId,
      artifact_id: artifactId,
      notebook_id: existing?.notebook_id ?? "00000000-0000-0000-0000-000000000000",
      item_states_json: {},
      updated_at: now,
    };
    if (existing) {
      this.store.set(k, next);
    }
    return structuredClone(next);
  }
}

interface LearningProgressRow {
  user_id: string;
  artifact_id: string;
  notebook_id: string;
  item_states_json: Record<string, LearningItemState>;
  updated_at: Date;
}

function toDto(row: LearningProgressRow): LearningProgressDto {
  return {
    user_id: row.user_id,
    artifact_id: row.artifact_id,
    notebook_id: row.notebook_id,
    item_states_json: row.item_states_json ?? {},
    updated_at: row.updated_at.toISOString(),
  };
}

export class PostgresLearningProgressRepository implements LearningProgressRepository {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async get(userId: string, artifactId: string): Promise<LearningProgressDto | null> {
    const { rows } = await this.pool.query<LearningProgressRow>(
      `SELECT user_id, artifact_id, notebook_id, item_states_json, updated_at
         FROM learning_progress
        WHERE user_id = $1 AND artifact_id = $2`,
      [userId, artifactId]
    );
    return rows[0] ? toDto(rows[0]) : null;
  }

  async recordAttempt(input: RecordLearningProgressInput): Promise<LearningProgressDto> {
    return withTransaction(
      this.pool,
      async (client) => {
        const existing = await client.query<LearningProgressRow>(
          `SELECT user_id, artifact_id, notebook_id, item_states_json, updated_at
             FROM learning_progress
            WHERE user_id = $1 AND artifact_id = $2
            FOR UPDATE`,
          [input.userId, input.artifactId]
        );
        const now = new Date().toISOString();
        const prevStates = existing.rows[0]?.item_states_json ?? {};
        const prevItem = prevStates[input.itemId];
        const nextStates: Record<string, LearningItemState> = {
          ...prevStates,
          [input.itemId]: {
            status: input.outcome,
            attempts: (prevItem?.attempts ?? 0) + 1,
            last_reviewed_at: now,
          },
        };
        const { rows } = await client.query<LearningProgressRow>(
          `INSERT INTO learning_progress (user_id, artifact_id, notebook_id, item_states_json, updated_at)
           VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
           ON CONFLICT (user_id, artifact_id) DO UPDATE
             SET item_states_json = EXCLUDED.item_states_json,
                 updated_at = EXCLUDED.updated_at
           RETURNING user_id, artifact_id, notebook_id, item_states_json, updated_at`,
          [input.userId, input.artifactId, input.notebookId, JSON.stringify(nextStates), now]
        );
        return toDto(rows[0]!);
      },
      { retries: 0 }
    );
  }

  async reset(userId: string, artifactId: string): Promise<LearningProgressDto> {
    return withTransaction(
      this.pool,
      async (client) => {
        const { rows } = await client.query<LearningProgressRow>(
          `UPDATE learning_progress
              SET item_states_json = '{}'::jsonb,
                  updated_at = now()
            WHERE user_id = $1 AND artifact_id = $2
            RETURNING user_id, artifact_id, notebook_id, item_states_json, updated_at`,
          [userId, artifactId]
        );
        if (rows[0]) return toDto(rows[0]);
        const art = await client.query<{ notebook_id: string }>(
          `SELECT notebook_id FROM studio_artifacts WHERE id = $1`,
          [artifactId]
        );
        const notebookId = art.rows[0]?.notebook_id ?? "00000000-0000-0000-0000-000000000000";
        return {
          user_id: userId,
          artifact_id: artifactId,
          notebook_id: notebookId,
          item_states_json: {},
          updated_at: new Date().toISOString(),
        };
      },
      { retries: 0 }
    );
  }
}
