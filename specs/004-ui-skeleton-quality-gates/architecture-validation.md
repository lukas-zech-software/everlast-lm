# Architecture enforcement validation

Date: 2026-11-07. Scope: Package 1.4 amendment ARCH-01..04 / CC-09, C-01..C-03,
NFR-EVAL-02/04. Worktree branch: `codex/architecture-enforcement`, based on
`13e76bd5229af7d52146456297e1aa92a220908d` (`codex/architecture-review`). Includes the prior
uncommitted guardrail proposal, copied into this isolated worktree.

## Analysis and convergence

The amendment adds gate infrastructure, not product behavior or a new release package.
The spec, plan, tasks, Package 1.4 FR card and D21 agree on static coverage, exact migration
records and reuse of the required CI context. No C-01/C-02/C-03 schema, execution placement,
transaction, quota, authorization, publication or recovery behavior changed. R1/R2 application
remediation remains separate and explicitly incomplete (T035/T036 coordinate owning packages).
T030–T034 are the completed tooling slice; this does not mark the application architecture clean.

Pre-implementation boundary fixture assertions failed against an inert checker, then passed
with implementation. Additional tests exposed canonical-name alias remapping and renamed
createRequire loaders; both failed before their fixes and now pass. Artifact negative fixtures
also reject absent gates/inventories and source-only implementation without a changed plan.

## Local verification

- `pnpm install --frozen-lockfile`: PASS, including installation after moving aside the first
  generated node_modules directory. The lockfile adds only the pinned TypeScript 6 parser alias;
  application TypeScript 7 and Node runtime versions are unchanged.
- `pnpm test:architecture`: 39 passing tests. Allowed and forbidden imports, type/re-export/
  alias/relative/dynamic/CommonJS paths, package cycles, computed loads, wildcard growth,
  counts, expiry, malformed/duplicate/stale exceptions, completed removal tasks, PR exception
  widening, changed-feature evidence, and actual CLI nonzero diagnostic behavior.
- `pnpm check:architecture`: PASS with 285 enumerated legacy exceptions, not zero legacy debt.
- `pnpm check:architecture-artifacts`: PASS for changed feature artifacts.
- `pnpm lint`: PASS (spec integrity, architecture tests/checks and TypeScript build diagnostics).
- `git diff --check`: PASS. Workflow YAML and project template resolution checked separately.

Full application runtime, database, E2E and model evaluations were not rerun: no application
sources changed. Existing CI retains those suites; this report is not a release-gate pass.
A hosted run of the modified workflow is not available until the branch is published.

## Required CI and repository settings

Read and updated the live `Protect main` ruleset `25242656`. Verified that only these two
settings changed: `require_code_owner_review = true` and
`dismiss_stale_reviews_on_push = true`. Existing required status context, branch target,
restrictions and administrator bypass were preserved. The repository already assigned its
default ownership to `@lukas-zech-software`; explicit enforcement paths were added without
removing that default. Code-owner review therefore follows the existing repository-wide ownership.

The existing required context `Links, anchors and FR card coverage` now includes the new
fixture/dependency/artifact steps in the proposed workflow. Its status context is unchanged,
so no extra unpublished context is required. New workflow enforcement takes effect after merge;
the two review-setting changes are already live. Administrator bypass remains possible.

## Debt and limitations

Inventory: 58 cross-app, 38 shared-to-app, 179 public-entrypoint, 7 wildcard-export,
2 computed-module and 1 contracts-only records. Multiple rules may describe one underlying
import; these counts are violation records, not distinct refactoring tasks. Every record is
bound to an importer/target/rule/fingerprint/count, owner, baseline, D21, removal task and
2027-02-05 expiry. It cannot expand on an ordinary PR after initial adoption. The initial
inventory and amendment remain subject to owner review. No baseline regeneration command ships.

Static import checks cannot establish semantic service ownership, transaction correctness or
safety of arbitrary runtime evaluation. Review and behavior tests remain necessary. Old untouched
feature artifacts are preserved; newly touched features must supply CC-09 evidence. Parser/config
errors, missing checks and failed checks must not be reported as architectural compliance.
