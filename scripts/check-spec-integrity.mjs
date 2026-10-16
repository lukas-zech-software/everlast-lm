#!/usr/bin/env node
// Spec integrity check (no dependencies).
//  1. Every relative Markdown link in the repository's own documents resolves to an existing file,
//     and every #anchor resolves to a heading in the target file (GitHub slug rules).
//  2. Every FR-/NFR- ID defined in the SRS links to an FR card.
// Exit code 1 on any finding, so CI fails.

import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, normalize } from "node:path";

const SRS = "spec/System_Requirements_Specification_Gemeni_Notebook.md";
// Spec Kit manages these paths; they are overwritten on upgrade and not checked here.
const MANAGED = [/^\.claude\//, /^\.agents\//, /^\.github\/skills\//, /^\.specify\/(scripts|templates\/[^/]+\.md$)/];

const files = execFileSync("git", ["ls-files", "*.md"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => f && !MANAGED.some((re) => re.test(f)));

const findings = [];
const slugCache = new Map();

function stripCode(md) {
  return md.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

function githubSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function anchorsOf(file) {
  if (slugCache.has(file)) return slugCache.get(file);
  const seen = new Map();
  const anchors = new Set();
  const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
  for (const [, heading] of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = githubSlug(heading);
    const n = seen.get(base) ?? 0;
    anchors.add(n ? `${base}-${n}` : base);
    seen.set(base, n + 1);
  }
  slugCache.set(file, anchors);
  return anchors;
}

for (const file of files) {
  const text = stripCode(readFileSync(file, "utf8"));
  for (const [, rawTarget] of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (/^(https?:|mailto:)/.test(rawTarget)) continue;
    const [pathPart, anchor] = rawTarget.split("#");
    const target = pathPart ? normalize(join(dirname(file), decodeURIComponent(pathPart))) : file;
    if (!existsSync(target)) {
      findings.push(`${file}: broken link → ${rawTarget}`);
      continue;
    }
    if (anchor && target.endsWith(".md") && statSync(target).isFile()) {
      if (!anchorsOf(target).has(decodeURIComponent(anchor).toLowerCase())) {
        findings.push(`${file}: missing anchor → ${rawTarget}`);
      }
    }
  }
}

// Every requirement bullet in the SRS (`* **FR-XX-NN (...)`) must link to an FR card.
const srs = readFileSync(SRS, "utf8");
const ids = [];
for (const line of srs.split("\n")) {
  const m = line.match(/^\* \*\*((?:FR|NFR)-[A-Z]+-\d+)/);
  if (!m) continue;
  ids.push(m[1]);
  if (!/FR-Karten?:.*\]\(requirements\//.test(line)) findings.push(`${SRS}: ${m[1]} has no FR card link`);
}

if (findings.length) {
  console.error(findings.join("\n"));
  console.error(`\n✗ ${findings.length} finding(s)`);
  process.exit(1);
}
console.log(`✓ ${files.length} Markdown files: all relative links and anchors resolve`);
console.log(`✓ ${ids.length} SRS requirement IDs: every one links to an FR card`);
