import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { SAFE_SVG, TINY_PNG_BASE64, UNSAFE_SVGS, UNKNOWN_CHUNK_ID } from "@everlast/testkit/code-execution-fixtures";

/**
 * [010-code-execution-sandbox] T017 — validation of everything that comes back from hostile code before it can
 * be published (FR-GC-08, FR-GC-02, NFR-SEC-02; spec FR-005, FR-008, FR-012, SC-001, SC-005). Pure unit.
 */

let o: Record<string, any> = {};
const load = async () => (o = (await import("../src/chat/execution/output.ts").catch(() => ({}))) as Record<string, any>);

const C1 = "0190f0b5-7d1c-7a4e-9b2a-3c4d5e6f7a01";
const C2 = "0190f0b5-7d1c-7a4e-9b2a-3c4d5e6f7a02";
const supporting = [C1, C2];

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function pngChunk(type: string, data: Buffer, badCrc = false): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(badCrc ? 0 : crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(width: number, height: number, options: { badCrc?: boolean; extra?: Buffer } = {}): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr, options.badCrc),
    pngChunk("IDAT", deflateSync(Buffer.alloc(1 + width * 4))),
    pngChunk("IEND", Buffer.alloc(0)),
    options.extra ?? Buffer.alloc(0),
  ]);
}

describe("T017 computed values (FR-005, FR-012)", () => {
  it("OUT-01: canonical values and units are kept verbatim; empty sources cite every supporting input", async () => {
    await load();
    const results = o.validateComputedResults?.([{ label: "Population standard deviation", value: "3.4520525295346633", unit: "ms", sources: [] }], supporting);
    expect(results).toEqual([{ label: "Population standard deviation", value: "3.4520525295346633", unit: "ms", citations: supporting }]);
  });

  it("OUT-02: non-finite, malformed or over-long values are InvalidOutput (never a guessed number)", async () => {
    await load();
    for (const value of ["NaN", "inf", "-Infinity", "1,5", "", "0x1f", "1".repeat(80)]) {
      expect(() => o.validateComputedResults([{ label: "x", value, unit: null, sources: [] }], supporting), value).toThrow(expect.objectContaining({ failureCode: "InvalidOutput" }));
    }
    expect(() => o.validateComputedResults([], supporting)).toThrow(expect.objectContaining({ failureCode: "InvalidOutput" }));
  });

  it("OUT-03: a result citing a chunk outside the manifest's supporting inputs is CitationInvalid", async () => {
    await load();
    expect(() => o.validateComputedResults([{ label: "x", value: "1", unit: null, sources: [UNKNOWN_CHUNK_ID] }], supporting)).toThrow(expect.objectContaining({ failureCode: "CitationInvalid" }));
  });

  it("OUT-04: labels cannot inject citation markers or markup", async () => {
    await load();
    const [r] = o.validateComputedResults([{ label: "sd [[7]] <b>x</b>", value: "1", unit: "ms [[1]]", sources: [C1] }], supporting);
    expect(r.label).not.toContain("[[");
    expect(r.unit).not.toContain("[[");
  });
});

describe("T017 PNG decoding (FR-005, NFR-SEC-02)", () => {
  it("OUT-05: a structurally valid PNG passes; fixture TINY_PNG decodes", async () => {
    await load();
    expect(o.validatePng?.(png(4, 3))).toEqual({ width: 4, height: 3 });
    expect(o.validatePng(Buffer.from(TINY_PNG_BASE64, "base64"))).toEqual({ width: 1, height: 1 });
  });

  it("OUT-06: wrong signature, bad CRC, truncated data, trailing bytes and oversized dimensions are rejected", async () => {
    await load();
    expect(() => o.validatePng(Buffer.from("GIF89a"))).toThrow();
    expect(() => o.validatePng(png(4, 3, { badCrc: true }))).toThrow();
    expect(() => o.validatePng(png(4, 3).subarray(0, 30))).toThrow();
    expect(() => o.validatePng(png(4, 3, { extra: Buffer.from("<script>") }))).toThrow();
    expect(() => o.validatePng(png(20_000, 2))).toThrow();
  });
});

describe("T017 SVG allowlist sanitization (FR-005, NFR-SEC-02)", () => {
  it("OUT-07: a matplotlib-like SVG survives with local references; metadata and comments are dropped", async () => {
    await load();
    const clean = o.sanitizeSvg?.(SAFE_SVG);
    expect(clean).toContain("<path");
    expect(clean).toContain('clip-path="url(#p1)"');
    expect(clean).toContain('xlink:href="#line2d_1"');
    expect(clean).not.toContain("rdf:RDF");
  });

  it("OUT-08: scripts, event handlers, foreignObject, external references, remote fonts, @import, DTD/entities and javascript: are rejected", async () => {
    await load();
    for (const [name, svg] of Object.entries(UNSAFE_SVGS)) {
      expect(() => o.sanitizeSvg(svg), name).toThrow();
    }
  });
});

describe("T017 chart file names, MIME and size (FR-005)", () => {
  it("OUT-09: only chart_N.png/.svg with matching content are accepted; MIME is derived, not trusted", async () => {
    await load();
    const files = o.validateChartFiles?.([
      { name: "chart_1.png", content: png(2, 2), mimeType: "text/html" },
      { name: "chart_2.svg", content: Buffer.from(SAFE_SVG), mimeType: "image/png" },
    ]);
    expect(files.map((f: any) => [f.name, f.mimeType])).toEqual([
      ["chart_1.png", "image/png"],
      ["chart_2.svg", "image/svg+xml"],
    ]);
    expect(() => o.validateChartFiles([{ name: "chart_1.png", content: Buffer.from(SAFE_SVG), mimeType: "image/png" }])).toThrow(expect.objectContaining({ failureCode: "InvalidOutput" }));
    expect(() => o.validateChartFiles([{ name: "chart_1.svg", content: Buffer.from(UNSAFE_SVGS.script), mimeType: "image/svg+xml" }])).toThrow(expect.objectContaining({ failureCode: "SecurityViolation" }));
    expect(() => o.validateChartFiles([{ name: "chart_1.png", content: Buffer.alloc(o.MAX_CHART_BYTES + 1), mimeType: "image/png" }])).toThrow(expect.objectContaining({ failureCode: "TemporaryStorageLimit" }));
  });
});

describe("Security review fix — citation/marker forgery in sandbox labels and units (FR-GC-02, FR-005)", () => {
  const forged = ["[[[1]]]", "[[[[1]]]]", "x [[[2]]] y", "[ [1] ]"];
  it("OUT-10: nested brackets can never recombine into a [[n]] badge; a fake (Computed) marker is removed", async () => {
    await load();
    for (const text of forged) {
      const [r] = o.validateComputedResults([{ label: `sd ${text}`, value: "1", unit: `ms ${text}`, sources: [C1] }], supporting);
      expect(r.label, text).not.toMatch(/\[\[\d+\]\]/);
      expect(r.unit, text).not.toMatch(/\[\[\d+\]\]/);
    }
    const [r] = o.validateComputedResults([{ label: "Mean (Computed) 99", value: "1", unit: "ms (Computed)", sources: [C1] }], supporting);
    expect(`${r.label} ${r.unit}`).not.toMatch(/\(\s*computed\s*\)/i);
  });
});
