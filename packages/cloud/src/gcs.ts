import { Storage, type Bucket } from "@google-cloud/storage";
import { RetainedObjectError, type ObjectMetadata, type ObjectStorage, type ObjectVersion, type UploadCapability } from "./storage.ts";

/**
 * Cloud Storage implementation (FR-WM-01, FR-SI-01, NFR-SEC-01, D3). Private, versioned, europe-west4 bucket
 * provisioned by OpenTofu; keyless credentials (ADC / Cloud Run service account). Signed V4 upload URLs are
 * signed through IAM signBlob, so no key file is ever used.
 */
export class GcsObjectStorage implements ObjectStorage {
  readonly kind = "gcs" as const;
  private readonly bucket: Bucket;

  constructor(options: { bucket: string; storage?: Storage }) {
    this.bucket = (options.storage ?? new Storage()).bucket(options.bucket);
  }

  async write(name: string, data: Buffer, contentType: string): Promise<ObjectMetadata> {
    const file = this.bucket.file(name);
    await file.save(data, { contentType, resumable: false, metadata: { cacheControl: "private, no-store" } });
    const [metadata] = await file.getMetadata();
    return { name, generation: String(metadata.generation), size: Number(metadata.size), contentType };
  }

  async read(name: string, generation?: string): Promise<Buffer> {
    const file = this.bucket.file(name, generation ? { generation: Number(generation) } : {});
    const [contents] = await file.download();
    return contents;
  }

  async readRange(name: string, generation: string, start: number, end: number): Promise<Buffer> {
    const [contents] = await this.bucket.file(name, { generation: Number(generation) }).download({ start, end });
    return contents;
  }

  async stat(name: string): Promise<ObjectMetadata | null> {
    try {
      const [metadata] = await this.bucket.file(name).getMetadata();
      return {
        name,
        generation: String(metadata.generation),
        size: Number(metadata.size),
        contentType: metadata.contentType ?? "application/octet-stream",
      };
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  async listVersions(prefix: string): Promise<ObjectVersion[]> {
    const [files] = await this.bucket.getFiles({ prefix, versions: true });
    return files.map((file) => {
      const m = file.metadata;
      return {
        name: file.name,
        generation: String(m.generation),
        size: Number(m.size ?? 0),
        live: !m.timeDeleted,
        retained: Boolean(m.temporaryHold || m.eventBasedHold || (m.retention && m.retention.retainUntilTime)),
      };
    });
  }

  async deleteVersion(name: string, generation: string): Promise<void> {
    try {
      await this.bucket.file(name, { generation: Number(generation) }).delete({ ignoreNotFound: true });
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 403 && /retention|hold/i.test((err as Error).message)) throw new RetainedObjectError(name);
      throw err;
    }
  }

  async createUploadUrl(
    name: string,
    options: { contentType: string; maxBytes: number; expiresAt: Date }
  ): Promise<UploadCapability> {
    const extensionHeaders = { "x-goog-content-length-range": `0,${options.maxBytes}` };
    const [url] = await this.bucket.file(name).getSignedUrl({
      version: "v4",
      action: "write",
      expires: options.expiresAt,
      contentType: options.contentType,
      extensionHeaders,
    });
    return {
      url,
      method: "PUT",
      headers: { "content-type": options.contentType, ...extensionHeaders },
      expires_at: options.expiresAt.toISOString(),
    };
  }
}
