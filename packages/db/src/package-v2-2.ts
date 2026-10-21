import { createHash } from "node:crypto";
import type {
  ChatConfiguration,
  MessageFeedback,
  MessageFeedbackInput,
  FollowUpSuggestions,
  NotebookOverview,
  SourceGuide,
} from "@everlast/contracts";
import { ChatConfigurationSchema, FollowUpSuggestionsSchema, MessageFeedbackSchema, NotebookOverviewSchema, PersistedMessageFollowUpsSchema, SourceGuideSchema } from "@everlast/contracts";
import type { Pool } from "pg";
import { getChatMessages, onNotebookForgotten, persistChatMessage } from "./poc-bridge.ts";
import { v2Pool } from "./v2-persistence.ts";

// Package 2.2 stores (FR-SI-02, FR-GC-04/05/07/09): PostgreSQL tables of migration 0006 (specs/013) when configured,
// else the TEST-ONLY in-memory maps below. Every record is parsed with its contract schema on write and read.

const guideStore = new Map<string, SourceGuide>();
const overviewStore = new Map<string, NotebookOverview>();
const configStore = new Map<string, ChatConfiguration>();
const feedbackStore = new Map<string, MessageFeedback>();
const followUpStore = new Map<string, import("@everlast/contracts").PersistedMessageFollowUps>();

const guideKey = (notebookId: string, sourceId: string, revision: number, language: string) => `${notebookId}:${sourceId}:${revision}:${language}`;
const authorizationKey = (userId: string) => createHash("sha256").update(userId).digest("hex");
const settingKey = (notebookId: string, userId: string) => `${notebookId}:${userId}`;
const feedbackKey = (notebookId: string, userId: string, messageId: string) => `${notebookId}:${userId}:${messageId}`;

export function resetPackageV22Store(): void {
  guideStore.clear();
  overviewStore.clear();
  configStore.clear();
  feedbackStore.clear();
  followUpStore.clear();
}

/**
 * Guide identity is (notebook, source, revision, output language) (FR-SI-02, FR-UI-02). Without a language the
 * caller accepts any language of that revision (Studio suggestions), preferring a ready guide.
 */
async function pgGuides(pool: Pool, notebookId: string, sourceId: string, revision: number, outputLanguage?: string): Promise<SourceGuide[]> {
  const { rows } = await pool.query<{ record: unknown }>(
    `SELECT record FROM source_guides WHERE notebook_id = $1 AND source_id = $2 AND revision = $3 AND ($4::text IS NULL OR output_language = $4)
     ORDER BY (status = 'GuideReady') DESC, updated_at`,
    [notebookId, sourceId, revision, outputLanguage ?? null]
  );
  return rows.map((r) => SourceGuideSchema.parse(r.record));
}

export async function getSourceGuide(notebookId: string, sourceId: string, revision: number, outputLanguage?: string): Promise<SourceGuide | null> {
  const pool = v2Pool();
  if (pool) return (await pgGuides(pool, notebookId, sourceId, revision, outputLanguage))[0] ?? null;
  if (outputLanguage !== undefined) return guideStore.get(guideKey(notebookId, sourceId, revision, outputLanguage)) ?? null;
  const candidates = [...guideStore.values()].filter((g) => g.notebook_id === notebookId && g.source_id === sourceId && g.revision === revision);
  return candidates.find((g) => g.status === "GuideReady") ?? candidates[0] ?? null;
}

export async function saveSourceGuide(guide: SourceGuide): Promise<SourceGuide> {
  const validated = SourceGuideSchema.parse(guide);
  const pool = v2Pool();
  if (pool) {
    // A guide of a source that was deleted meanwhile is dropped (no row is written for a missing source).
    await pool.query(
      `INSERT INTO source_guides (source_id, revision, output_language, notebook_id, status, record)
       SELECT id, $2, $3, $4, $5, $6 FROM sources WHERE id = $1 AND notebook_id = $4
       ON CONFLICT (source_id, revision, output_language) DO UPDATE SET status = EXCLUDED.status, record = EXCLUDED.record, updated_at = now()`,
      [validated.source_id, validated.revision, validated.output_language, validated.notebook_id, validated.status, JSON.stringify(validated)]
    );
    return validated;
  }
  guideStore.set(guideKey(validated.notebook_id, validated.source_id, validated.revision, validated.output_language), validated);
  return validated;
}

export async function deleteSourceGuides(notebookId: string, sourceId: string): Promise<void> {
  const pool = v2Pool();
  if (pool) {
    await pool.query("DELETE FROM source_guides WHERE notebook_id = $1 AND source_id = $2", [notebookId, sourceId]);
    return;
  }
  for (const [key, guide] of guideStore) {
    if (guide.notebook_id === notebookId && guide.source_id === sourceId) guideStore.delete(key);
  }
}

/** R5 restart sweep (FR-011): guides left GuidePending by a stopped process are dropped, so the next open regenerates them. */
export async function sweepOrphanedSourceGuides(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query("DELETE FROM source_guides WHERE status = 'GuidePending' AND updated_at < now()");
  return rowCount ?? 0;
}

export async function getOverview(cacheKey: string): Promise<NotebookOverview | null> {
  const pool = v2Pool();
  if (pool) {
    const { rows } = await pool.query<{ record: unknown }>("SELECT record FROM notebook_overviews WHERE cache_key = $1", [cacheKey]);
    return rows[0] ? NotebookOverviewSchema.parse(rows[0].record) : null;
  }
  return overviewStore.get(cacheKey) ?? null;
}

export async function getOverviewForUser(cacheKey: string, userId: string): Promise<NotebookOverview | null> {
  const overview = v2Pool() ? await getOverview(cacheKey) : overviewStore.get(cacheKey);
  return overview?.authorization_key === authorizationKey(userId) ? overview : null;
}

export async function saveOverview(overview: NotebookOverview): Promise<NotebookOverview> {
  const validated = NotebookOverviewSchema.parse(overview);
  const pool = v2Pool();
  if (pool) {
    await pool.query(
      `INSERT INTO notebook_overviews (cache_key, notebook_id, authorization_key, record) VALUES ($1, $2, $3, $4)
       ON CONFLICT (cache_key) DO UPDATE SET record = EXCLUDED.record, authorization_key = EXCLUDED.authorization_key, updated_at = now()`,
      [validated.cache_key, validated.notebook_id, validated.authorization_key, JSON.stringify(validated)]
    );
    return validated;
  }
  overviewStore.set(validated.cache_key, validated);
  return validated;
}

export async function getChatConfiguration(notebookId: string, userId: string): Promise<ChatConfiguration> {
  const pool = v2Pool();
  if (pool) {
    const { rows } = await pool.query<{ record: unknown }>("SELECT record FROM chat_configurations WHERE notebook_id = $1 AND user_id = $2", [notebookId, userId]);
    return rows[0] ? ChatConfigurationSchema.parse(rows[0].record) : { style: "default", response_length: "default" };
  }
  return configStore.get(settingKey(notebookId, userId)) ?? { style: "default", response_length: "default" };
}

export async function saveChatConfiguration(notebookId: string, userId: string, config: ChatConfiguration): Promise<ChatConfiguration> {
  const validated = ChatConfigurationSchema.parse(config);
  const pool = v2Pool();
  if (pool) {
    await pool.query(
      `INSERT INTO chat_configurations (notebook_id, user_id, record) VALUES ($1, $2, $3)
       ON CONFLICT (notebook_id, user_id) DO UPDATE SET record = EXCLUDED.record, updated_at = now()`,
      [notebookId, userId, JSON.stringify(validated)]
    );
    return validated;
  }
  configStore.set(settingKey(notebookId, userId), validated);
  return validated;
}

export async function saveMessageFeedback(input: MessageFeedbackInput & { notebook_id: string; user_id: string }): Promise<MessageFeedback> {
  const messages = await getChatMessages(undefined, input.notebook_id, input.user_id);
  const message = messages.find((candidate) => candidate.id === input.message_id);
  if (!message || message.role !== "assistant") throw new Error("Assistant message not found for user in notebook");
  const validated = MessageFeedbackSchema.parse({ ...input, created_at: new Date().toISOString() });
  const pool = v2Pool();
  if (pool) {
    await pool.query(
      `INSERT INTO message_feedback (notebook_id, user_id, message_id, record) VALUES ($1, $2, $3, $4)
       ON CONFLICT (notebook_id, user_id, message_id) DO UPDATE SET record = EXCLUDED.record, updated_at = now()`,
      [input.notebook_id, input.user_id, input.message_id, JSON.stringify(validated)]
    );
    return validated;
  }
  feedbackStore.set(feedbackKey(input.notebook_id, input.user_id, input.message_id), validated);
  return validated;
}


const followUpKey = (notebookId: string, userId: string, messageId: string, language: string) => `${notebookId}:${userId}:${messageId}:${language}`;

export async function saveMessageFollowUps(input: { notebook_id: string; user_id: string; message_id: string; followups: FollowUpSuggestions }): Promise<FollowUpSuggestions> {
  const messages = await getChatMessages(undefined, input.notebook_id, input.user_id);
  const message = messages.find((candidate) => candidate.id === input.message_id && candidate.role === "assistant");
  if (!message) throw new Error("Assistant message not found for user in notebook");
  const expected = (message.active_source_revisions_snapshot ?? []).map((item) => `${item.source_id}:${item.revision}`).sort();
  const actual = input.followups.source_revisions.map((item) => `${item.source_id}:${item.revision}`).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("Follow-up snapshot does not match the assistant message snapshot");
  const validated = FollowUpSuggestionsSchema.parse(input.followups);
  const record = PersistedMessageFollowUpsSchema.parse({ notebook_id: input.notebook_id, user_id: input.user_id, message_id: input.message_id, suggestions: validated });
  const pool = v2Pool();
  if (pool) {
    await pool.query(
      `INSERT INTO message_followups (notebook_id, user_id, message_id, output_language, record) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (notebook_id, user_id, message_id, output_language) DO UPDATE SET record = EXCLUDED.record, updated_at = now()`,
      [input.notebook_id, input.user_id, input.message_id, validated.output_language, JSON.stringify(record)]
    );
    return record.suggestions;
  }
  followUpStore.set(followUpKey(input.notebook_id, input.user_id, input.message_id, validated.output_language), record);
  return record.suggestions;
}

/** Follow-ups are cached per assistant message and output language (FR-GC-05, FR-UI-02). */
export async function getMessageFollowUps(notebookId: string, userId: string, messageId: string, outputLanguage: string): Promise<FollowUpSuggestions | null> {
  const pool = v2Pool();
  if (pool) {
    const { rows } = await pool.query<{ record: unknown }>(
      "SELECT record FROM message_followups WHERE notebook_id = $1 AND user_id = $2 AND message_id = $3 AND output_language = $4",
      [notebookId, userId, messageId, outputLanguage]
    );
    return rows[0] ? PersistedMessageFollowUpsSchema.parse(rows[0].record).suggestions : null;
  }
  return followUpStore.get(followUpKey(notebookId, userId, messageId, outputLanguage))?.suggestions ?? null;
}

/** Clears the caller's rating for one message (`Unrated`, FR-GC-09 / FR-014); true when a record existed. */
export async function clearMessageFeedback(notebookId: string, userId: string, messageId: string): Promise<boolean> {
  const pool = v2Pool();
  if (pool) {
    const { rowCount } = await pool.query("DELETE FROM message_feedback WHERE notebook_id = $1 AND user_id = $2 AND message_id = $3", [notebookId, userId, messageId]);
    return (rowCount ?? 0) > 0;
  }
  return feedbackStore.delete(feedbackKey(notebookId, userId, messageId));
}

export async function getMessageFeedback(notebookId: string, userId: string, messageId: string): Promise<MessageFeedback | null> {
  const pool = v2Pool();
  if (pool) {
    const { rows } = await pool.query<{ record: unknown }>("SELECT record FROM message_feedback WHERE notebook_id = $1 AND user_id = $2 AND message_id = $3", [notebookId, userId, messageId]);
    return rows[0] ? MessageFeedbackSchema.parse(rows[0].record) : null;
  }
  return feedbackStore.get(feedbackKey(notebookId, userId, messageId)) ?? null;
}

export async function persistPackageV22AssistantMessage(input: Parameters<typeof persistChatMessage>[1]) {
  return persistChatMessage(undefined, input);
}

// Memory double only: drop a deleted notebook's records (PostgreSQL cascades from `notebooks`). Saved responses
// live in the Package 2.3 notes store (`notes.ts`), the single store behind the shared save-note route (FR-NM-02).
onNotebookForgotten((notebookId) => {
  for (const store of [guideStore, configStore, feedbackStore, followUpStore] as Map<string, unknown>[]) {
    for (const key of store.keys()) if (key.startsWith(`${notebookId}:`)) store.delete(key);
  }
  for (const [key, overview] of overviewStore) if (overview.notebook_id === notebookId) overviewStore.delete(key);
});
