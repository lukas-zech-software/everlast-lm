#!/usr/bin/env node
/**
 * Everlast LM - GitHub Project & Issues Synchronizer
 *
 * Synchronizes the implementation state of the codebase (specs, PRs, gates, tasks)
 * with the GitHub Project (Project 2: "Everlast LM – Produkt-Roadmap") and GitHub Issues.
 *
 * Usage:
 *   node scripts/sync-github-project.mjs [--dry-run] [--verbose]
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";

const OWNER = "lukas-zech-software";
const REPO = "lukas-zech-software/everlast-lm";
const PROJECT_NUMBER = 2;
const PROJECT_ID = "PVT_kwHOAKBo0c4BnL60";
const STATUS_FIELD_ID = "PVTSSF_lAHOAKBo0c4BnL60zhlxrq0";
const RELEASE_FIELD_ID = "PVTSSF_lAHOAKBo0c4BnL60zhlxr1I";

const STATUS_OPTIONS = {
  Backlog: "f75ad846",
  "In Progress": "47fc9ee4",
  Done: "98236657",
};

const RELEASE_OPTIONS = {
  "v1.0": "9cbc86dc",
  "v2.0": "602ae77b",
  "v3.0": "b28d542a",
  "v4.0": "4a9b2671",
  "v5.0": "b0606b63",
  "v6.0": "b32a8be0",
  Releaseübergreifend: "32fea563",
};

// Package Definitions and Mapping
const PACKAGES = {
  "1.1": {
    release: "v1.0",
    epic: 2,
    issues: [21, 22, 23, 78, 79, 81],
    slug: "001-workspace-foundation",
    initialPr: 114,
    convergePr: 125,
  },
  "1.2": {
    release: "v1.0",
    epic: 3,
    issues: [24, 25, 26],
    slug: "002-text-pdf-ingestion-inspector",
    initialPr: 114,
    convergePr: 125,
  },
  "1.3": {
    release: "v1.0",
    epic: 4,
    issues: [27, 28, 29, 30],
    slug: "003-grounded-chat-citation-engine",
    initialPr: 114,
    convergePr: 125,
  },
  "1.4": {
    release: "v1.0",
    epic: 5,
    issues: [31, 32, 33, 34, 35, 36],
    gate: 84,
    slug: "004-ui-skeleton-quality-gates",
    initialPr: 114,
    convergePr: 125,
  },
  "2.1": {
    release: "v2.0",
    epic: 6,
    issues: [37, 38, 39],
    slug: "005-workspace-ui-comfort",
    initialPr: 119,
    convergePr: 128,
  },
  "2.2": {
    release: "v2.0",
    epic: 7,
    issues: [40, 41, 42, 43, 44, 82],
    slug: "006-source-guide-chat-control",
    initialPr: 120,
    convergePr: 129,
  },
  "2.3": {
    release: "v2.0",
    epic: 8,
    issues: [45, 46, 47, 48],
    slug: "007-notes-pinboard-lifecycle",
    initialPr: 121,
    convergePr: 130,
  },
  "2.4": {
    release: "v2.0",
    epic: 9,
    issues: [49, 50, 80],
    slug: "008-studio-text-reports",
    initialPr: 122,
    convergePr: null,
  },
  "3.1": {
    release: "v3.0",
    epic: 10,
    issues: [51, 52],
    slug: "009-multimodal-ingestion-sync",
    initialPr: 118,
    convergePr: null,
  },
  "3.2": {
    release: "v3.0",
    epic: 11,
    issues: [53],
    slug: "010-code-execution-sandbox",
    initialPr: null,
    convergePr: null,
  },
  "3.3": {
    release: "v3.0",
    epic: 12,
    issues: [54, 55, 56],
    slug: "011-studio-mindmaps-data-tables",
    initialPr: null,
    convergePr: null,
  },
  "3.4": {
    release: "v3.0",
    epic: 13,
    issues: [57, 83],
    slug: "012-long-context-latency-scaling",
    initialPr: null,
    convergePr: null,
  },
  "4.1": {
    release: "v4.0",
    epic: 14,
    issues: [58, 59, 60, 61],
    slug: null,
    initialPr: null,
    convergePr: null,
  },
  "4.2": {
    release: "v4.0",
    epic: 15,
    issues: [62, 63],
    slug: null,
    initialPr: null,
    convergePr: null,
  },
  "5.1": {
    release: "v5.0",
    epic: 16,
    issues: [64, 65, 66, 67],
    slug: null,
    initialPr: null,
    convergePr: null,
  },
  "5.2": {
    release: "v5.0",
    epic: 17,
    issues: [68, 69, 70],
    slug: null,
    initialPr: null,
    convergePr: null,
  },
  "6.1": {
    release: "v6.0",
    epic: 18,
    issues: [71, 72, 73, 74],
    slug: null,
    initialPr: null,
    convergePr: null,
  },
  "6.2": {
    release: "v6.0",
    epic: 19,
    issues: [75, 76],
    slug: null,
    initialPr: null,
    convergePr: null,
  },
  "6.3": {
    release: "v6.0",
    epic: 20,
    issues: [77],
    slug: null,
    initialPr: null,
    convergePr: null,
    deferred: true,
  },
};

const RELEASE_GATES = {
  "v1.0": 84,
  "v2.0": 85,
  "v3.0": 86,
  "v4.0": 87,
  "v5.0": 88,
  "v6.0": 89,
};

const args = process.argv.slice(2);
const IS_DRY_RUN = args.includes("--dry-run");
const IS_VERBOSE = args.includes("--verbose");

function log(msg) {
  console.log(msg);
}

function debug(msg) {
  if (IS_VERBOSE) console.log(`  [debug] ${msg}`);
}

function run(cmd) {
  debug(`CMD: ${cmd}`);
  try {
    return execSync(cmd, { encoding: "utf8" }).trim();
  } catch (err) {
    console.error(`Command failed: ${cmd}`);
    if (err.stdout) console.error("STDOUT:", err.stdout);
    if (err.stderr) console.error("STDERR:", err.stderr);
    throw err;
  }
}

function getMergedPrs() {
  const jsonStr = run("gh pr list --repo lukas-zech-software/everlast-lm --state merged --limit 100 --json number,title,headRefName");
  return JSON.parse(jsonStr);
}

function getOpenPrs() {
  const jsonStr = run("gh pr list --repo lukas-zech-software/everlast-lm --state open --limit 50 --json number,title,headRefName");
  return JSON.parse(jsonStr);
}

function getProjectItems() {
  const jsonStr = run(`gh project item-list ${PROJECT_NUMBER} --owner ${OWNER} --format json --limit 150`);
  return JSON.parse(jsonStr).items;
}

function determinePackageState(pkgKey, pkg, mergedPrNumbers, openPrs) {
  if (pkg.deferred) {
    return "Backlog";
  }

  // 1. Check if fully converged
  if (pkg.convergePr && mergedPrNumbers.has(pkg.convergePr)) {
    return "Done";
  }

  // 2. Initial PR merged on main -> In Progress
  if (pkg.initialPr && mergedPrNumbers.has(pkg.initialPr)) {
    return "In Progress";
  }

  // 3. Open PR matching initial or converge PR
  for (const pr of openPrs) {
    if (pr.number === pkg.initialPr || pr.number === pkg.convergePr) {
      return "In Progress";
    }
    if (pkg.slug && (pr.headRefName.includes(pkg.slug) || pr.title.toLowerCase().includes(pkg.slug.toLowerCase()))) {
      return "In Progress";
    }
    if (pr.title.toLowerCase().includes(`package ${pkgKey}`) || pr.title.toLowerCase().includes(`paket ${pkgKey}`)) {
      return "In Progress";
    }
  }

  // 4. Local spec directory exists
  if (pkg.slug && existsSync(`specs/${pkg.slug}`)) {
    return "In Progress";
  }

  return "Backlog";
}

async function main() {
  log(`=== Everlast LM Project & Issues Sync ===`);
  if (IS_DRY_RUN) log(`[DRY-RUN MODE: No changes will be written]`);

  log(`Fetching PRs and Project items...`);
  const mergedPrs = getMergedPrs();
  const openPrs = getOpenPrs();
  const projectItems = getProjectItems();

  const mergedPrNumbers = new Set(mergedPrs.map((p) => p.number));

  debug(`Merged PRs: ${Array.from(mergedPrNumbers).join(", ")}`);
  debug(`Open PRs: ${openPrs.map((p) => `#${p.number}`).join(", ")}`);

  // Map Project items by issue / PR number
  const itemMap = new Map();
  for (const item of projectItems) {
    if (item.content && item.content.number) {
      itemMap.set(item.content.number, item);
    }
  }

  // Compute desired state for each issue
  const desiredIssueState = new Map(); // issueNum -> { status: "Done" | "In Progress" | "Backlog", release: string, comment?: string }

  // 1. Process Functional Packages
  for (const [pkgKey, pkg] of Object.entries(PACKAGES)) {
    const pkgState = determinePackageState(pkgKey, pkg, mergedPrNumbers, openPrs);
    debug(`Package ${pkgKey} state: ${pkgState}`);

    // Set state for Epic
    desiredIssueState.set(pkg.epic, {
      status: pkgState,
      release: pkg.release,
      comment: pkgState === "Done" ? `Abgenommen und verifiziert in Release ${pkg.release} Paket ${pkgKey}.` : undefined,
    });

    // Set state for child issues
    for (const issueNum of pkg.issues) {
      // Special check: Contract C-03 (issue 80) is Done with PR 122
      let issueStatus = pkgState;
      if (issueNum === 80 && mergedPrNumbers.has(122)) {
        issueStatus = "Done";
      }

      desiredIssueState.set(issueNum, {
        status: issueStatus,
        release: pkg.release,
        comment: issueStatus === "Done" ? `Abgenommen und verifiziert in Release ${pkg.release} (Paket ${pkgKey}).` : undefined,
      });
    }
  }

  // 2. Process Gates
  // v1.0 Gate: Passed
  desiredIssueState.set(RELEASE_GATES["v1.0"], {
    status: "Done",
    release: "v1.0",
    comment: "Abgenommen und verifiziert in Release v1.0 (GatePassed, PR #125).",
  });

  // v2.0 Gate: In Progress
  desiredIssueState.set(RELEASE_GATES["v2.0"], {
    status: "In Progress",
    release: "v2.0",
  });

  // v3.0..v6.0 Gates: Backlog
  for (const rel of ["v3.0", "v4.0", "v5.0", "v6.0"]) {
    desiredIssueState.set(RELEASE_GATES[rel], {
      status: "Backlog",
      release: rel,
    });
  }

  // Roadmap Issue #1: Backlog, Releaseübergreifend
  desiredIssueState.set(1, {
    status: "Backlog",
    release: "Releaseübergreifend",
  });

  log(`\nEvaluating project items against desired states...`);
  let updatedCount = 0;

  for (const [issueNum, desired] of desiredIssueState.entries()) {
    const item = itemMap.get(issueNum);
    if (!item) {
      debug(`Issue #${issueNum} not in project items.`);
      continue;
    }

    // Check Status
    if (item.status !== desired.status) {
      log(`[STATUS CHANGE] Issue #${issueNum} (${item.title}): "${item.status}" -> "${desired.status}"`);
      if (!IS_DRY_RUN) {
        run(`gh project item-edit --id ${item.id} --field-id ${STATUS_FIELD_ID} --project-id ${PROJECT_ID} --single-select-option-id ${STATUS_OPTIONS[desired.status]}`);
      }
      updatedCount++;
    }

    // Check Release
    if (desired.release && item.release !== desired.release) {
      const optionId = RELEASE_OPTIONS[desired.release];
      if (optionId) {
        log(`[RELEASE CHANGE] Issue #${issueNum}: "${item.release}" -> "${desired.release}"`);
        if (!IS_DRY_RUN) {
          run(`gh project item-edit --id ${item.id} --field-id ${RELEASE_FIELD_ID} --project-id ${PROJECT_ID} --single-select-option-id ${optionId}`);
        }
        updatedCount++;
      }
    }
  }

  // Check PR items in project (ensure Release is populated)
  for (const item of projectItems) {
    if (item.content && item.content.type === "PullRequest") {
      const prNum = item.content.number;
      if (!item.release) {
        for (const pkg of Object.values(PACKAGES)) {
          if (pkg.initialPr === prNum || pkg.convergePr === prNum) {
            log(`[PR RELEASE] Setting Release "${pkg.release}" for PR #${prNum}`);
            if (!IS_DRY_RUN) {
              run(`gh project item-edit --id ${item.id} --field-id ${RELEASE_FIELD_ID} --project-id ${PROJECT_ID} --single-select-option-id ${RELEASE_OPTIONS[pkg.release]}`);
            }
            updatedCount++;
            break;
          }
        }
      }
    }
  }

  log(`Project card status checks complete (${updatedCount} field updates).`);

  // Check Issue Open / Closed consistency
  log(`\nChecking GitHub Issue open/closed states...`);
  const rawOpenIssues = run("gh issue list --repo lukas-zech-software/everlast-lm --state open --limit 150 --json number");
  const openIssueNumbers = new Set(JSON.parse(rawOpenIssues).map((i) => i.number));

  let closedCount = 0;
  for (const [issueNum, desired] of desiredIssueState.entries()) {
    if (desired.status === "Done" && openIssueNumbers.has(issueNum)) {
      log(`[CLOSE ISSUE] Closing Issue #${issueNum} (Target: Done)...`);
      if (!IS_DRY_RUN) {
        const comment = desired.comment || "Abgenommen und verifiziert.";
        try {
          run(`gh issue close ${issueNum} --repo ${REPO} --comment "${comment}"`);
        } catch (e) {
          debug(`Issue #${issueNum} could not be closed: ${e.message}`);
        }
      }
      closedCount++;
    }
  }

  log(`Issue close checks complete (${closedCount} issues closed).`);
  log(`Sync finished successfully!`);
}

main().catch((err) => {
  console.error("Sync script failed:", err);
  process.exit(1);
});
