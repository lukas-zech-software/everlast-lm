import { randomBytes, randomUUID } from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import { DELEGATED_ACCESS_DENIED_MESSAGE, DOCX_MEDIA_TYPE, MAX_SOURCE_BYTES, PPTX_MEDIA_TYPE } from "@everlast/contracts";
import { getActiveDelegatedConnection, registerSyncChannel, type DelegatedConnection } from "@everlast/db";
import { IngestionFailure } from "./extract.ts";
import { normalizeOffice, type OfficeAdapterOptions } from "./office.ts";
import { sourceObjectPrefix, type AdapterContext, type NormalizedSource, type SourceAdapter } from "./pipeline.ts";

/**
 * Delegated Google Drive import (FR-SI-01 Subset B, FR-SI-05, NFR-SEC-02, D11; specs/009 T015).
 *
 * Uses only the notebook owner's own delegated read access (an opaque Secret Manager reference to their refresh
 * token). There is no service-account path: if the delegation is revoked, insufficient or the file cannot be
 * downloaded, the import or re-sync fails with "Access to the linked document was denied". Docs export to DOCX and
 * Slides to PPTX, then follow the Office normalization. The provider's `files.export` ceiling is not the
 * application's inclusive 200,000,000-byte limit: an export-size error falls back to the long-running
 * `files.download` export, and if that is unsupported the source fails as a provider limit. A file whose version
 * changes during export is re-exported within the same operation; it is never published as a mixed revision.
 * Tokens never appear in errors, logs or stored state.
 */

export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  version: string;
  canDownload: boolean;
}

export class DriveApiError extends Error {
  readonly status: number;
  readonly reason: string;
  constructor(status: number, reason: string) {
    super(`Drive API error ${status} (${reason})`);
    this.name = "DriveApiError";
    this.status = status;
    this.reason = reason;
  }
}

export interface DriveApi {
  getMetadata(token: string, fileId: string): Promise<DriveFileMetadata>;
  /** `files.export` (provider-capped export size). */
  exportFile(token: string, fileId: string, mimeType: string): Promise<Buffer>;
  /** `files.download` long-running export for large native Google files. */
  downloadLongRunning(token: string, fileId: string, mimeType: string): Promise<Buffer>;
  /** `alt=media` content of an uploaded (non-Google) DOCX/PPTX file. */
  downloadContent(token: string, fileId: string): Promise<Buffer>;
  /** `files.watch` push channel to the app's webhook (FR-SI-05 webhook re-sync; specs/009 T054). */
  watch?(token: string, fileId: string, channel: { id: string; address: string; token: string; expiration: number }): Promise<void>;
}

export interface DelegatedTokenProvider {
  /** Returns a short-lived access token for this user's connection; throws when the grant is revoked/invalid. */
  accessToken(connection: Pick<DelegatedConnection, "id" | "secret_ref">): Promise<string>;
}

export interface DriveAdapterOptions {
  api: DriveApi;
  tokens: DelegatedTokenProvider;
  office: OfficeAdapterOptions;
  /** Inclusive application byte limit (defaults to 200,000,000). */
  maxBytes?: number;
  /** Public HTTPS webhook (`/webhooks/google-drive`) for change notifications; absent → no channel is created. */
  webhook?: { address: string; ttlMs?: number } | undefined;
}

const GOOGLE_DOC = "application/vnd.google-apps.document";
const GOOGLE_SLIDES = "application/vnd.google-apps.presentation";

const denied = () => new IngestionFailure("DelegatedAccessDenied", DELEGATED_ACCESS_DENIED_MESSAGE);

/** A transient Drive failure carries no provider message (which could echo request details). */
class DriveTransientError extends Error {
  constructor() {
    super("Transient Google Drive failure");
    this.name = "DriveTransientError";
  }
}

function mapError(err: unknown): never {
  if (err instanceof IngestionFailure) throw err;
  if (err instanceof DriveApiError) {
    if (err.status === 401 || err.status === 403 || err.status === 404 || err.reason === "invalid_grant") throw denied();
  }
  throw new DriveTransientError();
}

async function ownerOf(ctx: AdapterContext): Promise<string | null> {
  const result = await ctx.deps.pool.query<{ owner_id: string }>("SELECT owner_id FROM notebooks WHERE id = $1", [ctx.source.notebook_id]);
  return result.rows[0]?.owner_id ?? null;
}

export function createDriveAdapter(options: DriveAdapterOptions): SourceAdapter {
  const maxBytes = options.maxBytes ?? MAX_SOURCE_BYTES;
  return async (ctx): Promise<NormalizedSource> => {
    const fileId = ctx.source.external_document_id;
    const owner = await ownerOf(ctx);
    const connection = owner ? await getActiveDelegatedConnection(ctx.deps.pool, owner, ctx.source.delegated_connection_id) : null;
    if (!fileId || !connection) throw denied();

    let token: string;
    try {
      token = await options.tokens.accessToken(connection);
    } catch (err) {
      if (err instanceof DriveApiError && err.status >= 500) throw new DriveTransientError();
      throw denied();
    }

    await ctx.progress("Fetching");
    let bytes: Buffer | null = null;
    let meta: DriveFileMetadata | null = null;
    let mediaType = "";
    try {
      for (let attempt = 0; attempt < 3 && !bytes; attempt++) {
        const before = await options.api.getMetadata(token, fileId);
        if (!before.canDownload) throw denied();
        let exportMime: string | null;
        if (before.mimeType === GOOGLE_DOC) exportMime = DOCX_MEDIA_TYPE;
        else if (before.mimeType === GOOGLE_SLIDES) exportMime = PPTX_MEDIA_TYPE;
        else if (before.mimeType === DOCX_MEDIA_TYPE || before.mimeType === PPTX_MEDIA_TYPE) exportMime = null;
        else throw new IngestionFailure("UnsupportedMediaType", "Only Google Docs, Google Slides, Word and PowerPoint files can be imported from Google Drive");
        mediaType = exportMime ?? before.mimeType;

        let data: Buffer;
        if (!exportMime) data = await options.api.downloadContent(token, fileId);
        else {
          try {
            data = await options.api.exportFile(token, fileId, exportMime);
          } catch (err) {
            if (!(err instanceof DriveApiError) || err.reason !== "exportSizeLimitExceeded") throw err;
            try {
              data = await options.api.downloadLongRunning(token, fileId, exportMime);
            } catch (inner) {
              if (inner instanceof DriveApiError && (inner.status === 401 || inner.status === 403 || inner.status === 404) && inner.reason !== "exportSizeLimitExceeded") throw inner;
              throw new IngestionFailure("ProviderExportLimit", "Google Drive could not export this document (provider export limit)");
            }
          }
        }
        const after = await options.api.getMetadata(token, fileId);
        if (after.version !== before.version) continue; // changed mid-export: discard and re-export
        meta = after;
        bytes = data;
      }
    } catch (err) {
      mapError(err);
    }
    if (!bytes || !meta) throw new IngestionFailure("UpstreamChanged", "The linked document kept changing during import; try again later");
    if (bytes.length > maxBytes) throw new IngestionFailure("SourceOversized", "Exceeds 200,000,000 bytes limit");

    await ctx.progress("Parsing");
    let object: { name: string; generation: string } | undefined;
    if (options.office.renderer) {
      const written = await ctx.deps.storage.write(`${sourceObjectPrefix(ctx.source)}drive/${meta.version}.${mediaType === PPTX_MEDIA_TYPE ? "pptx" : "docx"}`, bytes, mediaType);
      object = { name: written.name, generation: written.generation };
    }
    const doc = await normalizeOffice(bytes, mediaType, { renderer: options.office.renderer, ocr: ctx.deps.ocr, object, limits: options.office.limits });
    if (options.webhook && options.api.watch) {
      // Best effort: a channel lets provider notifications reach the same Owner-scoped sync admission. Only a hash of
      // the random channel token is stored; failure to watch never fails the import or re-sync.
      const channel = { id: randomUUID(), address: options.webhook.address, token: randomBytes(32).toString("base64url"), expiration: Date.now() + (options.webhook.ttlMs ?? 6 * 86_400_000) };
      try {
        await options.api.watch(token, fileId, channel);
        await registerSyncChannel(ctx.deps.pool, { channelId: channel.id, notebookId: ctx.source.notebook_id, sourceId: ctx.source.id, token: channel.token, expiresAt: new Date(channel.expiration) });
      } catch (err) {
        console.error(JSON.stringify({ severity: "WARNING", source_id: ctx.source.id, error: (err as Error).name }));
      }
    }
    return { doc, viewerKind: "pages", byteSize: bytes.length, screen: true, title: meta.name, mediaType, upstreamVersion: meta.version };
  };
}

// ---------------------------------------------------------------------------------------------------------
// Production implementations (keyless ADC for Secret Manager; the user's token for Drive)
// ---------------------------------------------------------------------------------------------------------

async function driveFetch(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let reason = "error";
    try {
      const body = (await res.json()) as { error?: { errors?: { reason?: string }[]; status?: string } };
      reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? reason;
    } catch {
      /* body without JSON */
    }
    throw new DriveApiError(res.status, reason);
  }
  return res;
}

async function boundedBody(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new IngestionFailure("SourceOversized", "Exceeds 200,000,000 bytes limit");
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const parts: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new IngestionFailure("SourceOversized", "Exceeds 200,000,000 bytes limit");
    }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}

/** Drive REST v3 with the delegated user's access token (read-only scopes). */
export class GoogleDriveRestApi implements DriveApi {
  private readonly base = "https://www.googleapis.com/drive/v3";
  private readonly maxBytes: number;
  private readonly pollMs: number;

  constructor(options: { maxBytes?: number; pollMs?: number } = {}) {
    this.maxBytes = options.maxBytes ?? MAX_SOURCE_BYTES;
    this.pollMs = options.pollMs ?? 2000;
  }

  async getMetadata(token: string, fileId: string): Promise<DriveFileMetadata> {
    const res = await driveFetch(token, `${this.base}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,version,capabilities/canDownload&supportsAllDrives=true`);
    const body = (await res.json()) as { id: string; name: string; mimeType: string; version: string; capabilities?: { canDownload?: boolean } };
    return { id: body.id, name: body.name, mimeType: body.mimeType, version: String(body.version), canDownload: body.capabilities?.canDownload !== false };
  }

  async exportFile(token: string, fileId: string, mimeType: string): Promise<Buffer> {
    const res = await driveFetch(token, `${this.base}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(mimeType)}`);
    return boundedBody(res, this.maxBytes);
  }

  async downloadLongRunning(token: string, fileId: string, mimeType: string): Promise<Buffer> {
    const start = await driveFetch(token, `${this.base}/files/${encodeURIComponent(fileId)}/download?mimeType=${encodeURIComponent(mimeType)}`, { method: "POST" });
    let op = (await start.json()) as { name?: string; done?: boolean; error?: unknown; response?: { downloadUri?: string } };
    for (let i = 0; !op.done && i < 150; i++) {
      await new Promise((r) => setTimeout(r, this.pollMs));
      op = (await (await driveFetch(token, `https://www.googleapis.com/drive/v3/operations/${op.name}`)).json()) as typeof op;
    }
    if (!op.done || op.error || !op.response?.downloadUri) throw new DriveApiError(400, "longRunningExportUnsupported");
    return boundedBody(await driveFetch(token, op.response.downloadUri), this.maxBytes);
  }

  async watch(token: string, fileId: string, channel: { id: string; address: string; token: string; expiration: number }): Promise<void> {
    await driveFetch(token, `${this.base}/files/${encodeURIComponent(fileId)}/watch?supportsAllDrives=true`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: channel.id, type: "web_hook", address: channel.address, token: channel.token, expiration: String(channel.expiration) }),
    });
  }

  async downloadContent(token: string, fileId: string): Promise<Buffer> {
    const res = await driveFetch(token, `${this.base}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`);
    return boundedBody(res, this.maxBytes);
  }
}

/**
 * Exchanges the user's stored refresh token (Secret Manager version referenced by the connection) for an access
 * token. The worker's own identity only reads the secret; Drive requests use the user's token exclusively.
 */
export class SecretManagerTokenProvider implements DelegatedTokenProvider {
  private readonly auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  private readonly clientId: string;
  private readonly clientSecret: () => Promise<string>;

  constructor(options: { clientId: string; clientSecret: () => Promise<string> }) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
  }

  async accessToken(connection: Pick<DelegatedConnection, "id" | "secret_ref">): Promise<string> {
    const client = await this.auth.getClient();
    const secret = await client.request<{ payload?: { data?: string } }>({ url: `https://secretmanager.googleapis.com/v1/${connection.secret_ref}:access` });
    const refreshToken = Buffer.from(secret.data.payload?.data ?? "", "base64").toString("utf8");
    if (!refreshToken) throw new DriveApiError(400, "invalid_grant");
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: this.clientId, client_secret: await this.clientSecret() }),
    });
    if (!res.ok) throw new DriveApiError(res.status >= 500 ? 503 : 400, "invalid_grant");
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) throw new DriveApiError(400, "invalid_grant");
    return body.access_token;
  }
}
