import { describe, it, expect, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { InvalidScopeError, StudioPluginRegistry, StudioParamsError, validateCustomReportPrompt, type ReportSuggestionsResult, type StudioGeneratorPlugin } from "@everlast/contracts";
import { InMemoryStudioArtifactRepository } from "@everlast/db";
import { handleStudioRoute, type StudioRouteDeps } from "../src/routes/studio.ts";

const NB = "11111111-1111-4111-8111-111111111111";
const S1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let server: Server;
let base: string;
let suggestCalls = 0;
let verified = 0;

beforeEach(async () => {
  suggestCalls = 0;
  verified = 0;
  const registry = new StudioPluginRegistry();
  const plugin: StudioGeneratorPlugin = {
    manifest: { plugin_type: "report", display_name: "Reports", subtypes: ["custom", "dynamic"] },
    triggerJob: (r) => {
      const v = validateCustomReportPrompt(r.params.custom_prompt ?? "");
      if (!v.valid) throw new StudioParamsError(v.error ?? "bad");
      return { title: "Custom report", params_json: { custom_prompt: v.normalized as string } };
    },
    generate: async () => ({ status: "refused", code: "InsufficientEvidence", message: "n/a" }),
  };
  registry.register(plugin);
  const deps: StudioRouteDeps = {
    repo: new InMemoryStudioArtifactRepository(),
    registry,
    access: {
      resolveSnapshot: async (o, _n, ids) => {
        verified++;
        if (o !== "owner-1") throw new InvalidScopeError("no");
        return ids.map((source_id) => ({ source_id, revision: 1 }));
      },
      verifySnapshot: async () => undefined,
    },
    dispatcher: { enqueue: async () => undefined },
    suggestions: { getSuggestions: async (): Promise<ReportSuggestionsResult> => (suggestCalls++, { state: "SuggestionsLoading" }) },
  };
  server = createServer(async (req, res) => {
    const user = req.headers["x-user"] === "other" ? "other" : "owner-1";
    if (!(await handleStudioRoute(req, res, deps, user))) { res.statusCode = 404; res.end(); }
  });
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/notebooks/${NB}/studio`;
  return () => void server.close();
});

const create = (prompt: unknown, subtype = "custom") =>
  fetch(base + "/artifacts", { method: "POST", body: JSON.stringify({ plugin_type: "report", subtype, active_source_ids: [S1], custom_prompt: prompt }) });

describe("custom prompt + suggestions API (FR-ST-11)", () => {
  it("accepts 1 and 5,000 code-point prompts and keeps them untruncated", async () => {
    expect((await create("a")).status).toBe(202);
    const long = "😀".repeat(5000);
    const r = await create(long);
    expect(r.status).toBe(202);
    expect(Array.from((await r.json()).artifact.params_json.custom_prompt)).toHaveLength(5000);
  });
  it("rejects 0, whitespace-only and 5,001 with 422", async () => {
    for (const p of ["", "   \n", "x".repeat(5001)]) expect((await create(p)).status).toBe(422);
  });
  it("requires a prompt for dynamic/custom", async () => {
    const r = await fetch(base + "/artifacts", { method: "POST", body: JSON.stringify({ plugin_type: "report", subtype: "dynamic", active_source_ids: [S1] }) });
    expect(r.status).toBe(422);
  });
  it("suggestions need explicit scope and verified owner before any guide read", async () => {
    const empty = await fetch(base + "/report-suggestions", { method: "POST", body: JSON.stringify({ active_source_ids: [] }) });
    expect(empty.status).toBe(400);
    const other = await fetch(base + "/report-suggestions", { method: "POST", headers: { "x-user": "other" }, body: JSON.stringify({ active_source_ids: [S1] }) });
    expect(other.status).toBe(403);
    expect(suggestCalls).toBe(0);
    const ok = await fetch(base + "/report-suggestions", { method: "POST", body: JSON.stringify({ active_source_ids: [S1] }) });
    expect(await ok.json()).toEqual({ state: "SuggestionsLoading" });
    expect(suggestCalls).toBe(1);
    expect(verified).toBeGreaterThan(0);
  });
});
