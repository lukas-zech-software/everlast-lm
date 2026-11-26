/**
 * Minimal non-validating XML event reader for OOXML parts (FR-SI-01 Subset B; specs/009 T014). Only the five
 * predefined entities and numeric character references are decoded; DOCTYPE declarations, comments and
 * processing instructions are skipped, so no external entity or DTD is ever resolved (no XXE).
 */

export type XmlEvent =
  | { type: "open"; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { type: "close"; name: string }
  | { type: "text"; text: string };

const TOKEN =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function decodeXmlText(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, ref: string) => {
    if (ref === "amp") return "&";
    if (ref === "lt") return "<";
    if (ref === "gt") return ">";
    if (ref === "quot") return '"';
    if (ref === "apos") return "'";
    const code = ref.startsWith("#x")
      ? Number.parseInt(ref.slice(2), 16)
      : parseInt(ref.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

function parseXmlAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const attr of raw.matchAll(ATTR)) {
    const key = attr[1];
    if (key !== undefined) {
      attrs[key] = decodeXmlText(attr[2] ?? attr[3] ?? "");
    }
  }
  return attrs;
}

export function* xmlEvents(xml: string): Generator<XmlEvent> {
  for (const m of xml.matchAll(TOKEN)) {
    if (m[1] !== undefined) {
      yield { type: "text", text: m[1] };
    } else if (m[3] !== undefined) {
      if (m[2] === "/") {
        yield { type: "close", name: m[3] };
      } else {
        const selfClosing = m[5] === "/";
        yield {
          type: "open",
          name: m[3],
          attrs: parseXmlAttributes(m[4] ?? ""),
          selfClosing,
        };
        if (selfClosing) yield { type: "close", name: m[3] };
      }
    } else if (m[6] !== undefined) {
      yield { type: "text", text: decodeXmlText(m[6]) };
    }
  }
}
