import { describe, it, expect, beforeEach } from "vitest";
import {
  InvalidStudioTransitionError,
  StudioArtifactSchema,
  type StudioReportPayload,
} from "@everlast/contracts";
import { InMemoryStudioArtifactRepository, StudioRetryNotAllowedError } from "../src/studio-artifacts.ts";

const NB = "11111111-1111-4111-8111-111111111111";
const NB2 = "22222222-2222-4222-8222-222222222222";
const SRC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER = "owner-1";
const payload: StudioReportPayload = {
  content_md: "# R [1]",
  citations: [
    { badge_number: 1, chunk_id: "01890000-0000-7000-8000-000000000001", source_id: SRC, revision: 1, snippet: "s" },
  ],
};
const input = {
  notebook_id: NB,
  owner_id: OWNER,
  subtype: "briefing_doc" as const,
  title: "Briefing doc",
  params_json: {},
  snapshot: [{ source_id: SRC, revision: 1 }],
};

describe("C-03 StudioArtifactRepository (in-memory)", () => {
  let repo: InMemoryStudioArtifactRepository;
  beforeEach(() => {
    repo = new InMemoryStudioArtifactRepository();
  });

  it("creates a Queued schema-valid artifact with snapshot", async () => {
    const a = await repo.createQueued(input);
    expect(a.status).toBe("Queued");
    expect(a.attempt).toBe(1);
    const { owner_id: _o, ...dto } = a;
    expect(StudioArtifactSchema.safeParse(dto).success).toBe(true);
    expect(a.active_source_ids_snapshot).toEqual(input.snapshot);
  });

  it("enforces Queued → Running → Completed and terminal immutability", async () => {
    const a = await repo.createQueued(input);
    await expect(repo.complete(a.id, payload)).rejects.toBeInstanceOf(InvalidStudioTransitionError);
    await repo.markRunning(a.id);
    await repo.updateProgress(a.id, { stage: "extracting", percent: 40 });
    const done = await repo.complete(a.id, payload);
    expect(done.status).toBe("Completed");
    expect(done.payload_json).toEqual(payload);
    expect(done.progress).toBeNull();
    await expect(repo.fail(a.id, { code: "GenerationError", message: "x" })).rejects.toBeInstanceOf(
      InvalidStudioTransitionError
    );
    await expect(repo.cancel(a.id)).rejects.toBeInstanceOf(InvalidStudioTransitionError);
  });

  it("records failure and cancellation without a payload", async () => {
    const f = await repo.createQueued(input);
    await repo.markRunning(f.id);
    const failed = await repo.fail(f.id, { code: "SourceChanged", message: "Source A replaced" });
    expect(failed.status).toBe("Failed");
    expect(failed.payload_json).toBeNull();
    const c = await repo.createQueued(input);
    const cancelled = await repo.cancel(c.id);
    expect(cancelled.status).toBe("Cancelled");
    expect(cancelled.failure?.code).toBe("Cancelled");
    await expect(repo.complete(c.id, payload)).rejects.toBeInstanceOf(InvalidStudioTransitionError);
  });

  it("isolates by notebook and owner; list excludes payloads", async () => {
    const a = await repo.createQueued(input);
    await repo.markRunning(a.id);
    await repo.complete(a.id, payload);
    expect(await repo.get(NB, OWNER, a.id)).not.toBeNull();
    expect(await repo.get(NB2, OWNER, a.id)).toBeNull();
    expect(await repo.get(NB, "someone-else", a.id)).toBeNull();
    const listed = await repo.list(NB, OWNER);
    expect(listed).toHaveLength(1);
    expect("payload_json" in listed[0]!).toBe(false);
    expect(await repo.list(NB, "someone-else")).toEqual([]);
  });

  it("creates retries as new attempts only from Failed/Cancelled with a fresh snapshot", async () => {
    const a = await repo.createQueued(input);
    await expect(repo.createRetry({ previous_id: a.id, owner_id: OWNER, snapshot: input.snapshot })).rejects.toBeInstanceOf(
      StudioRetryNotAllowedError
    );
    await repo.markRunning(a.id);
    await repo.fail(a.id, { code: "SourceChanged", message: "changed" });
    const next = await repo.createRetry({
      previous_id: a.id,
      owner_id: OWNER,
      snapshot: [{ source_id: SRC, revision: 2 }],
    });
    expect(next.id).not.toBe(a.id);
    expect(next.attempt).toBe(2);
    expect(next.retry_of).toBe(a.id);
    expect(next.status).toBe("Queued");
    expect(next.active_source_ids_snapshot).toEqual([{ source_id: SRC, revision: 2 }]);
    expect((await repo.getById(a.id))?.status).toBe("Failed");
  });

  it("deletes one artifact and cascades per notebook", async () => {
    const a = await repo.createQueued(input);
    await repo.createQueued({ ...input, notebook_id: NB2 });
    expect(await repo.delete(NB, "someone-else", a.id)).toBe(false);
    expect(await repo.delete(NB, OWNER, a.id)).toBe(true);
    await repo.createQueued(input);
    await repo.deleteForNotebook(NB);
    expect(await repo.list(NB, OWNER)).toEqual([]);
    expect(await repo.list(NB2, OWNER)).toHaveLength(1);
  });
});
