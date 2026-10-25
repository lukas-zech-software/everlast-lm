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
    const code = ref.startsWith("#x") ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

export function* xmlEvents(xml: string): Generator<XmlEvent> {
  for (const m of xml.matchAll(TOKEN)) {
    if (m[1] !== undefined) {
      yield { type: "text", text: m[1] };
    } else if (m[3] !== undefined) {
      if (m[2] === "/") {
        yield { type: "close", name: m[3] };
      } else {
        const attrs: Record<string, string> = {};
        for (const a of (m[4] ?? "").matchAll(ATTR)) attrs[a[1]!] = decodeXmlText(a[2] ?? a[3] ?? "");
        const selfClosing = m[5] === "/";
        yield { type: "open", name: m[3], attrs, selfClosing };
        if (selfClosing) yield { type: "close", name: m[3] };
      }
    } else if (m[6] !== undefined) {
      yield { type: "text", text: decodeXmlText(m[6]) };
    }
  }
}
