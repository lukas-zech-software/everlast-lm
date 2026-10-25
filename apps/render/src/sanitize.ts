import { JSDOM } from "jsdom";
import { readZipEntries, writeZip } from "./zip.ts";

/**
 * OOXML sanitization before LibreOffice conversion (FR-SI-01, NFR-SEC-02; specs/009 security review 2026-10-23).
 *
 * - Parts are classified by their content type from `[Content_Types].xml` (case-insensitive part names), never by
 *   file-name extension alone. Only allowlisted content types survive (Office XML parts, package relationships and
 *   core properties, raster/metafile images); OLE, ActiveX, VBA, external links, SVG and unknown parts are dropped.
 * - Every XML part is parsed with a namespace-aware XML parser (jsdom/saxes: no DTD or external entity resolution);
 *   malformed XML aborts the conversion.
 * - Only parts reachable from `_rels/.rels` through allowlisted relationship Types survive; `.rels` files are
 *   rebuilt from validated relationships (Internal TargetMode, no scheme/backslash, resolving to a kept part),
 *   dangerous part names are denied outright and images must pass a magic-byte check.
 * - Field instructions (`instrText`), `fldSimple` wrappers (their cached result stays), OLE objects, ActiveX
 *   controls, sub-documents, alt-chunks and DDE/external references are removed by namespace URI, whatever prefix.
 */

const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const RELS_TYPE = "application/vnd.openxmlformats-package.relationships+xml";

const NS = {
  wml: ["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"],
  sml: ["http://schemas.openxmlformats.org/spreadsheetml/2006/main", "http://purl.oclc.org/ooxml/spreadsheetml/main"],
  pml: ["http://schemas.openxmlformats.org/presentationml/2006/main", "http://purl.oclc.org/ooxml/presentationml/main"],
};
const REMOVE: [string[], string[]][] = [
  [NS.wml, ["instrText", "object", "control", "subDoc", "altChunk"]],
  [NS.sml, ["ddeLink", "oleObjects", "oleObject", "controls", "externalReferences", "externalReference"]],
  [NS.pml, ["oleObj", "control", "controls"]],
];
const UNWRAP: [string[], string[]][] = [[NS.wml, ["fldSimple"]]];

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/bmp", "image/tiff", "image/x-emf", "image/x-wmf"]);
const BANNED_TYPE = /oleobject|activex|externallink|vba|macro|control|binary|package$|embedd/i;

export type PartKind = "xml" | "image" | null;

export function allowedPartKind(contentType: string | undefined): PartKind {
  if (!contentType) return null;
  const type = contentType.toLowerCase().trim();
  if (IMAGE_TYPES.has(type)) return "image";
  if (BANNED_TYPE.test(type)) return null;
  if (type === RELS_TYPE || type === "application/vnd.openxmlformats-package.core-properties+xml" || type === "application/xml") return "xml";
  if (/^application\/vnd\.openxmlformats-officedocument\.[a-z0-9.-]+\+xml$/.test(type)) return "xml";
  return null;
}

function parseXml(xml: string): Document {
  // jsdom's XML mode (saxes) is namespace-aware, rejects malformed input and never loads DTDs or external entities.
  return new JSDOM(xml, { contentType: "application/xml" }).window.document as unknown as Document;
}

function serialize(doc: Document): Buffer {
  const xml = new (doc.defaultView as unknown as { XMLSerializer: typeof XMLSerializer }).XMLSerializer().serializeToString(doc);
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml.replace(/^<\?xml[^>]*\?>\s*/, "")}`, "utf8");
}

function safeName(name: string): boolean {
  return !name.includes("\\") && !name.startsWith("/") && !name.split("/").includes("..") && name.length > 0 && name.length <= 512;
}

/** Resolves a relationship target against the source part directory; null if it escapes the package. */
function resolveTarget(baseDir: string, target: string): string | null {
  const parts = target.startsWith("/") ? [] : baseDir.split("/").filter(Boolean);
  for (const seg of target.split("#")[0]!.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(decodeURIComponent(seg));
  }
  return parts.join("/");
}

const RT_BASES = ["http://schemas.openxmlformats.org/officeDocument/2006/relationships/", "http://purl.oclc.org/ooxml/officeDocument/relationships/"];
const RT_NAMES = [
  "officeDocument", "styles", "stylesWithEffects", "image", "header", "footer", "theme", "themeOverride", "notesSlide", "notesMaster",
  "slide", "slideLayout", "slideMaster", "handoutMaster", "numbering", "settings", "fontTable", "webSettings", "footnotes", "endnotes",
  "comments", "presProps", "viewProps", "tableStyles", "extended-properties", "chart", "chartUserShapes", "diagramData",
  "diagramLayout", "diagramQuickStyle", "diagramColors", "glossaryDocument",
];
const ALLOWED_REL_TYPES = new Set([
  ...RT_BASES.flatMap((base) => RT_NAMES.map((n) => base + n)),
  "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
  "http://schemas.microsoft.com/office/2007/relationships/stylesWithEffects",
  "http://schemas.microsoft.com/office/2007/relationships/diagramDrawing",
]);
/** Parts that are never passed on, whatever their declared content type or relationship. */
const DANGEROUS_NAME = /(^|\/)(embeddings|activex|externallinks|customxml|vbaproject)[^/]*(\/|$)|vba(project|data)|oleobject|\.bin$|\.(exe|dll|js|vbs|ps1|lnk|ole)$/i;

/** Magic-byte check: the declared image type is not trusted (PNG, JPEG, GIF, BMP, TIFF, EMF, WMF). */
export function isAllowedImage(data: Buffer): boolean {
  const ascii = (from: number, to: number) => data.subarray(from, to).toString("latin1");
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return true;
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return true;
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return true;
  if (ascii(0, 2) === "BM" && data.length > 14) return true;
  if (ascii(0, 4) === "II*\u0000" || ascii(0, 4) === "MM\u0000*") return true;
  if (data.length >= 44 && data.readUInt32LE(0) === 1 && ascii(40, 44) === " EMF") return true;
  if (data.length >= 4 && (data.readUInt32LE(0) === 0x9ac6cdd7 || data.readUInt32LE(0) === 0x00090001 || data.readUInt32LE(0) === 0x00090002)) return true;
  return false;
}

const attr = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function relsPathFor(part: string): string {
  const slash = part.lastIndexOf("/");
  return slash < 0 ? `_rels/${part}.rels` : `${part.slice(0, slash)}/_rels/${part.slice(slash + 1)}.rels`;
}

/**
 * Round 3 (security review 2026-10-23): the output contains only parts reachable from the package relationships
 * through allowlisted relationship Types; every `.rels` file must have a `Relationships` root in the package
 * relationship namespace (else the document is rejected) and is rebuilt from scratch from validated entries only.
 * Declared content types are a necessary, not a sufficient, condition; images must also pass a magic-byte check.
 */
export function sanitizeOoxml(bytes: Buffer): Buffer {
  const entries = readZipEntries(bytes);
  const byLower = new Map<string, string>();
  for (const name of entries.keys()) {
    if (!safeName(name)) throw new Error("Unsafe part name");
    if (byLower.has(name.toLowerCase())) throw new Error("Duplicate part name (case-insensitive)");
    byLower.set(name.toLowerCase(), name);
  }
  const typesName = byLower.get("[content_types].xml");
  if (!typesName) throw new Error("Missing [Content_Types].xml");
  const types = parseXml(entries.get(typesName)!.toString("utf8"));
  if (types.documentElement.namespaceURI !== CT_NS || types.documentElement.localName !== "Types") throw new Error("Invalid [Content_Types].xml");
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  for (const el of Array.from(types.getElementsByTagNameNS(CT_NS, "Default"))) defaults.set((el.getAttribute("Extension") ?? "").toLowerCase(), el.getAttribute("ContentType") ?? "");
  for (const el of Array.from(types.getElementsByTagNameNS(CT_NS, "Override"))) overrides.set((el.getAttribute("PartName") ?? "").toLowerCase(), el.getAttribute("ContentType") ?? "");
  const contentTypeOf = (name: string) => {
    const lower = name.toLowerCase();
    return overrides.get(`/${lower}`) ?? defaults.get(/\.([^./]+)$/.exec(lower)?.[1] ?? "");
  };
  const partKind = (name: string): Exclude<PartKind, null> | null => {
    if (DANGEROUS_NAME.test(name)) return null;
    const kind = allowedPartKind(contentTypeOf(name));
    if (kind === "image" && !isAllowedImage(entries.get(name)!)) return null;
    return kind === "xml" && (contentTypeOf(name) ?? "").toLowerCase() === RELS_TYPE ? null : kind;
  };

  const out = new Map<string, Buffer>();
  const reachable = new Set<string>();
  const queue: { rels: string; base: string }[] = [{ rels: "_rels/.rels", base: "" }];
  const visitedRels = new Set<string>();
  while (queue.length) {
    const { rels, base } = queue.shift()!;
    const relsName = byLower.get(rels.toLowerCase());
    if (!relsName || visitedRels.has(relsName)) {
      if (rels === "_rels/.rels") throw new Error("Missing package relationships");
      continue;
    }
    visitedRels.add(relsName);
    const doc = parseXml(entries.get(relsName)!.toString("utf8"));
    const root = doc.documentElement;
    if (root.namespaceURI !== REL_NS || root.localName !== "Relationships") throw new Error("Invalid relationships part");
    const kept: string[] = [];
    for (const rel of Array.from(root.children)) {
      if (rel.namespaceURI !== REL_NS || rel.localName !== "Relationship") continue;
      const id = rel.getAttribute("Id") ?? "";
      const type = (rel.getAttribute("Type") ?? "").trim();
      const target = (rel.getAttribute("Target") ?? "").trim();
      const mode = (rel.getAttribute("TargetMode") ?? "Internal").trim().toLowerCase();
      if (!/^[A-Za-z_][\w.-]{0,63}$/.test(id) || !ALLOWED_REL_TYPES.has(type) || mode !== "internal") continue;
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.includes("\\")) continue;
      const resolved = resolveTarget(base, target);
      const partName = resolved === null ? undefined : byLower.get(resolved.toLowerCase());
      if (!partName || partName === typesName || !partKind(partName)) continue;
      kept.push(`<Relationship Id="${attr(id)}" Type="${attr(type)}" Target="${attr(target)}"/>`);
      if (!reachable.has(partName)) {
        reachable.add(partName);
        const slash = partName.lastIndexOf("/");
        queue.push({ rels: relsPathFor(partName), base: slash < 0 ? "" : partName.slice(0, slash) });
      }
    }
    out.set(relsName, Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}">${kept.join("")}</Relationships>`, "utf8"));
  }

  for (const name of reachable) {
    const kind = partKind(name)!;
    const data = entries.get(name)!;
    if (kind === "image") {
      out.set(name, data);
      continue;
    }
    const doc = parseXml(data.toString("utf8"));
    for (const [namespaces, locals] of REMOVE) {
      for (const ns of namespaces) for (const local of locals) for (const el of Array.from(doc.getElementsByTagNameNS(ns, local))) el.parentNode?.removeChild(el);
    }
    for (const [namespaces, locals] of UNWRAP) {
      for (const ns of namespaces)
        for (const local of locals)
          for (const el of Array.from(doc.getElementsByTagNameNS(ns, local))) {
            while (el.firstChild) el.parentNode?.insertBefore(el.firstChild, el);
            el.parentNode?.removeChild(el);
          }
    }
    out.set(name, serialize(doc));
  }
  const keptLower = new Set([...out.keys()].map((n) => n.toLowerCase()));
  for (const el of Array.from(types.getElementsByTagNameNS(CT_NS, "Override"))) {
    const part = (el.getAttribute("PartName") ?? "").replace(/^\//, "").toLowerCase();
    if (!keptLower.has(part)) el.parentNode?.removeChild(el);
  }
  return writeZip(new Map([[typesName, serialize(types)], ...out]));
}
