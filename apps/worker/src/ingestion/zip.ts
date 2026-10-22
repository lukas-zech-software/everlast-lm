import { inflateRawSync } from "node:zlib";

/**
 * Bounded ZIP reader for Office Open XML packages (FR-SI-01 Subset B, NFR-SEC-02; specs/009 T014).
 * Reads the central directory only, supports stored/deflate entries, rejects encrypted entries, oversized entry
 * counts and anything that would inflate beyond the uncompressed budget (zip bombs) instead of expanding it.
 */

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

export interface ZipLimits {
  /** Total uncompressed bytes the archive may expand to. */
  maxUncompressedBytes?: number;
  maxEntries?: number;
}

export const DEFAULT_ZIP_LIMITS = { maxUncompressedBytes: 512 * 1024 * 1024, maxEntries: 20_000 } as const;

export interface ZipEntryInfo {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  encrypted: boolean;
}

function findEndOfCentralDirectory(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === 0x06054b50) return i;
  throw new ZipError("Not a ZIP archive");
}

export class ZipArchive {
  readonly entries = new Map<string, ZipEntryInfo>();
  private readonly buf: Buffer;
  private readonly budget: number;
  private inflated = 0;

  constructor(buf: Buffer, limits: ZipLimits = {}) {
    this.buf = buf;
    this.budget = limits.maxUncompressedBytes ?? DEFAULT_ZIP_LIMITS.maxUncompressedBytes;
    if (buf.length < 22) throw new ZipError("Not a ZIP archive");
    const eocd = findEndOfCentralDirectory(buf);
    const count = buf.readUInt16LE(eocd + 10);
    const size = buf.readUInt32LE(eocd + 12);
    let offset = buf.readUInt32LE(eocd + 16);
    if (count > (limits.maxEntries ?? DEFAULT_ZIP_LIMITS.maxEntries)) throw new ZipError("Too many ZIP entries");
    if (offset + size > buf.length) throw new ZipError("Truncated ZIP central directory");
    for (let i = 0; i < count; i++) {
      if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) throw new ZipError("Corrupt ZIP central directory");
      const flags = buf.readUInt16LE(offset + 8);
      const nameLength = buf.readUInt16LE(offset + 28);
      const extraLength = buf.readUInt16LE(offset + 30);
      const commentLength = buf.readUInt16LE(offset + 32);
      const name = buf.toString("utf8", offset + 46, offset + 46 + nameLength);
      this.entries.set(name, {
        name,
        method: buf.readUInt16LE(offset + 10),
        compressedSize: buf.readUInt32LE(offset + 20),
        uncompressedSize: buf.readUInt32LE(offset + 24),
        localOffset: buf.readUInt32LE(offset + 42),
        encrypted: (flags & 1) === 1,
      });
      offset += 46 + nameLength + extraLength + commentLength;
    }
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** Inflates one entry, enforcing the archive-wide uncompressed budget even if headers lie. */
  read(name: string): Buffer {
    const entry = this.entries.get(name);
    if (!entry) throw new ZipError(`Missing ZIP entry ${name}`);
    if (entry.encrypted) throw new ZipError("Encrypted ZIP entry");
    const local = entry.localOffset;
    if (local + 30 > this.buf.length || this.buf.readUInt32LE(local) !== 0x04034b50) throw new ZipError("Corrupt ZIP local header");
    const start = local + 30 + this.buf.readUInt16LE(local + 26) + this.buf.readUInt16LE(local + 28);
    const end = start + entry.compressedSize;
    if (end > this.buf.length) throw new ZipError("Truncated ZIP entry");
    const remaining = this.budget - this.inflated;
    if (entry.uncompressedSize > remaining) throw new ZipError("ZIP expands beyond the allowed size");
    let data: Buffer;
    if (entry.method === 0) data = Buffer.from(this.buf.subarray(start, end));
    else if (entry.method === 8) {
      try {
        data = inflateRawSync(this.buf.subarray(start, end), { maxOutputLength: Math.max(1, remaining) });
      } catch {
        throw new ZipError("ZIP expands beyond the allowed size or is corrupt");
      }
    } else throw new ZipError("Unsupported ZIP compression");
    this.inflated += data.length;
    return data;
  }

  readText(name: string): string {
    return this.read(name).toString("utf8");
  }
}
