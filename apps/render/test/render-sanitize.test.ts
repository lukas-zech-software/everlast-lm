import { describe, expect, it } from "vitest";
import { buildZip } from "@everlast/testkit/ooxml-builder";
import { sanitizeOoxml } from "../src/main.ts";
import { readZipEntries } from "../src/zip.ts";

/**
 * [009-multimodal-ingestion-sync] security review 2026-10-23 (round 2) — robust OOXML sanitization before
 * LibreOffice (FR-SI-01, NFR-SEC-02): namespace-aware XML parsing instead of regexes, parts chosen by content
 * type (not file-name case), allowlisted content types only, and a strict zip reader (budget before inflate,
 * stored entries counted, local/central size agreement, no overlapping or out-of-range entries).
 */

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const TYPES = (extra = "") =>
  `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${extra}</Types>`;

function sanitized(entries: { name: string; data: string }[]) {
  return readZipEntries(sanitizeOoxml(buildZip(entries)));
}

describe("relationship sanitization is parser-based (NFR-SEC-02)", () => {
  it("SAN-01: quoting, element form, attribute order/whitespace and case variants of external targets are all removed", () => {
    const rels = `<Relationships xmlns="${REL}">
      <Relationship Id='rA' Type='http://x/image' Target='file:///etc/passwd' TargetMode='External'/>
      <Relationship TargetMode="EXTERNAL"   Target="media/ok.png" Id="rB" Type="http://x/image"></Relationship>
      <Relationship
         Target = "HTTP://169.254.169.254/latest" Id="rC" Type="http://x/hyperlink" />
      <Relationship Id="rD" Type="http://x/image" Target="/etc/hosts"/>
      <Relationship Id="rE" Type="http://x/image" Target="media/ok.png"/>
    </Relationships>`;
    const out = sanitized([
      { name: "[Content_Types].xml", data: TYPES() },
      { name: "word/_rels/document.xml.rels", data: rels },
      { name: "word/document.xml", data: `<w:document xmlns:w="${W}"><w:body/></w:document>` },
      { name: "word/media/ok.png", data: "png" },
    ]);
    const kept = out.get("word/_rels/document.xml.rels")!.toString();
    expect(kept).toContain('Id="rE"');
    for (const bad of ["rA", "rB", "rC", "rD", "passwd", "169.254", "/etc/hosts"]) expect(kept).not.toContain(bad);
  });

  it("SAN-02: field instructions are removed by namespace URI whatever the prefix; field results stay", () => {
    const doc = `<x:document xmlns:x="${W}"><x:body><x:p><x:r><x:instrText>DDEAUTO cmd "/c calc"</x:instrText></x:r><x:fldSimple x:instr='INCLUDETEXT "http://evil/x"'><x:r><x:t>Cached</x:t></x:r></x:fldSimple></x:p></x:body></x:document>`;
    const out = sanitized([{ name: "[Content_Types].xml", data: TYPES() }, { name: "word/document.xml", data: doc }]);
    const text = out.get("word/document.xml")!.toString();
    expect(text).not.toMatch(/DDE|INCLUDETEXT|evil|instrText|fldSimple/);
    expect(text).toContain("Cached");
  });
});

describe("parts are selected by content type, not file-name case (NFR-SEC-02)", () => {
  it("SAN-03: an upper-case .RELS part and a renamed XML part declared in [Content_Types] are still sanitized", () => {
    const out = sanitized([
      { name: "[Content_Types].xml", data: TYPES(`<Override PartName="/word/custom.dat" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>`) },
      { name: "word/_rels/document.xml.RELS", data: `<Relationships xmlns="${REL}"><Relationship Id="r1" Type="t" Target="http://evil/x" TargetMode="External"/></Relationships>` },
      { name: "word/document.xml", data: `<w:document xmlns:w="${W}"><w:body/></w:document>` },
      { name: "word/custom.dat", data: `<w:ftr xmlns:w="${W}"><w:p><w:r><w:instrText>INCLUDEPICTURE "http://evil/p.png"</w:instrText></w:r></w:p></w:ftr>` },
    ]);
    expect(out.get("word/_rels/document.xml.RELS")!.toString()).not.toContain("evil");
    expect(out.get("word/custom.dat")!.toString()).not.toContain("evil");
  });

  it("SAN-04: parts with missing or non-allowlisted content types are dropped", () => {
    const out = sanitized([
      { name: "[Content_Types].xml", data: TYPES(`<Override PartName="/word/x.svg" ContentType="image/svg+xml"/><Override PartName="/word/ole.dat" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>`) },
      { name: "word/document.xml", data: `<w:document xmlns:w="${W}"><w:body/></w:document>` },
      { name: "word/x.svg", data: '<svg xmlns="http://www.w3.org/2000/svg"><image href="http://evil/"/></svg>' },
      { name: "word/ole.dat", data: "OLE" },
      { name: "word/unknown.bin2", data: "???" },
      { name: "word/media/ok.png", data: "png" },
    ]);
    expect([...out.keys()].sort()).toEqual(["[Content_Types].xml", "word/document.xml", "word/media/ok.png"]);
  });

  it("SAN-05: malformed XML in a sanitized part aborts the conversion instead of passing it through", () => {
    expect(() => sanitized([{ name: "[Content_Types].xml", data: TYPES() }, { name: "word/document.xml", data: "<w:document><w:body>" }])).toThrow();
  });
});

describe("strict zip reader (zip bombs, NFR-SEC-02)", () => {
  const archive = () => buildZip([{ name: "a.xml", data: "x".repeat(1000) }, { name: "b.xml", data: "y".repeat(1000) }]);

  it("SAN-06: the uncompressed budget is checked before inflating and counts stored entries", () => {
    expect(() => readZipEntries(archive(), { maxUncompressed: 1500 })).toThrow(/budget/i);
    expect(readZipEntries(archive(), { maxUncompressed: 2000 }).size).toBe(2);
  });

  it("SAN-07: central/local size disagreement, out-of-range and overlapping entries are rejected", () => {
    const lying = archive();
    const cd = lying.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    lying.writeUInt32LE(10, cd + 24); // central uncompressed size ≠ actual / local header
    expect(() => readZipEntries(lying)).toThrow();

    const outside = archive();
    const cd2 = outside.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    outside.writeUInt32LE(outside.length + 100, cd2 + 42); // local header offset beyond the buffer
    expect(() => readZipEntries(outside)).toThrow();

    const overlap = archive();
    const first = overlap.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const second = overlap.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), first + 4);
    overlap.writeUInt32LE(overlap.readUInt32LE(first + 42), second + 42); // both entries point at the same data
    expect(() => readZipEntries(overlap)).toThrow();
  });
});
