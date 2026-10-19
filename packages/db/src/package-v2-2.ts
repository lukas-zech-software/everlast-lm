import { createHash, randomUUID } from "node:crypto";
import type {
  ChatConfiguration,
  MessageFeedback,
  MessageFeedbackInput,
  NotebookOverview,
  SavedResponseNote,
  SourceGuide,
} from "@everlast/contracts";
import { ChatConfigurationSchema, ChatMessageSchema, MessageFeedbackSchema, NotebookOverviewSchema, SavedResponseNoteSchema, SourceGuideSchema } from "@everlast/contracts";
import { getChatMessages, persistChatMessage } from "./chat-history.js";

const guideStore = new Map<string, SourceGuide>();
const overviewStore = new Map<string, NotebookOverview>();
const configStore = new Map<string, ChatConfiguration>();
const feedbackStore = new Map<string, MessageFeedback>();
const noteStore = new Map<string, SavedResponseNote>();
const noteIdempotency = new Map<string, string>();
const noteOperations = new Map<string, Promise<SavedResponseNote>>();

const guideKey = (notebookId: string, sourceId: string, revision: number) => `${notebookId}:${sourceId}:${revision}`;
const authorizationKey = (userId: string) => createHash("sha256").update(userId).digest("hex");
const settingKey = (notebookId: string, userId: string) => `${notebookId}:${userId}`;
const feedbackKey = (notebookId: string, userId: string, messageId: string) => `${notebookId}:${userId}:${messageId}`;
const noteKey = (userId: string, messageId: string) => `${userId}:${messageId}`;

export function resetPackageV22Store(): void {
  guideStore.clear();
  overviewStore.clear();
  configStore.clear();
  feedbackStore.clear();
  noteStore.clear();
  noteIdempotency.clear();
  noteOperations.clear();
}

export async function getSourceGuide(notebookId: string, sourceId: string, revision: number): Promise<SourceGuide | null> {
  return guideStore.get(guideKey(notebookId, sourceId, revision)) ?? null;
}

export async function saveSourceGuide(guide: SourceGuide): Promise<SourceGuide> {
  const validated = SourceGuideSchema.parse(guide);
  guideStore.set(guideKey(validated.notebook_id, validated.source_id, validated.revision), validated);
  return validated;
}

export async function deleteSourceGuides(notebookId: string, sourceId: string): Promise<void> {
  for (const [key, guide] of guideStore) {
    if (guide.notebook_id === notebookId && guide.source_id === sourceId) guideStore.delete(key);
  }
}

export async function getOverview(cacheKey: string): Promise<NotebookOverview | null> {
  return overviewStore.get(cacheKey) ?? null;
}

export async function getOverviewForUser(cacheKey: string, userId: string): Promise<NotebookOverview | null> {
  const overview = overviewStore.get(cacheKey);
  return overview?.authorization_key === authorizationKey(userId) ? overview : null;
}

export async function saveOverview(overview: NotebookOverview): Promise<NotebookOverview> {
  const validated = NotebookOverviewSchema.parse(overview);
  overviewStore.set(validated.cache_key, validated);
  return validated;
}

export async function getChatConfiguration(notebookId: string, userId: string): Promise<ChatConfiguration> {
  return configStore.get(settingKey(notebookId, userId)) ?? { style: "default", response_length: "default" };
}

export async function saveChatConfiguration(notebookId: string, userId: string, config: ChatConfiguration): Promise<ChatConfiguration> {
  const validated = ChatConfigurationSchema.parse(config);
  configStore.set(settingKey(notebookId, userId), validated);
  return validated;
}

export async function saveMessageFeedback(input: MessageFeedbackInput & { notebook_id: string; user_id: string }): Promise<MessageFeedback> {
  const messages = await getChatMessages(undefined, input.notebook_id, input.user_id);
  const message = messages.find((candidate) => candidate.id === input.message_id);
  if (!message || message.role !== "assistant") throw new Error("Assistant message not found for user in notebook");
  const validated = MessageFeedbackSchema.parse({ ...input, created_at: new Date().toISOString() });
  feedbackStore.set(feedbackKey(input.notebook_id, input.user_id, input.message_id), validated);
  return validated;
}

export async function getMessageFeedback(notebookId: string, userId: string, messageId: string): Promise<MessageFeedback | null> {
  return feedbackStore.get(feedbackKey(notebookId, userId, messageId)) ?? null;
}

export function saveResponseNote(input: { notebook_id: string; message_id: string; user_id: string }): Promise<SavedResponseNote> {
  const key = noteKey(input.user_id, input.message_id);
  const existingId = noteIdempotency.get(key);
  if (existingId) return Promise.resolve(noteStore.get(existingId)!);
  const pending = noteOperations.get(key);
  if (pending) return pending;
  const operation = (async () => {
    const messages = await getChatMessages(undefined, input.notebook_id, input.user_id);
    const message = messages.find((candidate) => candidate.id === input.message_id);
    if (!message || message.role !== "assistant") throw new Error("Assistant message not found for user in notebook");
    const validatedMessage = ChatMessageSchema.parse(message);
    const messageIndex = messages.findIndex((candidate) => candidate.id === input.message_id);
    const prompt = messages.slice(0, messageIndex).reverse().find((candidate) => candidate.role === "user")?.content ?? "";
    const title = Array.from(prompt.trim().split(/\s+/).slice(0, 7).join(" ") || "Saved response").slice(0, 200).join("");
    const note = SavedResponseNoteSchema.parse({
      id: randomUUID(),
      notebook_id: input.notebook_id,
      source_message_id: validatedMessage.id,
      title,
      content_md: validatedMessage.content,
      citations_json: validatedMessage.citations ?? [],
      origin_type: "saved_response",
      read_only: true,
      created_at: new Date().toISOString(),
    });
    noteStore.set(note.id, note);
    noteIdempotency.set(key, note.id);
    return note;
  })();
  noteOperations.set(key, operation);
  void operation.finally(() => noteOperations.delete(key)).catch(() => undefined);
  return operation;
}

export async function getSavedResponseNote(userId: string, messageId: string): Promise<SavedResponseNote | null> {
  const id = noteIdempotency.get(noteKey(userId, messageId));
  return id ? noteStore.get(id) ?? null : null;
}

export async function deleteSavedResponseNote(userId: string, messageId: string): Promise<void> {
  const key = noteKey(userId, messageId);
  const id = noteIdempotency.get(key);
  if (id) noteStore.delete(id);
  noteIdempotency.delete(key);
}

export async function persistPackageV22AssistantMessage(input: Parameters<typeof persistChatMessage>[1]) {
  return persistChatMessage(undefined, input);
}
