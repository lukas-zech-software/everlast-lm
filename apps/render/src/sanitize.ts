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
 * - Relationships are dropped when TargetMode is not Internal, the Target has a URI scheme or a backslash, escapes
 *   the package, or does not resolve to a kept part (absolute paths outside the package therefore never survive).
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

function relsBaseDir(relsName: string): string {
  // word/_rels/document.xml.rels → source part word/document.xml → base dir "word"; _rels/.rels → package root.
  const lower = relsName;
  const idx = lower.toLowerCase().lastIndexOf("_rels/");
  return idx <= 0 ? "" : lower.slice(0, idx - 1);
}

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
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  for (const el of Array.from(types.getElementsByTagNameNS(CT_NS, "Default"))) defaults.set((el.getAttribute("Extension") ?? "").toLowerCase(), el.getAttribute("ContentType") ?? "");
  for (const el of Array.from(types.getElementsByTagNameNS(CT_NS, "Override"))) overrides.set((el.getAttribute("PartName") ?? "").toLowerCase(), el.getAttribute("ContentType") ?? "");
  const contentTypeOf = (name: string) => {
    const lower = name.toLowerCase();
    return overrides.get(`/${lower}`) ?? defaults.get(/\.([^./]+)$/.exec(lower)?.[1] ?? "");
  };

  const kept = new Map<string, { kind: Exclude<PartKind, null>; data: Buffer; type: string }>();
  for (const [name, data] of entries) {
    if (name === typesName) continue;
    const type = contentTypeOf(name);
    const kind = allowedPartKind(type);
    if (kind) kept.set(name, { kind, data, type: type!.toLowerCase() });
  }
  const keptLower = new Set([...kept.keys()].map((n) => n.toLowerCase()));

  const out = new Map<string, Buffer>();
  for (const [name, part] of kept) {
    if (part.kind === "image") {
      out.set(name, part.data);
      continue;
    }
    const doc = parseXml(part.data.toString("utf8"));
    if (part.type === RELS_TYPE) {
      const base = relsBaseDir(name);
      for (const rel of Array.from(doc.getElementsByTagNameNS(REL_NS, "Relationship"))) {
        const target = (rel.getAttribute("Target") ?? "").trim();
        const mode = (rel.getAttribute("TargetMode") ?? "Internal").trim().toLowerCase();
        const resolved = mode === "internal" && !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.includes("\\") ? resolveTarget(base, target) : null;
        if (!target || resolved === null || !keptLower.has(resolved.toLowerCase())) rel.parentNode?.removeChild(rel);
      }
    } else {
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
    }
    out.set(name, serialize(doc));
  }
  for (const el of Array.from(types.getElementsByTagNameNS(CT_NS, "Override"))) {
    const part = (el.getAttribute("PartName") ?? "").replace(/^\//, "").toLowerCase();
    if (!keptLower.has(part)) el.parentNode?.removeChild(el);
  }
  return writeZip(new Map([[typesName, serialize(types)], ...out]));
}
