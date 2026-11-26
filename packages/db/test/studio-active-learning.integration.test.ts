import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createNotebook,
  PostgresLearningProgressRepository,
  PostgresStudioArtifactRepository,
  sweepInterruptedStudioArtifacts,
} from "../src/index.ts";
import {
  createTestDatabase,
  createTestUser,
  seedReadySource,
  type TestDatabase,
} from "../src/testing.ts";

/**
 * [014-studio-active-learning-suite] T004 — PostgreSQL migration 0013 and LearningProgress integration tests
 * (FR-ST-12..15, C-03, NFR-SEC-02, Gate v4.0 #2).
 */

let db: TestDatabase;
let dropDb: (() => Promise<void>) | undefined;
let artifacts: PostgresStudioArtifactRepository;
let progressRepo: PostgresLearningProgressRepository;

beforeAll(async () => {
  db = await createTestDatabase();
  dropDb = () => db.drop();
  artifacts = new PostgresStudioArtifactRepository(db.pool);
  progressRepo = new PostgresLearningProgressRepository(db.pool);
});

afterAll(async () => {
  await dropDb?.();
});

const ITEM_1 = "41000000-bbbb-4000-8000-000000000001";
const ITEM_2 = "41000000-bbbb-4000-8000-000000000002";

describe("[014-studio-active-learning-suite] T004: Migration 0013, durable Studio kinds, and per-user LearningProgress", () => {
  it("admits flashcards, quiz, and learning_overview with outbox jobs and excludes them from legacy report startup sweep", async () => {
    const owner = await createTestUser(db.pool);
    const nb = (await createNotebook(db.pool, owner, { title: "v4.1 Integration NB" })).notebook.id;
    const seeded = await seedReadySource(db.pool, owner, nb, {
      title: "Policy.txt",
      mediaType: "text/plain",
      pages: ["The maximum payload size is 200 megabytes."],
      embed: (texts) => Promise.resolve(texts.map(() => Array.from({ length: 768 }, () => 0.01))),
    });
    const snapshot = [{ source_id: seeded.sourceId, revision: 1 }];

    const fc = await artifacts.createQueued({
      notebook_id: nb,
      owner_id: owner,
      plugin_type: "flashcards",
      subtype: "default",
      title: "Flashcards",
      params_json: { difficulty: "medium", card_count: "standard" },
      snapshot,
      enqueueOutbox: true,
    });
    const qz = await artifacts.createQueued({
      notebook_id: nb,
      owner_id: owner,
      plugin_type: "quiz",
      subtype: "default",
      title: "Quiz",
      params_json: { difficulty: "medium", question_count: 10 },
      snapshot,
      enqueueOutbox: true,
    });
    const lo = await artifacts.createQueued({
      notebook_id: nb,
      owner_id: owner,
      plugin_type: "learning_overview",
      subtype: "default",
      title: "Learning Overview",
      params_json: { section_count: 3 },
      snapshot,
      enqueueOutbox: true,
    });
    expect(fc.plugin_type).toBe("flashcards");
    expect(qz.plugin_type).toBe("quiz");
    expect(lo.plugin_type).toBe("learning_overview");

    await db.pool.query(
      "UPDATE studio_artifacts SET updated_at = now() - interval '2 minutes' WHERE id = ANY($1::uuid[])",
      [[fc.id, qz.id, lo.id]],
    );
    await sweepInterruptedStudioArtifacts(db.pool);

    expect((await artifacts.getById(fc.id))?.status).toBe("Queued");
    expect((await artifacts.getById(qz.id))?.status).toBe("Queued");
    expect((await artifacts.getById(lo.id))?.status).toBe("Queued");
  });

  it("persists per-user LearningProgress atomically, isolates across users, resets cleanly, and cascades on artifact delete", async () => {
    const userA = await createTestUser(db.pool);
    const userB = await createTestUser(db.pool);
    const nb = (await createNotebook(db.pool, userA, { title: "Progress NB" })).notebook.id;
    const seeded = await seedReadySource(db.pool, userA, nb, {
      title: "Guide.txt",
      mediaType: "text/plain",
      pages: ["Active learning strengthens retention."],
      embed: (texts) => Promise.resolve(texts.map(() => Array.from({ length: 768 }, () => 0.01))),
    });

    const quiz = await artifacts.createQueued({
      notebook_id: nb,
      owner_id: userA,
      plugin_type: "quiz",
      subtype: "default",
      title: "Quiz",
      params_json: { question_count: 5 },
      snapshot: [{ source_id: seeded.sourceId, revision: 1 }],
    });

    const r1 = await progressRepo.recordAttempt({
      userId: userA,
      artifactId: quiz.id,
      notebookId: nb,
      itemId: ITEM_1,
      outcome: "needs_review",
    });
    expect(r1.item_states_json[ITEM_1]?.status).toBe("needs_review");
    expect(r1.item_states_json[ITEM_1]?.attempts).toBe(1);

    const r2 = await progressRepo.recordAttempt({
      userId: userA,
      artifactId: quiz.id,
      notebookId: nb,
      itemId: ITEM_1,
      outcome: "mastered",
    });
    expect(r2.item_states_json[ITEM_1]?.status).toBe("mastered");
    expect(r2.item_states_json[ITEM_1]?.attempts).toBe(2);

    await progressRepo.recordAttempt({
      userId: userA,
      artifactId: quiz.id,
      notebookId: nb,
      itemId: ITEM_2,
      outcome: "needs_review",
    });

    // User B remains isolated
    await progressRepo.recordAttempt({
      userId: userB,
      artifactId: quiz.id,
      notebookId: nb,
      itemId: ITEM_1,
      outcome: "needs_review",
    });

    // Reset clears ONLY User A
    const afterReset = await progressRepo.reset(userA, quiz.id);
    expect(afterReset.item_states_json).toEqual({});
    const userBState = await progressRepo.get(userB, quiz.id);
    expect(userBState?.item_states_json[ITEM_1]?.status).toBe("needs_review");

    // Deleting artifact cascades learning_progress rows
    await artifacts.delete(nb, userA, quiz.id);
    expect(await progressRepo.get(userB, quiz.id)).toBeNull();
  });
});
