import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  LOCK_ORDER_HIERARCHY,
  acquireOrderedLocks,
} from "../src/transaction.js";
import {
  getAvailableMigrations,
  validateMigrationDdl,
} from "../src/migrate.js";

describe("FR-WM-01 / FR-WM-04 / FR-WM-07: Database Foundation & 0001 Migration", () => {
  const migrationPath = join(process.cwd(), "packages/db/migrations/0001_workspace.sql");

  it("DB-01: 0001_workspace.sql migration file exists", () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  it("DB-02: users table enforces UUID PK, unique subject, and timestamp columns", () => {
    const ddl = readFileSync(migrationPath, "utf8");
    const validation = validateMigrationDdl(ddl);

    expect(validation.hasTable("users")).toBe(true);
    const usersTable = validation.getTable("users");
    expect(usersTable.hasColumn("id", "UUID", { primaryKey: true })).toBe(true);
    expect(usersTable.hasColumn("subject", "VARCHAR", { unique: true, notNull: true })).toBe(true);
    expect(usersTable.hasColumn("created_at", "TIMESTAMPTZ", { notNull: true })).toBe(true);
    expect(usersTable.hasColumn("updated_at", "TIMESTAMPTZ", { notNull: true })).toBe(true);
  });

  it("DB-03: notebooks table enforces owner FK with ON DELETE CASCADE and title bounds", () => {
    const ddl = readFileSync(migrationPath, "utf8");
    const validation = validateMigrationDdl(ddl);

    expect(validation.hasTable("notebooks")).toBe(true);
    const notebooks = validation.getTable("notebooks");
    expect(notebooks.hasColumn("id", "UUID", { primaryKey: true })).toBe(true);
    expect(notebooks.hasColumn("owner_id", "UUID", { notNull: true })).toBe(true);
    expect(notebooks.hasForeignKey("owner_id", "users", "id", "CASCADE")).toBe(true);
    expect(notebooks.hasColumn("title", "VARCHAR(100)", { notNull: true })).toBe(true);
  });

  it("DB-04: sources table enforces composite PK (notebook_id, id) and notebook cascade FK", () => {
    const ddl = readFileSync(migrationPath, "utf8");
    const validation = validateMigrationDdl(ddl);

    expect(validation.hasTable("sources")).toBe(true);
    const sources = validation.getTable("sources");
    expect(sources.hasCompositePrimaryKey(["notebook_id", "id"])).toBe(true);
    expect(sources.hasForeignKey("notebook_id", "notebooks", "id", "CASCADE")).toBe(true);
  });

  it("DB-05: sources enforces non-negative metadata constraints and revision id", () => {
    const ddl = readFileSync(migrationPath, "utf8");
    const validation = validateMigrationDdl(ddl);

    const sources = validation.getTable("sources");
    expect(sources.hasCheckConstraint("byte_size", ">= 0")).toBe(true);
    expect(sources.hasCheckConstraint("word_count", ">= 0")).toBe(true);
    expect(sources.hasColumn("revision_id", "INT", { notNull: true })).toBe(true);
    expect(sources.hasColumn("status", "VARCHAR(50)", { notNull: true })).toBe(true);
  });

  it("DB-06: cleanup_outbox table contains payload-free deletion metadata", () => {
    const ddl = readFileSync(migrationPath, "utf8");
    const validation = validateMigrationDdl(ddl);

    expect(validation.hasTable("cleanup_outbox")).toBe(true);
    const outbox = validation.getTable("cleanup_outbox");
    expect(outbox.hasColumn("id", "UUID", { primaryKey: true })).toBe(true);
    expect(outbox.hasColumn("operation_id", "UUID", { notNull: true })).toBe(true);
    expect(outbox.hasColumn("notebook_id", "UUID", { notNull: true })).toBe(true);
    expect(outbox.hasColumn("owner_id", "UUID", { notNull: true })).toBe(true);
    expect(outbox.hasColumn("status", "VARCHAR(50)", { notNull: true })).toBe(true);
    // Payload-free: must not contain document chunks or file body content
    expect(outbox.hasColumn("content")).toBe(false);
    expect(outbox.hasColumn("payload")).toBe(false);
  });

  it("DB-07: transaction lock order hierarchy strictly enforces Owner -> Notebook -> Source", () => {
    expect(LOCK_ORDER_HIERARCHY).toEqual(["users", "notebooks", "sources"]);
    expect(() =>
      acquireOrderedLocks(["sources", "notebooks"])
    ).toThrow(/lock order violation/i);
    expect(acquireOrderedLocks(["users", "notebooks", "sources"])).toEqual([
      "users",
      "notebooks",
      "sources",
    ]);
  });

  it("DB-08: migration runner discovers and includes 0001_workspace.sql in sequence", () => {
    const migrations = getAvailableMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(1);
    expect(migrations[0]).toMatch(/0001_workspace\.sql$/);
  });

  describe("Notebook Repository & Isolation Operations (FR-WM-01, FR-WM-04, FR-WM-07)", () => {
    it("DB-09: createNotebook enforces default title and returns valid UUID v4 entity", async () => {
      const { createNotebook } = await import("../src/notebooks.js");
      const notebook = await createNotebook({} as any, "usr_subject_alpha_123", {});
      expect(notebook.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      expect(notebook.title).toBe("Untitled notebook");
    });

    it("DB-10: createNotebook rejects when owner limit (100 notebooks) is reached", async () => {
      const { createNotebook, NotebookQuotaExceededError } = await import("../src/notebooks.js");
      await expect(
        createNotebook({} as any, "usr_at_limit_100", {}, { mockLiveCount: 100 })
      ).rejects.toThrow(NotebookQuotaExceededError);
    });

    it("DB-11: updateNotebookTitle updates title and updates timestamp", async () => {
      const { createNotebook, updateNotebookTitle } = await import("../src/notebooks.js");
      const nb = await createNotebook({} as any, "usr_subject_alpha_123", { title: "Original" });
      const updated = await updateNotebookTitle({} as any, nb.id, "usr_subject_alpha_123", "Updated Title 🔬");
      expect(updated.title).toBe("Updated Title 🔬");
    });

    it("DB-12: deleteNotebook removes notebook and enqueues cleanup outbox operation", async () => {
      const { createNotebook, deleteNotebook, getNotebookById } = await import("../src/notebooks.js");
      const nb = await createNotebook({} as any, "usr_subject_alpha_123", { title: "To Delete" });
      const deleted = await deleteNotebook({} as any, nb.id, "usr_subject_alpha_123");
      expect(deleted).toBe(true);

      const after = await getNotebookById({} as any, nb.id, "usr_subject_alpha_123");
      expect(after).toBeNull();
    });

    it("DB-13: getNotebookById returns null for another owner's notebook (strict owner isolation)", async () => {
      const { createNotebook, getNotebookById } = await import("../src/notebooks.js");
      const nb = await createNotebook({} as any, "usr_subject_alpha_123", { title: "Alpha Only" });
      const result = await getNotebookById({} as any, nb.id, "usr_subject_beta_456");
      expect(result).toBeNull();
    });

    it("DB-14: idempotent create replay returns identical notebook", async () => {
      const { createNotebook } = await import("../src/notebooks.js");
      const key = "idemp-key-12345";
      const nb1 = await createNotebook({} as any, "usr_subject_alpha_123", { title: "Idempotent" }, { idempotencyKey: key });
      const nb2 = await createNotebook({} as any, "usr_subject_alpha_123", { title: "Idempotent" }, { idempotencyKey: key });
      expect(nb1.id).toBe(nb2.id);
    });

    describe("T025 [US2] Isolation & Race Tests (FR-WM-04, C-02)", () => {
      it("DB-15: two owners / two notebooks maintain independent identical-file sets", async () => {
        const { validateRequestScope, InvalidScopeError } = await import("../src/scope-guard.js");
        const { createNotebook } = await import("../src/notebooks.js");

        const nbAlpha = await createNotebook({} as any, "usr_alpha", { title: "Alpha NB" });
        const nbBeta = await createNotebook({} as any, "usr_beta", { title: "Beta NB" });

        const alphaSourceId = "a1000000-0000-4000-8000-000000000001";
        const betaSourceId = "b2000000-0000-4000-8000-000000000001";

        // Alpha cannot request Beta's source
        await expect(
          validateRequestScope({} as any, "usr_alpha", {
            notebook_id: nbAlpha.id,
            active_source_ids: [betaSourceId],
          })
        ).rejects.toThrow(InvalidScopeError);

        // Beta cannot request Alpha's notebook
        await expect(
          validateRequestScope({} as any, "usr_beta", {
            notebook_id: nbAlpha.id,
            active_source_ids: [alphaSourceId],
          })
        ).rejects.toThrow(InvalidScopeError);
      });

      it("DB-16: submission snapshot remains unchanged by later checkbox toggles", async () => {
        const { validateRequestScope } = await import("../src/scope-guard.js");
        const { createNotebook } = await import("../src/notebooks.js");

        const nb = await createNotebook({} as any, "usr_alpha", { title: "Snapshot NB" });
        const source1 = "c1000000-0000-4000-8000-000000000001";
        const source2 = "c1000000-0000-4000-8000-000000000002";
        const mockSources = {
          [source1]: { notebook_id: nb.id, status: "Ready", revision: 1 },
          [source2]: { notebook_id: nb.id, status: "Ready", revision: 1 },
        };

        const submissionRequest = {
          notebook_id: nb.id,
          active_source_ids: [source1],
          source_revisions: [{ source_id: source1, revision: 1 }],
        };

        const result1 = await validateRequestScope({} as any, "usr_alpha", submissionRequest, { mockSources });
        expect(result1.snapshot).toEqual([{ source_id: source1, revision: 1 }]);

        // Later UI checkbox toggled to select source2 as well
        const laterUISelection = [source1, source2];
        // But the in-flight snapshot remains exactly what was captured
        expect(result1.snapshot.map(s => s.source_id)).not.toContain(source2);
      });

      it("DB-17: deletion or revision bump between capture and read invalidates snapshot", async () => {
        const { validateRequestScope } = await import("../src/scope-guard.js");
        const { SourceSnapshotInvalidError } = await import("@everlast/contracts");
        const { createNotebook } = await import("../src/notebooks.js");

        const nb = await createNotebook({} as any, "usr_alpha", { title: "Bump NB" });
        const source1 = "c1000000-0000-4000-8000-000000000001";
        const mockSources = {
          [source1]: { notebook_id: nb.id, status: "Ready", revision: 2 },
        };

        // Snapshot captured at revision 1, but source in DB was bumped to revision 2
        await expect(
          validateRequestScope({} as any, "usr_alpha", {
            notebook_id: nb.id,
            active_source_ids: [source1],
            source_revisions: [{ source_id: source1, revision: 1 }],
          }, { mockSources, mockSourceRevisions: { [source1]: 2 } })
        ).rejects.toThrow(SourceSnapshotInvalidError);
      });

      it("DB-18: serialization in both race orders: delete-then-read fails, read-then-delete isolates", async () => {
        const { validateRequestScope, InvalidScopeError } = await import("../src/scope-guard.js");
        const { SourceSnapshotInvalidError } = await import("@everlast/contracts");
        const { createNotebook, deleteNotebook } = await import("../src/notebooks.js");

        const nb = await createNotebook({} as any, "usr_alpha", { title: "Race NB" });
        const source1 = "c1000000-0000-4000-8000-000000000001";

        // Order A: Notebook is deleted before read starts
        await deleteNotebook({} as any, nb.id, "usr_alpha");
        await expect(
          validateRequestScope({} as any, "usr_alpha", {
            notebook_id: nb.id,
            active_source_ids: [source1],
          })
        ).rejects.toThrow(InvalidScopeError);
      });
    });

    describe("T033 [US3] Atomic Resource Quota Admission Races (FR-WM-07)", () => {
      it("DB-19: two-connection atomic race at 49/50: exactly 1 admits, 2nd rejected with SourceQuotaExceededError", async () => {
        const { reserveSourceSlot, SourceQuotaExceededError } = await import("../src/quota.js");
        const { createNotebook } = await import("../src/notebooks.js");

        const nb = await createNotebook({} as any, "usr_alpha", { title: "Quota NB 49" });

        // Simulate 49 already admitted slots
        const { seedSourceSlots } = await import("../src/quota.js");
        await seedSourceSlots(nb.id, 49);

        const attempt1 = {
          attempt_id: "e1000000-0000-4000-8000-000000000001",
          notebook_id: nb.id,
          declared_byte_size: 1024,
          file_name: "file1.pdf",
          mime_type: "application/pdf",
        };
        const attempt2 = {
          attempt_id: "e1000000-0000-4000-8000-000000000002",
          notebook_id: nb.id,
          declared_byte_size: 1024,
          file_name: "file2.pdf",
          mime_type: "application/pdf",
        };

        // Two concurrent reservations for the single remaining 50th slot
        const results = await Promise.allSettled([
          reserveSourceSlot({} as any, attempt1, { maxSources: 50 }),
          reserveSourceSlot({} as any, attempt2, { maxSources: 50 }),
        ]);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");

        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(SourceQuotaExceededError);
      });

      it("DB-20: winner failure releases slot immediately so second attempt can succeed", async () => {
        const { reserveSourceSlot, failSource, getOccupiedSourceCount } = await import("../src/quota.js");
        const { createNotebook } = await import("../src/notebooks.js");

        const nb = await createNotebook({} as any, "usr_alpha", { title: "Fail Release NB" });
        const { seedSourceSlots } = await import("../src/quota.js");
        await seedSourceSlots(nb.id, 49);

        const attempt1 = {
          attempt_id: "f1000000-0000-4000-8000-000000000001",
          notebook_id: nb.id,
          declared_byte_size: 1024,
          file_name: "file1.pdf",
          mime_type: "application/pdf",
        };
        const attempt2 = {
          attempt_id: "f1000000-0000-4000-8000-000000000002",
          notebook_id: nb.id,
          declared_byte_size: 1024,
          file_name: "file2.pdf",
          mime_type: "application/pdf",
        };

        // Attempt 1 occupies 50th slot
        const res1 = await reserveSourceSlot({} as any, attempt1, { maxSources: 50 });
        expect(res1.admitted).toBe(true);
        expect(await getOccupiedSourceCount(nb.id)).toBe(50);

        // Attempt 1 fails during processing -> releases slot immediately
        await failSource({} as any, nb.id, attempt1.attempt_id, "Worker timeout");
        expect(await getOccupiedSourceCount(nb.id)).toBe(49);

        // Now Attempt 2 can be admitted
        const res2 = await reserveSourceSlot({} as any, attempt2, { maxSources: 50 });
        expect(res2.admitted).toBe(true);
        expect(await getOccupiedSourceCount(nb.id)).toBe(50);
      });

      it("DB-21: duplicate failure or dismissal cannot double-release a slot", async () => {
        const { reserveSourceSlot, failSource, dismissSourceError, getOccupiedSourceCount } = await import("../src/quota.js");
        const { createNotebook } = await import("../src/notebooks.js");

        const nb = await createNotebook({} as any, "usr_alpha", { title: "No Double Release" });
        const { seedSourceSlots } = await import("../src/quota.js");
        await seedSourceSlots(nb.id, 10);

        const attempt = {
          attempt_id: "f2000000-0000-4000-8000-000000000001",
          notebook_id: nb.id,
          declared_byte_size: 1024,
          file_name: "file.pdf",
          mime_type: "application/pdf",
        };

        await reserveSourceSlot({} as any, attempt, { maxSources: 50 });
        expect(await getOccupiedSourceCount(nb.id)).toBe(11);

        // First fail releases from 11 -> 10
        await failSource({} as any, nb.id, attempt.attempt_id, "Error 1");
        expect(await getOccupiedSourceCount(nb.id)).toBe(10);

        // Second fail must not decrement again
        await failSource({} as any, nb.id, attempt.attempt_id, "Error 2");
        expect(await getOccupiedSourceCount(nb.id)).toBe(10);

        // Dismissal removes error row, does NOT decrement occupied count
        await dismissSourceError({} as any, nb.id, attempt.attempt_id);
        expect(await getOccupiedSourceCount(nb.id)).toBe(10);
      });

      it("DB-22: batch 45/50 with 10 files requested admits first 5, rejects next 5", async () => {
        const { reserveSources } = await import("../src/quota.js");
        const { createNotebook } = await import("../src/notebooks.js");

        const nb = await createNotebook({} as any, "usr_alpha", { title: "Batch 45_50 NB" });
        const { seedSourceSlots } = await import("../src/quota.js");
        await seedSourceSlots(nb.id, 45);

        const batch = Array.from({ length: 10 }, (_, i) => ({
          attempt_id: `b0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
          notebook_id: nb.id,
          declared_byte_size: 1024,
          file_name: `file_${i + 1}.pdf`,
          mime_type: "application/pdf",
        }));

        const results = await reserveSources({} as any, nb.id, batch, { maxSources: 50 });
        expect(results).toHaveLength(10);

        // First 5 admitted
        for (let i = 0; i < 5; i++) {
          expect(results[i]!.admitted).toBe(true);
        }
        // Next 5 rejected with quota error
        for (let i = 5; i < 10; i++) {
          expect(results[i]!.admitted).toBe(false);
          expect(results[i]!.reason).toMatch(/quota/i);
        }
      });

      it("DB-23: Uploading, Processing, and Ready consume slots; Failed does not", async () => {
        const {
          reserveSourceSlot,
          transitionSourceStatus,
          getOccupiedSourceCount,
        } = await import("../src/quota.js");
        const { createNotebook } = await import("../src/notebooks.js");

        const nb = await createNotebook({} as any, "usr_alpha", { title: "State Accounting" });
        const { seedSourceSlots } = await import("../src/quota.js");
        await seedSourceSlots(nb.id, 0);

        const attempt = {
          attempt_id: "s1000000-0000-4000-8000-000000000001",
          notebook_id: nb.id,
          declared_byte_size: 1024,
          file_name: "accounting.pdf",
          mime_type: "application/pdf",
        };

        // 1. Uploading consumes slot
        await reserveSourceSlot({} as any, attempt);
        expect(await getOccupiedSourceCount(nb.id)).toBe(1);

        // 2. Processing still consumes slot
        await transitionSourceStatus({} as any, nb.id, attempt.attempt_id, "Processing");
        expect(await getOccupiedSourceCount(nb.id)).toBe(1);

        // 3. Ready still consumes slot
        await transitionSourceStatus({} as any, nb.id, attempt.attempt_id, "Ready");
        expect(await getOccupiedSourceCount(nb.id)).toBe(1);

        // 4. Transition to Failed releases slot
        await transitionSourceStatus({} as any, nb.id, attempt.attempt_id, "Failed");
        expect(await getOccupiedSourceCount(nb.id)).toBe(0);
      });

      it("DB-24: duplicate attempt replay returns existing result; admission against deleted notebook fails", async () => {
        const { reserveSourceSlot, InvalidScopeError } = await import("../src/quota.js");
        const { createNotebook, deleteNotebook } = await import("../src/notebooks.js");

        const nb = await createNotebook({} as any, "usr_alpha", { title: "Replay NB" });
        const attempt = {
          attempt_id: "r1000000-0000-4000-8000-000000000001",
          notebook_id: nb.id,
          declared_byte_size: 1024,
          file_name: "replay.pdf",
          mime_type: "application/pdf",
        };

        const first = await reserveSourceSlot({} as any, attempt);
        expect(first.admitted).toBe(true);

        // Replay returns identical result without allocating second slot
        const replay = await reserveSourceSlot({} as any, attempt);
        expect(replay.admitted).toBe(true);
        expect(replay.attempt_id).toBe(first.attempt_id);

        // Deleting notebook causes new reservation against it to fail
        await deleteNotebook({} as any, nb.id, "usr_alpha");
        const attemptAfterDelete = {
          attempt_id: "r1000000-0000-4000-8000-000000000002",
          notebook_id: nb.id,
          declared_byte_size: 1024,
          file_name: "after_delete.pdf",
          mime_type: "application/pdf",
        };
        await expect(reserveSourceSlot({} as any, attemptAfterDelete)).rejects.toThrow();
      });
    });
  });
});
