/** Minimal safe Markdown → HTML for generated reports: all input is escaped first (FR-008). */
const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const inline = (s: string): string =>
  escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[(\d+)\]/g, '<sup class="citation-badge" data-badge="$1">[$1]</sup>');

const splitRow = (line: string): string[] =>
  line.replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));

export function renderMarkdown(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const heading = /^(#{1,6}) (.*)$/.exec(line);
    if (line.trim() === "") {
      i++;
    } else if (heading) {
      out.push(`<h${heading[1]!.length}>${inline(heading[2]!)}</h${heading[1]!.length}>`);
      i++;
    } else if (line.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) rows.push(lines[i++]!);
      const [head, , ...body] = rows;
      const th = splitRow(head ?? "").map((c) => `<th>${inline(c)}</th>`).join("");
      const tr = body.map((r) => `<tr>${splitRow(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("");
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`);
    } else if (line.startsWith("> ")) {
      out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
      i++;
    } else if (/^(- |\d+\. |\s+- )/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^(- |\d+\. |\s+- )/.test(lines[i]!)) {
        items.push(`<li>${inline(lines[i]!.replace(/^\s*(- |\d+\. )/, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
    } else {
      out.push(`<p>${inline(line)}</p>`);
      i++;
    }
  }
  return out.join("\n");
}
