import { deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * Minimal bounded ZIP read/write for OOXML sanitization inside everlast-render (FR-SI-01, NFR-SEC-02; specs/009
 * security review 2026-10-23). Stored/deflate only; encrypted entries and archives expanding beyond the budget
 * are rejected.
 */

const MAX_UNCOMPRESSED = 512 * 1024 * 1024;
const MAX_ENTRIES = 20_000;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipReadOptions {
  maxUncompressed?: number;
}

interface CentralDirectoryEntry {
  method: number;
  compressed: number;
  uncompressed: number;
  name: string;
  local: number;
  nextOffset: number;
}

function findEocdOffset(buf: Buffer): number {
  const minOffset = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minOffset; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      return i;
    }
  }
  throw new Error("Not a ZIP archive");
}

function parseCentralHeader(buf: Buffer, offset: number, eocd: number): CentralDirectoryEntry {
  if (offset + 46 > eocd || buf.readUInt32LE(offset) !== 0x02014b50) {
    throw new Error("Corrupt ZIP central directory");
  }
  const flags = buf.readUInt16LE(offset + 8);
  if (flags & 1) {
    throw new Error("Encrypted ZIP entry");
  }
  const method = buf.readUInt16LE(offset + 10);
  const compressed = buf.readUInt32LE(offset + 20);
  const uncompressed = buf.readUInt32LE(offset + 24);
  const nameLength = buf.readUInt16LE(offset + 28);
  const extra = buf.readUInt16LE(offset + 30);
  const comment = buf.readUInt16LE(offset + 32);
  const local = buf.readUInt32LE(offset + 42);
  const name = buf.toString("utf8", offset + 46, offset + 46 + nameLength);
  return {
    method,
    compressed,
    uncompressed,
    name,
    local,
    nextOffset: offset + 46 + nameLength + extra + comment,
  };
}

function locateEntryData(
  buf: Buffer,
  entry: CentralDirectoryEntry,
  eocd: number,
): { start: number; end: number } {
  const { local, method, compressed, uncompressed } = entry;
  if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) {
    throw new Error("ZIP local header outside the archive");
  }
  if (buf.readUInt16LE(local + 8) !== method) {
    throw new Error("ZIP header mismatch");
  }
  const descriptor = (buf.readUInt16LE(local + 6) & 0x08) !== 0;
  if (
    !descriptor &&
    (buf.readUInt32LE(local + 18) !== compressed || buf.readUInt32LE(local + 22) !== uncompressed)
  ) {
    throw new Error("ZIP header size mismatch");
  }
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
  const end = start + compressed;
  if (end > buf.length || end > eocd) {
    throw new Error("ZIP entry outside the archive");
  }
  return { start, end };
}

function decompressEntryData(raw: Buffer, entry: CentralDirectoryEntry): Buffer {
  let data: Buffer;
  if (entry.method === 0) {
    if (entry.compressed !== entry.uncompressed) {
      throw new Error("ZIP stored size mismatch");
    }
    data = Buffer.from(raw);
  } else if (entry.method === 8) {
    data = inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.uncompressed) });
  } else {
    throw new Error("Unsupported ZIP compression");
  }
  if (data.length !== entry.uncompressed) {
    throw new Error("ZIP size mismatch");
  }
  return data;
}

function assertNonOverlappingRanges(ranges: Array<[number, number]>): void {
  ranges.sort((a, b) => a[0] - b[0]);
  let prevEnd = -1;
  for (const [start, end] of ranges) {
    if (start < prevEnd) {
      throw new Error("Overlapping ZIP entries");
    }
    prevEnd = end;
  }
}

/**
 * Strict reader: the budget is checked against each entry's declared size BEFORE inflating (stored entries count
 * too) and again against the actual output; central and local headers must agree on method and sizes (unless a
 * data descriptor is used); entry data must lie inside the buffer and entries may not overlap.
 */
export function readZipEntries(buf: Buffer, options: ZipReadOptions = {}): Map<string, Buffer> {
  const budget = options.maxUncompressed ?? MAX_UNCOMPRESSED;
  const eocd = findEocdOffset(buf);
  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES) {
    throw new Error("Too many ZIP entries");
  }
  let offset = buf.readUInt32LE(eocd + 16);
  let total = 0;
  const out = new Map<string, Buffer>();
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < count; i++) {
    const entry = parseCentralHeader(buf, offset, eocd);
    const { start, end } = locateEntryData(buf, entry, eocd);
    ranges.push([entry.local, end]);
    if (total + entry.uncompressed > budget) {
      throw new Error("ZIP expands beyond the uncompressed budget");
    }
    const data = decompressEntryData(buf.subarray(start, end), entry);
    total += data.length;
    if (total > budget) {
      throw new Error("ZIP expands beyond the uncompressed budget");
    }
    if (out.has(entry.name)) {
      throw new Error("Duplicate ZIP entry");
    }
    out.set(entry.name, data);
    offset = entry.nextOffset;
  }
  assertNonOverlappingRanges(ranges);
  return out;
}

export function writeZip(entries: Map<string, Buffer>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [entryName, raw] of entries) {
    const name = Buffer.from(entryName, "utf8");
    const compressed = deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + compressed.length;
  }
  const size = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.size, 8);
  end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
