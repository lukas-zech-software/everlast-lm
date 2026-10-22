#!/usr/bin/env node
// Spec integrity check (no dependencies).
//  1. Every relative Markdown link in the repository's own documents resolves to an existing file,
//     and every #anchor resolves to a heading in the target file (GitHub slug rules).
//  2. Every package FR card is linked from the release index (SRS).
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

// Every package FR card under spec/requirements/v<N>/ must be linked from the release index.
const srs = readFileSync(SRS, "utf8");
const cards = files.filter((f) => /^spec\/requirements\/v\d+\/package_[^/]+\.md$/.test(f));
const ids = [...new Set(srs.match(/\b(?:FR|NFR)-[A-Z]+-\d+\b/g) ?? [])];
for (const card of cards) {
  if (!srs.includes(`](${card.replace(/^spec\//, "")})`)) findings.push(`${SRS}: FR card ${card} is not linked from the index`);
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

if (findings.length) {
  console.error(findings.join("\n"));
  console.error(`\n✗ ${findings.length} finding(s)`);
  process.exit(1);
}
console.log(`✓ ${files.length} Markdown files: all relative links and anchors resolve`);
console.log(`✓ ${cards.length} FR cards (${ids.length} requirement IDs): every card is linked from the release index`);
if (specFiles.length) {
  console.log(`✓ ${specFiles.length} Spec Kit feature artifact(s): CC-01/CC-02 checks pass`);
}
