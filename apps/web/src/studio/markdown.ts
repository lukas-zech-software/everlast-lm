/**
 * Minimal safe Markdown for generated reports (FR-ST-10 FR-008). Both renderers share one block parser; the HTML
 * string renderer escapes every input character, and the DOM renderer only creates elements and text nodes (it
 * never parses HTML). Inline parsing is a linear scanner, so no backtracking regex runs over report text.
 */

export type MarkdownInline = { type: "text"; text: string } | { type: "strong" | "em"; text: string } | { type: "badge"; number: number };

export type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "quote"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "paragraph"; text: string };

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";
const isWordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Splits one line into text, **strong**, _em_ and [n] badge tokens. */
export function parseInline(line: string): MarkdownInline[] {
  const out: MarkdownInline[] = [];
  let text = "";
  const flush = () => {
    if (text) out.push({ type: "text", text });
    text = "";
  };
  let i = 0;
  while (i < line.length) {
    const c = line[i]!;
    if (c === "*" && line[i + 1] === "*") {
      const end = line.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ type: "strong", text: line.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (c === "_" && !isWordChar(line[i - 1])) {
      const end = line.indexOf("_", i + 1);
      if (end > i + 1 && !isWordChar(line[end + 1])) {
        flush();
        out.push({ type: "em", text: line.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (c === "[" && isDigit(line[i + 1])) {
      let j = i + 1;
      while (j < line.length && j - i <= 6 && isDigit(line[j])) j++;
      if (line[j] === "]") {
        flush();
        out.push({ type: "badge", number: Number(line.slice(i + 1, j)) });
        i = j + 1;
        continue;
      }
    }
    text += c;
    i++;
  }
  flush();
  return out;
}

/** Splits a table row on unescaped `|` (single pass). */
function splitRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === "\\" && (body[i + 1] === "|" || body[i + 1] === "\\")) {
      cell += body[i + 1];
      i++;
    } else if (c === "|") {
      cells.push(cell.trim());
      cell = "";
    } else cell += c;
  }
  cells.push(cell.trim());
  return cells;
}

function headingOf(line: string): { level: number; text: string } | null {
  let level = 0;
  while (level < line.length && line[level] === "#") level++;
  if (level < 1 || level > 6 || line[level] !== " ") return null;
  return { level, text: line.slice(level + 1) };
}

function listItem(line: string): { ordered: boolean; text: string } | null {
  const t = line.trimStart();
  if (t.startsWith("- ")) return { ordered: false, text: t.slice(2) };
  let j = 0;
  while (isDigit(t[j])) j++;
  if (j > 0 && t[j] === "." && t[j + 1] === " ") return { ordered: true, text: t.slice(j + 2) };
  return null;
}

export function parseMarkdown(md: string): MarkdownBlock[] {
  const lines = md.split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const heading = headingOf(line);
    const first = listItem(line);
    if (line.trim() === "") {
      i++;
    } else if (heading) {
      blocks.push({ type: "heading", ...heading });
      i++;
    } else if (line.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) rows.push(lines[i++]!);
      const [head, , ...body] = rows;
      blocks.push({ type: "table", head: splitRow(head ?? ""), rows: body.map(splitRow) });
    } else if (line.startsWith("> ")) {
      blocks.push({ type: "quote", text: line.slice(2) });
      i++;
    } else if (first) {
      const items: string[] = [];
      for (let item: ReturnType<typeof listItem> = first; item; item = i < lines.length ? listItem(lines[i]!) : null) {
        items.push(item.text);
        i++;
      }
      blocks.push({ type: "list", ordered: first.ordered, items });
    } else {
      blocks.push({ type: "paragraph", text: line });
      i++;
    }
  }
  return blocks;
}

const inlineHtml = (s: string): string =>
  parseInline(s)
    .map((t) =>
      t.type === "text"
        ? escapeHtml(t.text)
        : t.type === "badge"
          ? `<sup class="citation-badge" data-badge="${t.number}">[${t.number}]</sup>`
          : `<${t.type}>${escapeHtml(t.text)}</${t.type}>`
    )
    .join("");

/** HTML string rendering; every character of the input is escaped. */
export function renderMarkdown(md: string): string {
  return parseMarkdown(md)
    .map((b) => {
      switch (b.type) {
        case "heading":
          return `<h${b.level}>${inlineHtml(b.text)}</h${b.level}>`;
        case "table": {
          const th = b.head.map((c) => `<th>${inlineHtml(c)}</th>`).join("");
          const tr = b.rows.map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join("")}</tr>`).join("");
          return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
        }
        case "quote":
          return `<blockquote>${inlineHtml(b.text)}</blockquote>`;
        case "list": {
          const tag = b.ordered ? "ol" : "ul";
          return `<${tag}>${b.items.map((x) => `<li>${inlineHtml(x)}</li>`).join("")}</${tag}>`;
        }
        default:
          return `<p>${inlineHtml(b.text)}</p>`;
      }
    })
    .join("\n");
}

export interface MarkdownDomOptions {
  /** A badge element for a verified citation number, or null to keep the marker as text. */
  badge(number: number): Node | null;
  /** Stable section key for a `##` heading (FR-005a), if any. */
  sectionKey?(heading: string): string | undefined;
}

/** DOM rendering through createElement/createTextNode only (no HTML parsing, FR-008). */
export function renderMarkdownNodes(md: string, options: MarkdownDomOptions): Node[] {
  const el = (tag: string, children: Node[] = []): HTMLElement => {
    const node = document.createElement(tag);
    for (const child of children) node.append(child);
    return node;
  };
  const inline = (s: string): Node[] =>
    parseInline(s).map((t) => {
      if (t.type === "text") return document.createTextNode(t.text);
      if (t.type === "badge") return options.badge(t.number) ?? document.createTextNode(`[${t.number}]`);
      return el(t.type, [document.createTextNode(t.text)]);
    });
  return parseMarkdown(md).map((b) => {
    switch (b.type) {
      case "heading": {
        const node = el(`h${b.level}`, inline(b.text));
        const key = b.level === 2 ? options.sectionKey?.(b.text) : undefined;
        if (key) node.setAttribute("data-section-key", key);
        return node;
      }
      case "table":
        return el("table", [
          el("thead", [el("tr", b.head.map((c) => el("th", inline(c))))]),
          el("tbody", b.rows.map((r) => el("tr", r.map((c) => el("td", inline(c)))))),
        ]);
      case "quote":
        return el("blockquote", inline(b.text));
      case "list":
        return el(b.ordered ? "ol" : "ul", b.items.map((x) => el("li", inline(x))));
      default:
        return el("p", inline(b.text));
    }
  });
}
