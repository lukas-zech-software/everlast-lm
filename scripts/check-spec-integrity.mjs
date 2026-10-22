#!/usr/bin/env node
// Spec integrity check (no dependencies).
//  1. Every relative Markdown link in the repository's own documents resolves to an existing file,
//     and every #anchor resolves to a heading in the target file (GitHub slug rules).
//  2. Every FR-/NFR- ID defined in the SRS links to an FR card.
//  3. Spec Kit artifacts cite SRS IDs and order tests before implementation (CC-01/CC-02).
//  4. Long paragraphs are not copied between requirement, spec and architecture documents.
// Exit code 1 on any finding, so CI fails.

import { readFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, normalize } from "node:path";

const SRS = "spec/System_Requirements_Specification_Gemeni_Notebook.md";
// Spec Kit manages these paths; they are overwritten on upgrade and not checked here.
const MANAGED = [/^\.claude\//, /^\.agents\//, /^\.github\/skills\//, /^\.specify\/(extensions|scripts|templates\/[^/]+\.md$)/];

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

// Validate generated Spec Kit artifacts under specs/<feature>/ (CC-01, CC-02, CC-01..CC-08 gates).
const SRS_ID_RE = /\b(?:(?:FR|NFR)-[A-Z]+-\d+|C-0[123]|Gate\s+v[1-6]\.0)\b/;
const CC_GATES = ["CC-01", "CC-02", "CC-03", "CC-04", "CC-05", "CC-06", "CC-07", "CC-08"];
const specFiles = files.filter((f) => /^specs\/[^/]+\/(spec|plan|tasks)\.md$/.test(f));

for (const file of specFiles) {
  const raw = readFileSync(file, "utf8");
  if (!SRS_ID_RE.test(raw)) {
    findings.push(`${file}: missing SRS requirement/contract citation (CC-01)`);
  }
  if (file.endsWith("/plan.md")) {
    const missingGates = CC_GATES.filter((gate) => !raw.includes(gate));
    if (missingGates.length) {
      findings.push(`${file}: missing Constitution Check gate ID(s): ${missingGates.join(", ")}`);
    }
  }
  if (file.endsWith("/tasks.md")) {
    const taskLines = raw
      .split("\n")
      .filter((line) => /^- \[[ xX]\]\s+(?:\[[^\]]+\]\s+)*T\d{3,}\b/.test(line.trim()));
    if (!taskLines.length) {
      findings.push(`${file}: no valid task items (- [ ] T001 ...) found`);
    }
    // Within each User Story phase, failing test tasks must appear before implementation tasks (CC-02).
    const storySections = raw.split(/^##\s+Phase\s+\d+:\s+User Story\b/m).slice(1);
    for (const section of storySections) {
      const testIdx = section.search(/^###\s+Tests\b/m);
      const implIdx = section.search(/^###\s+Implementation\b/m);
      if (testIdx === -1) {
        findings.push(`${file}: User Story phase missing '### Tests' subsection (CC-02)`);
      } else if (implIdx !== -1 && testIdx > implIdx) {
        findings.push(`${file}: '### Tests' must precede '### Implementation' in User Story phase (CC-02)`);
      }
    }
  }
}

// 4. A long paragraph must have one home: the same text in two requirement/spec/architecture
//    documents drifts apart over time. Cite the home by ID or link instead of copying it.
const DUP_MIN_CHARS = 300;
const DUP_SCOPE = /^(spec\/|specs\/[^/]+\/(spec|plan|research|data-model|quickstart|contracts\/[^/]+)\.md$|docs\/solution-architecture\.md$)/;
const paragraphHomes = new Map();
for (const file of files.filter((f) => DUP_SCOPE.test(f))) {
  const paragraphs = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "").split(/\n\s*\n/);
  for (const paragraph of paragraphs) {
    const text = paragraph.replace(/\s+/g, " ").trim();
    if (text.length < DUP_MIN_CHARS || text.startsWith("|")) continue;
    const homes = paragraphHomes.get(text) ?? new Set();
    homes.add(file);
    paragraphHomes.set(text, homes);
  }
}
// Packages 001–008 predate this rule and are implemented; their copies are reported, not failed.
const LEGACY_DUP = /^specs\/00[1-8]-/;
const duplicateWarnings = [];
for (const [text, homes] of paragraphHomes) {
  if (homes.size < 2) continue;
  const message = `Paragraph copied in ${[...homes].join(", ")}: "${text.slice(0, 80)}…" (keep one home and cite it)`;
  if ([...homes].every((home) => LEGACY_DUP.test(home))) duplicateWarnings.push(message);
  else findings.push(message);
}

if (findings.length) {
  console.error(findings.join("\n"));
  console.error(`\n✗ ${findings.length} finding(s)`);
  process.exit(1);
}
console.log(`✓ ${files.length} Markdown files: all relative links and anchors resolve`);
console.log(`✓ ${ids.length} SRS requirement IDs: every one links to an FR card`);
if (specFiles.length) {
  console.log(`✓ ${specFiles.length} Spec Kit feature artifact(s): CC-01/CC-02 checks pass`);
}
console.log(`✓ No paragraph copied between requirement, spec and architecture documents`);
if (duplicateWarnings.length) {
  console.log(`! ${duplicateWarnings.length} copied paragraph(s) in packages 001–008 (warning only; run with --verbose to list)`);
  if (process.argv.includes("--verbose")) console.log(duplicateWarnings.join("\n"));
}
