import { claimTopicIconSelection, setTopicIconIfDefault } from "@everlast/db";
import type { TopicEmojiSelector } from "./ingestion/topic-emoji.ts";

/**
 * Release v2 follow-up work after a source reaches Ready (FR-WM-02 topic icon, FR-SI-02 Source Guide).
 * Decorative and derived outputs: a failing hook never changes the ingestion outcome. In the v2 proof of
 * concept the API process runs these hooks (their stores are in memory, D16).
 */

export interface ReadySourceEvent {
  notebook_id: string;
  source_id: string;
  revision_id: number;
  title: string;
  media_type: string;
  /** Observed `Ready` transition (source `updated_at` when it became Ready); Source Guide latency starts here (FR-018). */
  ready_at?: string | undefined;
}

export type ReadySourceHook = (event: ReadySourceEvent) => Promise<unknown>;

/** First Ready source of a notebook with a default icon: ask the selector once for a topic emoji. */
export async function applyTopicIcon(event: ReadySourceEvent, selector: TopicEmojiSelector): Promise<boolean> {
  try {
    if (!(await claimTopicIconSelection(event.notebook_id))) return false;
    const icon = await selector.suggest({ title: event.title, mediaType: event.media_type });
    return icon ? await setTopicIconIfDefault(event.notebook_id, icon) : false;
  } catch {
    return false;
  }
}

/** Runs every hook once per (source, revision), in the background, swallowing hook failures. */
export function createReadySourceDispatcher(hooks: ReadySourceHook[]): (event: ReadySourceEvent) => Promise<void> {
  const seen = new Set<string>();
  return async (event) => {
    const key = `${event.notebook_id}:${event.source_id}:${event.revision_id}`;
    if (seen.has(key)) return;
    seen.add(key);
    await Promise.all(hooks.map((hook) => hook(event).catch(() => undefined)));
  };
}
