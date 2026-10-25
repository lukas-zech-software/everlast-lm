import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, open, readdir, readFile, rm, stat, writeFile, rename } from "node:fs/promises";
import { join, dirname } from "node:path";

/**
 * Object storage boundary (FR-WM-01, FR-SI-01, D3). Raw uploads and derived files live under the notebook
 * namespace `notebooks/{notebook_id}/`. Purge enumerates and deletes every live and noncurrent generation.
 */

export interface ObjectVersion {
  name: string;
  generation: string;
  size: number;
  live: boolean;
  /** Temporary/event-based hold or retention lock that prevents hard deletion. */
  retained: boolean;
}

export interface ObjectMetadata {
  name: string;
  generation: string;
  size: number;
  contentType: string;
}

export interface UploadCapability {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expires_at: string;
}

export interface ObjectStorage {
  readonly kind: "gcs" | "local";
  write(name: string, data: Buffer, contentType: string): Promise<ObjectMetadata>;
  read(name: string, generation?: string): Promise<Buffer>;
  /** Byte range [start, end] inclusive of one exact generation (media proxy range requests; specs/009). */
  readRange?(name: string, generation: string, start: number, end: number): Promise<Buffer>;
  stat(name: string): Promise<ObjectMetadata | null>;
  listVersions(prefix: string): Promise<ObjectVersion[]>;
  /** Deletes exactly one generation; an already-absent generation counts as success. */
  deleteVersion(name: string, generation: string): Promise<void>;
  createUploadUrl(
    name: string,
    options: { contentType: string; maxBytes: number; expiresAt: Date }
  ): Promise<UploadCapability>;
}

export class RetainedObjectError extends Error {
  constructor(name: string) {
    super(`Object ${name} is under a hold or retention policy and cannot be purged`);
    this.name = "RetainedObjectError";
  }
}

// ---------------------------------------------------------------------------------------------------------
// Local filesystem implementation (development and tests). Generations are simulated so purge semantics
// (live + noncurrent versions, holds) are exercised exactly like Cloud Storage object versioning.
// ---------------------------------------------------------------------------------------------------------

interface LocalIndex {
  live: string | null;
  versions: { generation: string; size: number; contentType: string; retained?: boolean }[];
}

export class LocalObjectStorage implements ObjectStorage {
  readonly kind = "local" as const;
  readonly root: string;
  private readonly signingKey: Buffer;
  private readonly publicBaseUrl: string;

  constructor(options: { root: string; publicBaseUrl: string; signingKey?: Buffer }) {
    this.root = options.root;
    this.publicBaseUrl = options.publicBaseUrl.replace(/\/$/, "");
    this.signingKey = options.signingKey ?? randomBytes(32);
  }

  private dir(name: string): string {
    if (name.includes("..") || name.startsWith("/")) throw new Error(`Invalid object name ${name}`);
    return join(this.root, "objects", name);
  }

  private async index(name: string): Promise<LocalIndex> {
    try {
      return JSON.parse(await readFile(join(this.dir(name), "index.json"), "utf8")) as LocalIndex;
    } catch {
      return { live: null, versions: [] };
    }
  }

  private async saveIndex(name: string, index: LocalIndex): Promise<void> {
    const file = join(this.dir(name), "index.json");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(index));
    await rename(`${file}.tmp`, file);
  }

  async write(name: string, data: Buffer, contentType: string): Promise<ObjectMetadata> {
    const index = await this.index(name);
    const generation = `${Date.now()}${String(index.versions.length).padStart(4, "0")}`;
    await mkdir(this.dir(name), { recursive: true });
    await writeFile(join(this.dir(name), generation), data);
    index.versions.push({ generation, size: data.length, contentType });
    index.live = generation;
    await this.saveIndex(name, index);
    return { name, generation, size: data.length, contentType };
  }

  async read(name: string, generation?: string): Promise<Buffer> {
    const index = await this.index(name);
    const target = generation ?? index.live;
    if (!target || !index.versions.some((v) => v.generation === target)) throw new Error(`Object ${name} not found`);
    return readFile(join(this.dir(name), target));
  }

  async readRange(name: string, generation: string, start: number, end: number): Promise<Buffer> {
    const index = await this.index(name);
    if (!index.versions.some((v) => v.generation === generation)) throw new Error(`Object ${name} not found`);
    const handle = await open(join(this.dir(name), generation), "r");
    try {
      const length = Math.max(0, end - start + 1);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async stat(name: string): Promise<ObjectMetadata | null> {
    const index = await this.index(name);
    const live = index.versions.find((v) => v.generation === index.live);
    return live ? { name, generation: live.generation, size: live.size, contentType: live.contentType } : null;
  }

  async listVersions(prefix: string): Promise<ObjectVersion[]> {
    const base = join(this.root, "objects");
    const out: ObjectVersion[] = [];
    const walk = async (relative: string): Promise<void> => {
      let entries: string[];
      try {
        entries = await readdir(join(base, relative));
      } catch {
        return;
      }
      if (entries.includes("index.json")) {
        const index = await this.index(relative);
        for (const v of index.versions) {
          out.push({ name: relative, generation: v.generation, size: v.size, live: v.generation === index.live, retained: v.retained === true });
        }
      }
      for (const entry of entries) {
        const child = relative ? `${relative}/${entry}` : entry;
        if ((await stat(join(base, child)).catch(() => null))?.isDirectory()) await walk(child);
      }
    };
    await walk(prefix.replace(/\/$/, ""));
    return out.filter((v) => v.name.startsWith(prefix.replace(/\/$/, "")));
  }

  async deleteVersion(name: string, generation: string): Promise<void> {
    const index = await this.index(name);
    const version = index.versions.find((v) => v.generation === generation);
    if (!version) return;
    if (version.retained) throw new RetainedObjectError(name);
    await rm(join(this.dir(name), generation), { force: true });
    index.versions = index.versions.filter((v) => v.generation !== generation);
    if (index.live === generation) index.live = null;
    if (index.versions.length === 0) await rm(this.dir(name), { recursive: true, force: true });
    else await this.saveIndex(name, index);
  }

  /** TEST/DEV: place a hold on a generation to model a retention policy that blocks purge. */
  async setRetained(name: string, generation: string, retained: boolean): Promise<void> {
    const index = await this.index(name);
    const version = index.versions.find((v) => v.generation === generation);
    if (version) version.retained = retained;
    await this.saveIndex(name, index);
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.signingKey).update(payload).digest("base64url");
  }

  async createUploadUrl(
    name: string,
    options: { contentType: string; maxBytes: number; expiresAt: Date }
  ): Promise<UploadCapability> {
    const payload = Buffer.from(
      JSON.stringify({ name, ct: options.contentType, max: options.maxBytes, exp: options.expiresAt.getTime() })
    ).toString("base64url");
    return {
      url: `${this.publicBaseUrl}/dev-storage/upload/${payload}.${this.sign(payload)}`,
      method: "PUT",
      headers: { "content-type": options.contentType },
      expires_at: options.expiresAt.toISOString(),
    };
  }

  /** Verifies a dev upload capability token; returns its claims or null when invalid/expired. */
  verifyUploadToken(token: string): { name: string; contentType: string; maxBytes: number } | null {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expected = Buffer.from(this.sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      name: string;
      ct: string;
      max: number;
      exp: number;
    };
    if (Date.now() > claims.exp) return null;
    return { name: claims.name, contentType: claims.ct, maxBytes: claims.max };
  }
}
