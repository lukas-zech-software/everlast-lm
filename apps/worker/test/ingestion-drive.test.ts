import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DELEGATED_ACCESS_DENIED_MESSAGE, PPTX_MEDIA_TYPE } from "@everlast/contracts";
import { admitLinkedImport, createDelegatedConnection, getSourceById, resolveSyncChannel, revokeDelegatedConnection } from "@everlast/db";
import { driveDocsExportFixture, driveSlidesExportFixture } from "@everlast/testkit/multimodal-fixtures";
import { createDriveAdapter, DriveApiError, type DelegatedTokenProvider, type DriveApi, type DriveFileMetadata } from "../src/ingestion/drive.ts";
import { createOfficeAdapter } from "../src/ingestion/office.ts";
import { processIngestJob } from "../src/ingestion/pipeline.ts";
import type { ContentScreener } from "../src/ingestion/screening.ts";
import { FixtureOcr, createWorkerHarness, type WorkerHarness } from "./support.ts";

/**
 * [009-multimodal-ingestion-sync] T011 — delegated Google Docs→DOCX / Slides→PPTX import (FR-SI-01, FR-SI-05,
 * NFR-SEC-02, D11; spec FR-002, FR-007, FR-016, SC-003, SC-006): the requesting user's delegated read access only,
 * external ID persisted, revoked/insufficient ACLs rejected without a service-account fallback, tokens never leak,
 * provider export ceiling distinct from the 200 MB application limit, long-running export, mid-export change.
 */

const TOKEN = "ya29.user-delegated-access-token-SECRET";
const cleanScreener: ContentScreener = { name: "clean", screen: async () => ({ verdict: "clean" }) };

class FakeDrive implements DriveApi {
  calls: { op: string; token: string; fileId: string; mimeType?: string }[] = [];
  meta: DriveFileMetadata = { id: "1SlidesFile", name: "Roadmap sync", mimeType: "application/vnd.google-apps.presentation", version: "7", canDownload: true };
  versions: string[] = [];
  exportBytes: Buffer = driveSlidesExportFixture();
  exportError: Error | null = null;
  longRunning: Buffer | Error | null = null;
  metadataError: Error | null = null;
  watches: { token: string; fileId: string; channel: { id: string; address: string; token: string; expiration: number } }[] = [];
  watchError: Error | null = null;

  async watch(token: string, fileId: string, channel: { id: string; address: string; token: string; expiration: number }): Promise<void> {
    if (this.watchError) throw this.watchError;
    this.watches.push({ token, fileId, channel });
  }

  async getMetadata(token: string, fileId: string): Promise<DriveFileMetadata> {
    this.calls.push({ op: "metadata", token, fileId });
    if (this.metadataError) throw this.metadataError;
    const version = this.versions.shift() ?? this.meta.version;
    return { ...this.meta, version };
  }
  async exportFile(token: string, fileId: string, mimeType: string): Promise<Buffer> {
    this.calls.push({ op: "export", token, fileId, mimeType });
    if (this.exportError) throw this.exportError;
    return this.exportBytes;
  }
  async downloadLongRunning(token: string, fileId: string, mimeType: string): Promise<Buffer> {
    this.calls.push({ op: "download", token, fileId, mimeType });
    if (this.longRunning instanceof Error) throw this.longRunning;
    if (!this.longRunning) throw new DriveApiError(400, "longRunningExportUnsupported");
    return this.longRunning;
  }
  async downloadContent(token: string, fileId: string): Promise<Buffer> {
    this.calls.push({ op: "content", token, fileId });
    return this.exportBytes;
  }
}

class FakeTokens implements DelegatedTokenProvider {
  issued: string[] = [];
  failWith: Error | null = null;
  async accessToken(connection: { id: string; secret_ref: string }): Promise<string> {
    if (this.failWith) throw this.failWith;
    this.issued.push(connection.id);
    return TOKEN;
  }
}

let h: WorkerHarness;
beforeAll(async () => {
  h = await createWorkerHarness();
});
afterAll(async () => {
  await h?.close();
});

async function importDrive(drive: FakeDrive, tokens: FakeTokens, options: { revoke?: boolean; maxBytes?: number; webhookAddress?: string; revokeBeforePublish?: boolean } = {}) {
  const nb = await h.newNotebook();
  const connection = await createDelegatedConnection(h.db.pool, { userId: h.ownerId, secretRef: "projects/p/secrets/delegated-x/versions/latest", scopes: ["https://www.googleapis.com/auth/drive.readonly"] });
  const admitted = await admitLinkedImport(h.db.pool, h.ownerId, nb, { attempt_id: randomUUID(), kind: "drive", external_document_id: drive.meta.id, connection_id: connection.id });
  if (options.revoke) await revokeDelegatedConnection(h.db.pool, h.ownerId, connection.id);
  const logs: string[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => void logs.push(args.map(String).join(" "));
  try {
    const outcome = await processIngestJob(
      {
        pool: h.db.pool,
        storage: h.storage,
        embedder: h.embedder,
        ocr: new FixtureOcr(),
        adapters: {
          drive: createDriveAdapter({
            api: drive,
            tokens,
            office: {},
            ...(options.maxBytes ? { maxBytes: options.maxBytes } : {}),
            ...(options.webhookAddress ? { webhook: { address: options.webhookAddress, ttlMs: 86_400_000 } } : {}),
          }),
          office: createOfficeAdapter({}),
        },
        screener: options.revokeBeforePublish ? { name: "revoke-during-screening", screen: async (pages: string[]) => {
          await revokeDelegatedConnection(h.db.pool, h.ownerId, connection.id);
          return cleanScreener.screen(pages);
        } } : cleanScreener,
      },
      { source_id: admitted.source.id, attempt_id: admitted.source.attempt_id, operation_id: admitted.operation.operation_id },
      8
    );
    return { outcome, source: (await getSourceById(h.db.pool, admitted.source.id))!, connection, logs };
  } finally {
    console.error = orig;
  }
}

describe("delegated Drive import (D11, FR-SI-01)", () => {
  it("DRIVE-01: Slides export to PPTX with the user's token; notes reach the viewer; external ID and title persist", async () => {
    const drive = new FakeDrive();
    const tokens = new FakeTokens();
    const { outcome, source, connection } = await importDrive(drive, tokens);
    expect(outcome.status).toBe("ready");
    expect(source).toMatchObject({ status: "Ready", media_type: PPTX_MEDIA_TYPE, link_kind: "drive", external_document_id: "1SlidesFile", title: "Roadmap sync" });
    expect(tokens.issued).toEqual([connection.id]);
    expect(drive.calls.filter((c) => c.op === "export").map((c) => c.mimeType)).toEqual([PPTX_MEDIA_TYPE]);
    expect(drive.calls.every((c) => c.token === TOKEN && c.fileId === "1SlidesFile")).toBe(true);
    const pages = await h.db.pool.query("SELECT text FROM source_pages WHERE source_id = $1", [source.id]);
    expect(pages.rows.map((r) => r.text).join("\n")).toContain("Speaker notes: Speaker note: confirm the date with legal.");
    const chunks = await h.db.pool.query("SELECT locator FROM chunks WHERE source_id = $1", [source.id]);
    for (const row of chunks.rows) expect(Object.keys(row.locator).sort()).toEqual(["end_offset", "page_number", "physical_page", "start_offset"]);
  });

  it("DRIVE-02: Docs export to DOCX through the same Office normalization", async () => {
    const drive = new FakeDrive();
    drive.meta = { id: "1DocsFile", name: "Travel policy", mimeType: "application/vnd.google-apps.document", version: "3", canDownload: true };
    drive.exportBytes = driveDocsExportFixture();
    const { outcome, source } = await importDrive(drive, new FakeTokens());
    expect(outcome.status).toBe("ready");
    expect(source.media_type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  it("DRIVE-03: revoked local delegation, revoked upstream grant and insufficient ACL fail without any fallback credential", async () => {
    for (const setup of [
      (d: FakeDrive, t: FakeTokens) => ({ d, t, revoke: true }),
      (d: FakeDrive, t: FakeTokens) => ((t.failWith = new DriveApiError(400, "invalid_grant")), { d, t, revoke: false }),
      (d: FakeDrive, t: FakeTokens) => ((d.metadataError = new DriveApiError(403, "insufficientFilePermissions")), { d, t, revoke: false }),
      (d: FakeDrive, t: FakeTokens) => ((d.meta = { ...d.meta, canDownload: false }), { d, t, revoke: false }),
    ]) {
      const { d, t, revoke } = setup(new FakeDrive(), new FakeTokens());
      const { source } = await importDrive(d, t, { revoke });
      expect(source.status).toBe("Failed");
      expect(source.failure_message).toBe(DELEGATED_ACCESS_DENIED_MESSAGE);
      expect(d.calls.filter((c) => c.op === "export")).toEqual([]);
      // Every Drive call that happened used the delegated user token; nothing else exists to fall back to.
      expect(d.calls.every((c) => c.token === TOKEN)).toBe(true);
    }
  });

  it("DRIVE-04: tokens never appear in stored errors, operation errors or logs", async () => {
    const drive = new FakeDrive();
    drive.exportError = new Error(`upstream failed for Bearer ${TOKEN}`);
    const { source, logs } = await importDrive(drive, new FakeTokens());
    const ops = await h.db.pool.query("SELECT error_code, error_message FROM source_operations WHERE source_id = $1", [source.id]);
    const stored = JSON.stringify([source, ops.rows, logs]);
    expect(stored).not.toContain(TOKEN);
  });

  it("DRIVE-05: the provider export ceiling uses a long-running export; an unsupported one is a provider error, not the 200 MB quota", async () => {
    const big = new FakeDrive();
    big.exportError = new DriveApiError(403, "exportSizeLimitExceeded");
    big.longRunning = driveSlidesExportFixture();
    const ok = await importDrive(big, new FakeTokens());
    expect(ok.outcome.status).toBe("ready");
    expect(big.calls.map((c) => c.op)).toContain("download");

    const blocked = new FakeDrive();
    blocked.exportError = new DriveApiError(403, "exportSizeLimitExceeded");
    const failed = await importDrive(blocked, new FakeTokens());
    expect(failed.source.status).toBe("Failed");
    expect(failed.source.failure_code).toBe("ProviderExportLimit");
    expect(failed.source.failure_message).not.toMatch(/200/);
  });

  it("DRIVE-06: exported bytes above the inclusive application limit fail as oversized without truncation", async () => {
    const drive = new FakeDrive();
    const { source } = await importDrive(drive, new FakeTokens(), { maxBytes: 100 });
    expect(source).toMatchObject({ status: "Failed", failure_code: "SourceOversized" });
  });

  it("DRIVE-07: an upstream revision change mid-export is retried within the operation; a persistently changing file fails", async () => {
    const settles = new FakeDrive();
    settles.versions = ["7", "8", "8", "8"]; // before, after (changed) → retry: before, after (stable)
    expect((await importDrive(settles, new FakeTokens())).outcome.status).toBe("ready");
    expect(settles.calls.filter((c) => c.op === "export").length).toBe(2);

    const churns = new FakeDrive();
    churns.versions = ["1", "2", "3", "4", "5", "6"];
    const failed = await importDrive(churns, new FakeTokens());
    expect(failed.source).toMatchObject({ status: "Failed", failure_code: "UpstreamChanged" });
  });

  it("DRIVE-08 (T054, FR-011): with a webhook address, a watch channel is created with the user's token and only its hash is stored", async () => {
    const drive = new FakeDrive();
    const { outcome, source } = await importDrive(drive, new FakeTokens(), { webhookAddress: "https://everlast.example.test/webhooks/google-drive" });
    expect(outcome.status).toBe("ready");
    expect(drive.watches).toHaveLength(1);
    const w = drive.watches[0]!;
    expect(w).toMatchObject({ token: TOKEN, fileId: "1SlidesFile", channel: { address: "https://everlast.example.test/webhooks/google-drive" } });
    expect(w.channel.token.length).toBeGreaterThanOrEqual(32);
    expect(w.channel.expiration).toBeGreaterThan(Date.now());
    const stored = await h.db.pool.query("SELECT token_hash FROM source_sync_channels WHERE channel_id = $1", [w.channel.id]);
    expect(stored.rows[0].token_hash).not.toBe(w.channel.token);
    expect(await resolveSyncChannel(h.db.pool, w.channel.id, w.channel.token)).toMatchObject({ sourceId: source.id, notebookId: source.notebook_id, ownerId: h.ownerId });
  });

  it("DRIVE-09 (T054): no webhook address → no channel; a failing watch call never fails the import", async () => {
    const plain = new FakeDrive();
    await importDrive(plain, new FakeTokens());
    expect(plain.watches).toEqual([]);
    const failing = new FakeDrive();
    failing.watchError = new DriveApiError(403, "push.webhookUrlUnauthorized");
    const { outcome } = await importDrive(failing, new FakeTokens(), { webhookAddress: "https://everlast.example.test/webhooks/google-drive" });
    expect(outcome.status).toBe("ready");
  });
});

it("refuses publication when delegation is revoked during screening (FR-SI-01, NFR-SEC-02)", async () => {
  const result = await importDrive(new FakeDrive(), new FakeTokens(), { revokeBeforePublish: true });
  expect(result.source).toMatchObject({ status: "Failed", failure_code: "DelegatedAccessDenied" });
  expect((await h.db.pool.query("SELECT 1 FROM chunks WHERE source_id = $1", [result.source.id])).rowCount).toBe(0);
});
