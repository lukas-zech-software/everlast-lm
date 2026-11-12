#!/usr/bin/env node
/**
 * Generic Hobby-Tier KPI & Proportionality Sanity Checker (D24 / DEV-07).
 *
 * Scans implemented constants, eval harnesses, and (with --include-specs) FR cards / specs
 * for universal physics, cost, and wall-clock traps without hardcoding feature names:
 *   1. VSync Trap: frame / rAF budgets < 16.7 ms on 60 Hz displays
 *   2. Buffered LLM / Sandbox Latency Trap: P95 targets < 5,000 ms
 *   3. Cohort Wall-Clock Trap: external LLM/ASR/sandbox repetitions >= 15
 *   4. Mega-Context Trap: active context / fixture token targets >= 500,000
 *   5. Fragile LLM-Judge Trap: probabilistic hallucination < 0.06 or rejection >= 0.95
 *   6. Benchmark Ceremony Creep: benchmark/collector modules > 400 lines (warning)
 *
 * Usage:
 *   node scripts/check-kpi-sanity.mjs [--include-specs] [--strict]
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const includeSpecs = process.argv.includes("--include-specs");
const strict = process.argv.includes("--strict");

const CODE_ROOTS = ["apps", "packages", "scripts"];
const SPEC_ROOTS = ["spec/requirements", "specs"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "evidence", "test-results", "playwright-report"]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (/\.(?:ts|tsx|js|mjs|json)$/.test(name) || (includeSpecs && name.endsWith(".md"))) {
      out.push(full);
    }
  }
  return out;
}

function parseNum(raw) {
  return Number(raw.replaceAll("_", "").replaceAll(",", ""));
}

const findings = [];
const warnings = [];

function record(kind, file, line, rule, message) {
  const rel = relative(ROOT, file);
  const item = { kind, file: rel, line, rule, message };
  if (kind === "FAIL") findings.push(item);
  else warnings.push(item);
}

const files = [
  ...CODE_ROOTS.flatMap((r) => walk(join(ROOT, r))),
  ...(includeSpecs ? SPEC_ROOTS.flatMap((r) => walk(join(ROOT, r))) : []),
];

for (const file of files) {
  const rel = relative(ROOT, file);
  // Skip test files and this checker itself for code constant scanning
  if (rel === "scripts/check-kpi-sanity.mjs") continue;
  if (/\.(?:test|spec)\.[cm]?[jt]s$/.test(rel)) continue;
  if (/\.md$/.test(rel) && /(?:evidence|handoff|resume|candidate|gate-v[123]|refresh-report)/i.test(rel)) continue;

  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");

  // 6. Benchmark ceremony creep (> 400 lines in benchmark/eval/clock files)
  if (!rel.endsWith(".md") && /(?:benchmark|collector|eval-v\d|private-benchmark)/i.test(rel) && lines.length > 400) {
    record(
      "WARN",
      file,
      1,
      "CEREMONY_CREEP",
      `Measurement/benchmark module has ${lines.length} lines (> 400). Consider simplifying or escalating via DEV-xx/Dn instead of building heavy benchmark ceremony.`
    );
  }

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    if (/kpi-sanity-ignore/i.test(lineText)) continue;

    // 1. VSync Trap: frame budget < 16.7 ms
    const frameMatch = lineText.match(/\b([A-Z0-9_]*FRAME_BUDGET_MS)\s*=\s*([0-9_.]+)/);
    if (frameMatch && parseNum(frameMatch[2]) < 16.7) {
      record("FAIL", file, i + 1, "VSYNC_TRAP", `${frameMatch[1]}=${frameMatch[2]} ms is faster than 60 Hz VSync (16.67 ms). Use >= 33.3 ms (30 fps) or measure JS commit time.`);
    }

    // 2. Buffered LLM / Sandbox Latency Trap: P95 / target constants < 5,000 ms
    const latencyMatch = lineText.match(
      /\b([A-Z0-9_]*(?:TTFT|P95|TARGET|GATE)_[A-Z0-9_]*MS|warm_p95_ms|ttft_p95_ms)\b["']?\s*[:=]\s*([0-9_]+)/
    );
    if (latencyMatch) {
      const val = parseNum(latencyMatch[2]);
      if (val > 0 && val < 5000) {
        record("FAIL", file, i + 1, "BUFFERED_LATENCY_TRAP", `${latencyMatch[1]}=${latencyMatch[2]} ms (< 5,000 ms) is unrealistic for buffered LLM/sandbox calls under D13/D24.`);
      }
    }

    // 3. Cohort Wall-Clock Trap: repetitions >= 15 (excluding fast browser frame samples)
    const cohortMatch = lineText.match(
      /\b([A-Z0-9_]*(?:COHORT_SIZE|COHORT_REPETITIONS|MIN_REPETITIONS)|repetitions)\b["']?\s*[:=]\s*([0-9_]+)/
    );
    if (cohortMatch && !/FRAME/i.test(cohortMatch[1])) {
      const val = parseNum(cohortMatch[2]);
      if (val >= 15) {
        record("FAIL", file, i + 1, "COHORT_WALLCLOCK_TRAP", `${cohortMatch[1]}=${cohortMatch[2]} (>= 15) creates multi-minute/hour live runs. Calibrate to <= 10 (D24 recommends 5).`);
      }
    }

    // 4. Mega-Context Trap: context/needle token targets >= 500,000 (excluding per-source 500,000 word quota)
    const tokenMatch = lineText.match(
      /\b(maxContextTokens|max_tokens|active_tokens|needleTokens|CONTEXT_LIMIT_TOKENS|STUDIO_CONTEXT_LIMIT)\b["']?\s*[:=]\s*([0-9_]+)/i
    );
    if (tokenMatch && parseNum(tokenMatch[2]) >= 500_000) {
      record("FAIL", file, i + 1, "MEGA_CONTEXT_TRAP", `${tokenMatch[1]}=${tokenMatch[2]} (>= 500,000 tokens). Hobby-tier target under D24 is 100,000 active tokens.`);
    }

    // 5. Fragile LLM-Judge Trap
    const hallMatch = lineText.match(/\bhallucination_rate\b[^;\n]*(?:<|max\s*:)\s*(0\.[0-9]+)/);
    if (hallMatch && Number(hallMatch[1]) < 0.06) {
      record("FAIL", file, i + 1, "FRAGILE_JUDGE_TRAP", `hallucination_rate threshold ${hallMatch[1]} (< 0.06) is overly fragile for LLM-as-a-judge; D24 sets < 0.10.`);
    }
    const rejMatch = lineText.match(/\bnegative_rejection_rate\b[^;\n]*(?:>=|min\s*:)\s*(0\.[0-9]+)/);
    if (rejMatch && Number(rejMatch[1]) >= 0.95) {
      record("FAIL", file, i + 1, "FRAGILE_JUDGE_TRAP", `negative_rejection_rate threshold ${rejMatch[1]} (>= 0.95) is overly fragile on 25–50 case samples; D24 sets >= 0.90.`);
    }

    // Spec-mode checks (--include-specs) for v4-v6 FR cards & active specs
    if (includeSpecs && rel.endsWith(".md")) {
      if (/(?:<=|≤)\s*16\s*ms\b/i.test(lineText) && !/historical|formerly|calibrated|previously|vsync/i.test(lineText)) {
        record("WARN", file, i + 1, "SPEC_VSYNC_TRAP", `Spec cites <= 16 ms frame budget (60 Hz VSync is 16.67 ms). Verify against D24/DEV-07.`);
      }
      if (/(?:<=|≤|<)\s*2[.,]5\s*s\b/i.test(lineText) && /(?:TTFT|latency|P95|voice-to-voice)/i.test(lineText) && !/historical|formerly|calibrated|previously|DEV-07|D24/i.test(lineText)) {
        record("WARN", file, i + 1, "SPEC_LATENCY_TRAP", `Spec cites <= 2.5 s P95 latency target. Verify feasibility under D13/D24 before implementing.`);
      }
    }
  }
}

for (const item of [...findings, ...warnings]) {
  const tag = item.kind === "FAIL" ? "✗ FAIL" : "⚠ WARN";
  console.log(`${tag} [${item.rule}] ${item.file}:${item.line} — ${item.message}`);
}

console.log(
  `\nKPI Sanity Check (${files.length} files scanned): ${findings.length} failure(s), ${warnings.length} warning(s).`
);

if (findings.length > 0 || (strict && warnings.length > 0)) {
  process.exit(1);
}
