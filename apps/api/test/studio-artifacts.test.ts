import { describe, it, expect, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { InvalidScopeError, SourceSnapshotInvalidError, StudioPluginRegistry, StudioParamsError, type ReportSuggestionsResult, type SourceRevisionPair, type StudioGeneratorPlugin } from "@everlast/contracts";
import { InMemoryStudioArtifactRepository } from "@everlast/db";
import { handleStudioRoute, type StudioRouteDeps } from "../src/routes/studio.ts";

const NB = "11111111-1111-4111-8111-111111111111";
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const S2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OWNER = "owner-1";

let server: Server;
let base: string;
let deps: StudioRouteDeps & { enqueued: string[]; revisions: Map<string, number>; converted: unknown[] };
let currentUser = OWNER;

beforeEach(async () => {
  const registry = new StudioPluginRegistry();
  const plugin: StudioGeneratorPlugin = {
    manifest: { plugin_type: "report", display_name: "Reports", subtypes: ["briefing_doc", "custom"] },
    triggerJob: (r) => {
      if (r.subtype === "custom" && !r.params.custom_prompt) throw new StudioParamsError("prompt required");
      return { title: "Briefing doc", params_json: r.params.custom_prompt ? { custom_prompt: r.params.custom_prompt } : {} };
    },
    generate: async () => ({ status: "refused", code: "InsufficientEvidence", message: "n/a" }),
  };
  registry.register(plugin);
  const revisions = new Map([[S1, 1], [S2, 1]]);
  const enqueued: string[] = [];
  const converted: unknown[] = [];
  const access = {
    async resolveSnapshot(owner: string, nb: string, ids: string[]): Promise<SourceRevisionPair[]> {
      if (owner !== OWNER || nb !== NB) throw new InvalidScopeError("not yours");
      return ids.map((source_id) => {
        const revision = revisions.get(source_id);
        if (revision === undefined) throw new InvalidScopeError("unknown source");
        return { source_id, revision };
      });
    },
    async verifySnapshot(_o: string, _n: string, snap: SourceRevisionPair[]) {
      for (const p of snap) if (revisions.get(p.source_id) !== p.revision) throw new SourceSnapshotInvalidError("Source was replaced");
    },
  };
  deps = {
    repo: new InMemoryStudioArtifactRepository(),
    registry,
    access,
    dispatcher: { enqueue: async (id) => void enqueued.push(id) },
    convertToSource: async (i) => (converted.push(i), { source_id: "new-source" }),
    suggestions: { getSuggestions: async (): Promise<ReportSuggestionsResult> => ({ state: "SuggestionsLoading" }) },
    enqueued, revisions, converted,
  };
  server = createServer(async (req, res) => {
    if (!(await handleStudioRoute(req, res, deps, currentUser))) { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/notebooks/${NB}/studio`;
  currentUser = OWNER;
  return () => void server.close();
});

const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const create = (extra: Record<string, unknown> = {}) => post("/artifacts", { plugin_type: "report", subtype: "briefing_doc", active_source_ids: [S1, S2], ...extra });

describe("Studio artifact API (FR-ST-10, NFR-SEC-02)", () => {
  it("rejects empty or omitted scope with 400", async () => {
    expect((await create({ active_source_ids: [] })).status).toBe(400);
    const r = await post("/artifacts", { plugin_type: "report", subtype: "briefing_doc" });
    expect(r.status).toBe(400);
  });
  it("rejects invalid subtype with 422", async () => {
    expect((await create({ subtype: "poster" })).status).toBe(422);
  });
  it("returns 202 Queued with snapshot and enqueues without awaiting generation", async () => {
    const r = await create();
    expect(r.status).toBe(202);
    const { artifact } = await r.json();
    expect(artifact.status).toBe("Queued");
    expect(artifact.active_source_ids_snapshot).toEqual([{ source_id: S1, revision: 1 }, { source_id: S2, revision: 1 }]);
    expect(deps.enqueued).toEqual([artifact.id]);
  });
  it("403 for a foreign source and for another owner's notebook; 404 for other owners' artifacts", async () => {
    expect((await create({ active_source_ids: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"] })).status).toBe(403);
    const { artifact } = await (await create()).json();
    currentUser = "intruder";
    expect((await fetch(`${base}/artifacts/${artifact.id}`)).status).toBe(404);
    expect((await create()).status).toBe(403);
    expect(((await (await fetch(`${base}/artifacts`)).json()).artifacts)).toHaveLength(0);
  });
  it("lists without payload and gets a completed artifact with payload", async () => {
    const { artifact } = await (await create()).json();
    await deps.repo.markRunning(artifact.id);
    await deps.repo.complete(artifact.id, { content_md: "# x [1]", citations: [{ badge_number: 1, chunk_id: "01890000-0000-7000-8000-000000000001", source_id: S1, revision: 1, snippet: "x" }] });
    const list = await (await fetch(`${base}/artifacts`)).json();
    expect(list.artifacts[0]).not.toHaveProperty("payload_json");
    const got = await (await fetch(`${base}/artifacts/${artifact.id}`)).json();
    expect(got.artifact.payload_json.content_md).toBe("# x [1]");
  });
  it("returns an unavailable placeholder without payload after a source change", async () => {
    const { artifact } = await (await create()).json();
    await deps.repo.markRunning(artifact.id);
    await deps.repo.complete(artifact.id, { content_md: "# x [1]", citations: [{ badge_number: 1, chunk_id: "01890000-0000-7000-8000-000000000001", source_id: S1, revision: 1, snippet: "x" }] });
    deps.revisions.set(S1, 2);
    const got = await (await fetch(`${base}/artifacts/${artifact.id}`)).json();
    expect(got.artifact.payload_json).toBeNull();
    expect(got.unavailable.code).toBe("SourceChanged");
  });
  it("cancels a queued job; 409 when already terminal", async () => {
    const { artifact } = await (await create()).json();
    const r = await post(`/artifacts/${artifact.id}/cancel`, {});
    expect((await r.json()).artifact.status).toBe("Cancelled");
    expect((await post(`/artifacts/${artifact.id}/cancel`, {})).status).toBe(409);
  });
  it("retry requires explicit scope and only from Failed/Cancelled", async () => {
    const { artifact } = await (await create()).json();
    expect((await post(`/artifacts/${artifact.id}/retry`, { active_source_ids: [S1] })).status).toBe(409);
    await post(`/artifacts/${artifact.id}/cancel`, {});
    expect((await post(`/artifacts/${artifact.id}/retry`, {})).status).toBe(400);
    const r = await post(`/artifacts/${artifact.id}/retry`, { active_source_ids: [S1] });
    expect(r.status).toBe(202);
    const body = await r.json();
    expect(body.artifact).toMatchObject({ attempt: 2, retry_of: artifact.id });
    expect(body.artifact.active_source_ids_snapshot).toEqual([{ source_id: S1, revision: 1 }]);
    expect(deps.enqueued).toContain(body.artifact.id);
  });
  it("converts completed artifacts to a source; 409 otherwise; 501 without port", async () => {
    const { artifact } = await (await create()).json();
    expect((await post(`/artifacts/${artifact.id}/convert-to-source`, {})).status).toBe(409);
    await deps.repo.markRunning(artifact.id);
    await deps.repo.complete(artifact.id, { content_md: "# x [1]", citations: [{ badge_number: 1, chunk_id: "01890000-0000-7000-8000-000000000001", source_id: S1, revision: 1, snippet: "x" }] });
    const r = await post(`/artifacts/${artifact.id}/convert-to-source`, {});
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ source_id: "new-source" });
    delete (deps as { convertToSource?: unknown }).convertToSource;
    expect((await post(`/artifacts/${artifact.id}/convert-to-source`, {})).status).toBe(501);
  });
  it("deletes an artifact (204) then 404", async () => {
    const { artifact } = await (await create()).json();
    expect((await fetch(`${base}/artifacts/${artifact.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await fetch(`${base}/artifacts/${artifact.id}`, { method: "DELETE" })).status).toBe(404);
  });
});
