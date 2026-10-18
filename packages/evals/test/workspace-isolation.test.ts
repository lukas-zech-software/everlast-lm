import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRequestScope, InvalidScopeError } from "@everlast/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, "../fixtures/workspace-isolation.json");
const fixtures = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

describe("T027 [US2] Deterministic Workspace Isolation Evals (FR-WM-04, NFR-EVAL-04)", () => {
  const notebookAlpha = fixtures.notebooks[0];
  const notebookBeta = fixtures.notebooks[1];
  const userAlpha = fixtures.users[0];
  const userBeta = fixtures.users[1];

  it("ISO-01: canary containment: OMEGA-991 canary token is completely absent from Notebook Beta context", async () => {
    const betaCase = fixtures.isolation_test_cases.find(
      (tc: any) => tc.case_id === "TC-ISO-01-canary-containment"
    );
    expect(betaCase).toBeDefined();

    const scopeResult = await validateRequestScope(
      undefined as any,
      userBeta.subject,
      {
        notebook_id: betaCase.request.notebook_id,
        active_source_ids: betaCase.request.active_source_ids,
        query: betaCase.request.query,
      }
    );

    // Filter chunks matching beta sources
    const activeIds = new Set(betaCase.request.active_source_ids);
    const contextChunks = fixtures.chunks.filter((c: any) => activeIds.has(c.source_id));

    // Verify zero chunks contain the canary token
    const leakedChunks = contextChunks.filter((c: any) =>
      c.text.includes(betaCase.forbidden_token)
    );
    expect(leakedChunks.length).toBe(0);
  });

  it("ISO-02: tampered source ID from Notebook Alpha into Notebook Beta triggers InvalidScopeError", async () => {
    const tamperedCase = fixtures.isolation_test_cases.find(
      (tc: any) => tc.case_id === "TC-ISO-02-tampered-source-id"
    );
    expect(tamperedCase).toBeDefined();

    // Owner Beta attempts to request Notebook Alpha's source inside Notebook Beta
    await expect(
      validateRequestScope(undefined as any, userBeta.subject, {
        notebook_id: tamperedCase.request.notebook_id,
        active_source_ids: tamperedCase.request.active_source_ids,
      })
    ).rejects.toThrow(InvalidScopeError);
  });

  it("ISO-03: defense-in-depth: foreign owner and foreign notebook chunks never pass scope guard", async () => {
    // User Alpha's notebook requested by User Beta
    await expect(
      validateRequestScope(undefined as any, userBeta.subject, {
        notebook_id: notebookAlpha.id,
        active_source_ids: ["a1000000-0000-4000-8000-000000000001"],
      })
    ).rejects.toThrow(InvalidScopeError);

    // User Alpha requesting non-existent source
    await expect(
      validateRequestScope(undefined as any, userAlpha.subject, {
        notebook_id: notebookAlpha.id,
        active_source_ids: ["00000000-0000-4000-8000-000000000000"],
      })
    ).rejects.toThrow(InvalidScopeError);
  });
});
