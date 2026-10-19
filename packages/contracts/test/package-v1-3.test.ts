import { describe, it, expect } from "vitest";
import {
  ChatRoleSchema,
  CitationSchema,
  UserMessageInputSchema,
  ActiveSourceRevisionRecordSchema,
  ChatMessageSchema,
  ChatThreadSchema,
  type Citation,
  type ChatMessage,
  type ChatThread,
  type UserMessageInput,
} from "../src/package-v1-3.ts";

describe("FR-GC-01, FR-GC-02, FR-GC-03, FR-GC-06: Package 1.3 Contracts", () => {
  const validUuid1 = "11111111-1111-4111-8111-111111111111";
  const validUuid2 = "22222222-2222-4222-8222-222222222222";
  const validUuid3 = "33333333-3333-4333-8333-333333333333";
  const validChunkId = "018f6b40-0001-7000-8000-000000000001";

  describe("1. UserMessageInputSchema (FR-GC-01)", () => {
    it("P13-01: accepts valid user message input with 1 code point", () => {
      const input: UserMessageInput = {
        notebook_id: validUuid1,
        message: "a",
        active_source_ids: [validUuid2],
      };
      const parsed = UserMessageInputSchema.parse(input);
      expect(parsed.message).toBe("a");
      expect(parsed.active_source_ids).toEqual([validUuid2]);
    });

    it("P13-02: accepts user message with whitespace trimmed and single emoji (1 code point)", () => {
      const input = {
        notebook_id: validUuid1,
        message: "   🌟   ",
        active_source_ids: [validUuid2],
      };
      const parsed = UserMessageInputSchema.parse(input);
      expect(parsed.message).toBe("🌟");
    });

    it("P13-03: accepts user message with exactly 10,000 ASCII code points", () => {
      const input = {
        notebook_id: validUuid1,
        message: "x".repeat(10000),
        active_source_ids: [validUuid2],
      };
      const parsed = UserMessageInputSchema.parse(input);
      expect(Array.from(parsed.message).length).toBe(10000);
    });

    it("P13-04: accepts user message with exactly 10,000 multi-byte Unicode code points (emojis)", () => {
      // 10,000 astral symbols (UTF-16 length is 20,000, but code points count is 10,000)
      const emojis = "🌟".repeat(10000);
      const input = {
        notebook_id: validUuid1,
        message: `   ${emojis}   `,
        active_source_ids: [validUuid2],
      };
      const parsed = UserMessageInputSchema.parse(input);
      expect(Array.from(parsed.message).length).toBe(10000);
    });

    it("P13-05: rejects message with 0 code points after outer trimming", () => {
      expect(() =>
        UserMessageInputSchema.parse({
          notebook_id: validUuid1,
          message: "",
          active_source_ids: [validUuid2],
        })
      ).toThrow();

      expect(() =>
        UserMessageInputSchema.parse({
          notebook_id: validUuid1,
          message: "    \t\n   ",
          active_source_ids: [validUuid2],
        })
      ).toThrow();
    });

    it("P13-06: rejects message exceeding 10,000 code points (10,001 ASCII code points)", () => {
      expect(() =>
        UserMessageInputSchema.parse({
          notebook_id: validUuid1,
          message: "x".repeat(10001),
          active_source_ids: [validUuid2],
        })
      ).toThrow();
    });

    it("P13-07: rejects message exceeding 10,000 code points (10,001 Unicode emojis)", () => {
      const overLimitEmojis = "🌟".repeat(10001);
      expect(() =>
        UserMessageInputSchema.parse({
          notebook_id: validUuid1,
          message: overLimitEmojis,
          active_source_ids: [validUuid2],
        })
      ).toThrow();
    });

    it("P13-08: rejects active_source_ids with empty array (must have at least 1)", () => {
      expect(() =>
        UserMessageInputSchema.parse({
          notebook_id: validUuid1,
          message: "Valid question",
          active_source_ids: [],
        })
      ).toThrow();
    });

    it("P13-09: rejects invalid UUID in active_source_ids", () => {
      expect(() =>
        UserMessageInputSchema.parse({
          notebook_id: validUuid1,
          message: "Valid question",
          active_source_ids: ["not-a-uuid"],
        })
      ).toThrow();
    });

    it("P13-10: rejects non-UUID notebook_id", () => {
      expect(() =>
        UserMessageInputSchema.parse({
          notebook_id: "not-a-uuid",
          message: "Valid question",
          active_source_ids: [validUuid2],
        })
      ).toThrow();
    });

    it("P13-11: rejects extra unknown fields on UserMessageInput (strict schema)", () => {
      expect(() =>
        UserMessageInputSchema.parse({
          notebook_id: validUuid1,
          message: "Valid question",
          active_source_ids: [validUuid2],
          extra_prop: "not_allowed",
        })
      ).toThrow();
    });
  });

  describe("2. CitationSchema (FR-GC-02, FR-GC-03)", () => {
    const validCitation: Citation = {
      badge_number: 1,
      source_id: validUuid1,
      source_title: "Architecture Guide.pdf",
      chunk_id: validChunkId,
      snippet: "Grounded chat derives answers exclusively from active sources.",
      locator: {
        page_number: 3,
        start_offset: 120,
        end_offset: 350,
      },
    };

    it("P13-12: accepts valid citation with page_span locator", () => {
      const parsed = CitationSchema.parse(validCitation);
      expect(parsed).toEqual(validCitation);
    });

    it("P13-13: accepts valid citation with dom_path locator", () => {
      const domCitation = {
        ...validCitation,
        locator: {
          selector: "article > section#intro",
          start_offset: 0,
          end_offset: 100,
        },
      };
      const parsed = CitationSchema.parse(domCitation);
      expect(parsed.locator).toEqual(domCitation.locator);
    });

    it("P13-14: accepts valid citation with time_span locator", () => {
      const timeCitation = {
        ...validCitation,
        locator: {
          start_ms: 1000,
          end_ms: 5000,
        },
      };
      const parsed = CitationSchema.parse(timeCitation);
      expect(parsed.locator).toEqual(timeCitation.locator);
    });

    it("P13-15: rejects non-positive badge_number (0, negative, or float)", () => {
      expect(() =>
        CitationSchema.parse({ ...validCitation, badge_number: 0 })
      ).toThrow();
      expect(() =>
        CitationSchema.parse({ ...validCitation, badge_number: -1 })
      ).toThrow();
      expect(() =>
        CitationSchema.parse({ ...validCitation, badge_number: 1.5 })
      ).toThrow();
    });

    it("P13-16: rejects non-UUID source_id and chunk_id", () => {
      expect(() =>
        CitationSchema.parse({ ...validCitation, source_id: "invalid-id" })
      ).toThrow();
      expect(() =>
        CitationSchema.parse({ ...validCitation, chunk_id: "invalid-chunk" })
      ).toThrow();
    });

    it("P13-17: rejects empty source_title or snippet", () => {
      expect(() =>
        CitationSchema.parse({ ...validCitation, source_title: "" })
      ).toThrow();
      expect(() =>
        CitationSchema.parse({ ...validCitation, snippet: "" })
      ).toThrow();
    });

    it("P13-18: rejects invalid locator where end_offset < start_offset", () => {
      expect(() =>
        CitationSchema.parse({
          ...validCitation,
          locator: {
            page_number: 1,
            start_offset: 200,
            end_offset: 100,
          },
        })
      ).toThrow();
    });

    it("P13-19: rejects extra unknown fields on Citation (strict schema)", () => {
      expect(() =>
        CitationSchema.parse({
          ...validCitation,
          extra_metadata: "forbidden",
        })
      ).toThrow();
    });
  });

  describe("3. ChatMessageSchema (FR-GC-01, FR-GC-06)", () => {
    const validMessage: ChatMessage = {
      id: validUuid1,
      thread_id: validUuid2,
      notebook_id: validUuid3,
      user_id: "usr_alice_456",
      role: "assistant",
      content: "Here is the verified answer based on your documents [1].",
      active_source_revisions_snapshot: [
        {
          source_id: validUuid1,
          revision: 1,
        },
      ],
      citations: [
        {
          badge_number: 1,
          source_id: validUuid1,
          source_title: "Doc.pdf",
          chunk_id: validChunkId,
          snippet: "Snippet text",
          locator: {
            page_number: 1,
            start_offset: 0,
            end_offset: 50,
          },
        },
      ],
      created_at: "2026-10-18T12:00:00.000Z",
    };

    it("P13-20: accepts valid assistant chat message with citations", () => {
      const parsed = ChatMessageSchema.parse(validMessage);
      expect(parsed.role).toBe("assistant");
      expect(parsed.citations).toHaveLength(1);
    });

    it("P13-21: accepts valid user chat message with default empty citations", () => {
      const userMessage = {
        id: validUuid1,
        thread_id: validUuid2,
        notebook_id: validUuid3,
        user_id: "usr_alice_456",
        role: "user",
        content: "What does the doc say?",
        active_source_revisions_snapshot: [],
        created_at: "2026-10-18T12:00:00.000Z",
      };
      const parsed = ChatMessageSchema.parse(userMessage);
      expect(parsed.role).toBe("user");
      expect(parsed.citations).toEqual([]);
    });

    it("P13-22: rejects invalid chat role (e.g. system or admin)", () => {
      expect(() =>
        ChatMessageSchema.parse({ ...validMessage, role: "system" })
      ).toThrow();
      expect(() =>
        ChatMessageSchema.parse({ ...validMessage, role: "admin" })
      ).toThrow();
    });

    it("P13-23: rejects non-UUID IDs (id, thread_id, notebook_id)", () => {
      expect(() =>
        ChatMessageSchema.parse({ ...validMessage, id: "bad-id" })
      ).toThrow();
      expect(() =>
        ChatMessageSchema.parse({ ...validMessage, thread_id: "bad-thread" })
      ).toThrow();
      expect(() =>
        ChatMessageSchema.parse({ ...validMessage, notebook_id: "bad-notebook" })
      ).toThrow();
    });

    it("P13-24: rejects non-positive revision in active_source_revisions_snapshot", () => {
      expect(() =>
        ChatMessageSchema.parse({
          ...validMessage,
          active_source_revisions_snapshot: [
            { source_id: validUuid1, revision: 0 },
          ],
        })
      ).toThrow();

      expect(() =>
        ChatMessageSchema.parse({
          ...validMessage,
          active_source_revisions_snapshot: [
            { source_id: validUuid1, revision: -2 },
          ],
        })
      ).toThrow();
    });

    it("P13-25: rejects invalid ISO datetime in created_at", () => {
      expect(() =>
        ChatMessageSchema.parse({ ...validMessage, created_at: "2026-10-18 12:00:00" })
      ).toThrow();
    });

    it("P13-26: rejects extra unknown fields on ChatMessage (strict schema)", () => {
      expect(() =>
        ChatMessageSchema.parse({
          ...validMessage,
          unexpected_column: true,
        })
      ).toThrow();
    });
  });

  describe("4. ChatThreadSchema (FR-GC-06)", () => {
    const validThread: ChatThread = {
      id: validUuid1,
      notebook_id: validUuid2,
      user_id: "usr_alice_456",
      generation_epoch: 0,
      created_at: "2026-10-18T12:00:00.000Z",
      updated_at: "2026-10-18T12:00:00.000Z",
    };

    it("P13-27: accepts valid chat thread with generation_epoch 0", () => {
      const parsed = ChatThreadSchema.parse(validThread);
      expect(parsed.generation_epoch).toBe(0);
    });

    it("P13-28: accepts incremented generation_epoch after clear chat", () => {
      const parsed = ChatThreadSchema.parse({
        ...validThread,
        generation_epoch: 4,
      });
      expect(parsed.generation_epoch).toBe(4);
    });

    it("P13-29: rejects negative generation_epoch or float", () => {
      expect(() =>
        ChatThreadSchema.parse({ ...validThread, generation_epoch: -1 })
      ).toThrow();
      expect(() =>
        ChatThreadSchema.parse({ ...validThread, generation_epoch: 1.5 })
      ).toThrow();
    });

    it("P13-30: rejects non-UUID id or notebook_id", () => {
      expect(() =>
        ChatThreadSchema.parse({ ...validThread, id: "invalid-uuid" })
      ).toThrow();
      expect(() =>
        ChatThreadSchema.parse({ ...validThread, notebook_id: "invalid-uuid" })
      ).toThrow();
    });

    it("P13-31: rejects empty user_id", () => {
      expect(() =>
        ChatThreadSchema.parse({ ...validThread, user_id: "" })
      ).toThrow();
    });

    it("P13-32: rejects invalid created_at or updated_at timestamps", () => {
      expect(() =>
        ChatThreadSchema.parse({
          ...validThread,
          created_at: "not-a-timestamp",
        })
      ).toThrow();
      expect(() =>
        ChatThreadSchema.parse({
          ...validThread,
          updated_at: "not-a-timestamp",
        })
      ).toThrow();
    });

    it("P13-33: rejects extra unknown fields on ChatThread (strict schema)", () => {
      expect(() =>
        ChatThreadSchema.parse({
          ...validThread,
          unknown_field: 999,
        })
      ).toThrow();
    });
  });
});
