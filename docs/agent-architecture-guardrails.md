# Agent architecture guardrails

Status: proposed governance companion to Constitution 2.1.0; owner approval is required
before adopting the amendment. Automated dependency and artifact checks are implemented in this branch; no application refactoring is included.
Authority: Constitution IV and CC-09. Traceability: C-01..C-03, FR-WM-01..04,
FR-WM-07, NFR-SEC-02, NFR-EVAL-02/04; D2, D4, D13 and D16.

## Findings and enforcement gaps

The [review baseline](architecture-refactoring-baseline.md) records R1 (shared workflows
inside deployment apps), R2 (transport-owned orchestration), and R3 (missing dependency
checks). This proposal was prepared against architecture-review commit `13e76bd`.
API worker imports and the lint entry point were re-inspected in that branch.

Existing CC-05 checks schemas and pipeline style, but does not require module boundaries.
Spec integrity checks links, traceability, test ordering and the presence of CC-01..CC-08;
it does not itself validate dependency graphs or the truth of gate evidence. Lint now also runs
architecture fixtures, dependency enforcement and changed-feature CC-09 validation. A successful
check establishes its documented static coverage, not semantic workflow ownership or runtime safety.

## Allowed dependency directions

These are logical responsibilities inside feature modules, not a mandate for global layer
folders, a new framework, new deployment services, or one package per layer. Plans must map
these roles to actual paths and public exports before implementation.

| Consumer | Allowed dependencies | Forbidden dependencies |
| --- | --- | --- |
| Shared contracts | Schema libraries and contract-local types | Deployment apps, persistence/model adapters, application workflows |
| Application workflows | Canonical contracts, explicit ports, approved public workflow interfaces | Other deployment apps, transport entry points, concrete SQL/cloud client construction |
| Persistence/model/job adapters | Contracts, implemented ports, relevant SDKs | Transport entry points, other deployment apps |
| Transport handlers | Contracts and application services; authorized simple CRUD repositories with rationale | Multi-step workflow ownership, worker implementation imports |
| Composition roots | Public workflow and adapter interfaces, configuration/lifecycle wiring | Other deployment applications as libraries |
| Browser code | Browser-safe public contracts and client interfaces | Server workflows, database or server credential adapters |

Shared packages cannot import applications. Cross-package access uses declared public exports;
relative imports within a module remain valid. A barrel export or type-only import cannot
launder a forbidden dependency. Check re-exports, aliases, relative paths, dynamic imports,
package manifests and TypeScript path mappings as well as ordinary imports. New cycles are
forbidden. Composition roots are named paths in the plan, not exemptions for all of `apps/`.
Test fixtures may intentionally contain invalid edges only as isolated checker inputs;
production imports and test helpers must not bypass the same public boundaries.

## Evidence at each Spec Kit stage

| Stage | Required evidence / stop condition |
| --- | --- |
| Specify / clarify | Identify affected C-01..C-03 and business invariants, R1/R2/R3 relevance, and unresolved ownership questions. Keep implementation design in the plan. Resolve material ambiguity before planning. |
| Plan (before research and after design) | Evaluate CC-09, populate the boundary inventory below, identify regression coverage and check availability. An initial assessment may record open design questions, but post-design approval requires their resolution. |
| Tasks | Sequence behavior characterization before extraction; add boundary-check fixtures before checker implementation where checker work is in scope; identify public interface/export changes and final verification. Qualify tasks with feature path and SRS IDs. |
| Analyze | Treat missing boundary evidence, unauthorized exceptions, forbidden new edges, or uncovered workflow changes as CRITICAL. Report findings without modifying artifacts; resolve them and rerun analysis before implementation. |
| Implement | Recheck the actual diff against the inventory. Exercise affected behavior, including failure/concurrency paths. Flow design changes back to plan/spec and governing sources and rerun analysis. Do not silently expand dependencies or exceptions. |
| Converge | Inspect the final graph, exports, workflow ownership and test evidence. Append remaining in-scope work through the normal convergence contract. Completed checkboxes or a zero exit code are insufficient. |
| PR review | Include CC-09 evidence for the final commit, exceptions and unavailable checks. Block new violations, expired exceptions and missing required evidence. Distinguish a manual review result from checker coverage. |

Old generated plans are not silently certified by the new constitution. When a feature resumes,
refresh its plan/tasks with CC-09 and rerun analysis before further implementation. Historical
completed artifacts need not be rewritten. Governance-only changes may mark runtime boundary
review `N/A` with a docs-only diff as evidence; they do not certify the existing application.

### Boundary inventory in the feature plan

For every touched responsibility, record:

| SRS / contract | Actual module path and owner | Responsibility | Public exports / ports | Allowed consumers / dependencies | Composition root | Regression evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Fill from assigned package | Exact paths and accountable owner | Transport / workflow / adapter / contract | Explicit names | Exact package or module edges | Named wiring file | Test path and behavior |

Record who owns authorization coordination, transactions, quota reservation, dispatch,
cancellation and publication for each changed use case. Tests must preserve ordering,
idempotency, rollback, scoped revisions and recovery where affected. Application-service
workflow tests must run without HTTP request/response objects. Existing passing behavior tests
can characterize an extraction; newly specified behavior and checker fixtures follow CC-02
Red → Green. Do not force artificial failures in existing regression tests.

### Gate evidence and legacy debt

Record the reviewed commit/diff, reviewer, date, paths examined, commands and results.
Use `PASS`, `FAIL`, `UNAVAILABLE`, or `N/A` with a reason for each check. A manual PASS must
be labelled manual and include the examined edges and workflow ownership. An unavailable
checker remains UNAVAILABLE even when manual review passes. Now that the checker exists, manual review cannot substitute for a failed or unavailable
automated check. Both static enforcement and workflow ownership evidence are required.

For each unchanged legacy violation encountered, record the exact importer, imported target,
violated rule, baseline commit, rationale, accountable owner, qualified removal task, expiry
date and prior `Dn` decision. An exception is valid only after the repository's decision/owner
approval process; an agent-authored entry alone is not authorization. Until accepted, report
FAIL and block affected implementation/completion. New consumers, expanded exports or new
uses of that violation are not grandfathered. Do not turn the whole current graph into an
allowlist or force unrelated repository-wide refactors into a single package.

## Automated enforcement and remaining migration

Map each slice to its governing package and Spec Kit feature before implementation. Preserve
single-package branches and release prerequisites. The baseline's R1/R3/R2 sequencing remains
applicable; choosing a shared package name and extraction paths belongs to that plan.

The implemented checks enforce:

1. Resolve workspace aliases, relative imports, type imports, re-exports and statically
   resolvable dynamic imports to actual modules; diagnose unresolved boundary-bearing imports
   rather than silently treating them as safe. Cover dependency cycles and public export leaks.
2. Report the importer, resolved target and violated rule and exit nonzero on new violations.
   Recognize only individually approved, unexpired legacy exceptions and fail stale entries.
3. Prove rejection with fixtures for API-to-worker, shared-to-app, deep-import, type-only,
   re-export and alias/relative bypasses and cycles; prove acceptance for public interfaces,
   legitimate composition-root wiring and module-local imports.
4. Join the existing lint/CI path without replacing spec/type/eval checks. Extend artifact
   validation for CC-09 on new/resumed work without misrepresenting historical artifacts.
5. Run fixtures and enforcement in the already-required `Links, anchors and FR card coverage`
   GitHub status context (active main ruleset `25242656`). This workflow takes effect on merge.
   Repository administrators retain the pre-existing bypass; this is not bypass-proof enforcement.

Routing R2 cannot be fully proven by an import graph. Keep human/agent review of use-case
ownership plus behavior tests even after the checker lands.

## Agent entry points and upgrade durability

`AGENTS.md` is the common entry point; `CLAUDE.md` already includes it. Copilot instructions
also direct agents there. Any other integration or delegated agent must receive and acknowledge
AGENTS.md, the constitution and this procedure in its task bootstrap; the parent must pass the
feature path, package, allowed files and known exceptions. If its runner does not load these
files, configure that runner before authorizing repository changes. No claim is made that an
arbitrary external agent will automatically discover them.

Project-owned template overrides and the pipeline verification overlay carry the gate through
Spec Kit. Do not patch generated skills or managed templates. After a Spec Kit upgrade, resolve
all three templates and inspect the effective workflow to confirm CC-09 survives; a missing
rule is a configuration defect to resolve before feature implementation.

## Running and maintaining the checks

- `pnpm test:architecture`: isolated positive/negative fixture tests using Node's test runner.
- `pnpm check:architecture`: full apps/packages scan against exact migration records.
- `pnpm check:architecture-artifacts`: validate locally changed/new feature evidence.
- `node scripts/check-architecture.mjs --base-ref BASE_SHA`: additionally prohibit new or
  widened exceptions relative to the trusted PR base. Initial adoption has no base inventory
  and explicitly reports bootstrap; its inventory requires owner review.
- `node scripts/check-architecture-artifacts.mjs --base-ref BASE_SHA`: include all changes
  against the PR base, plus local tracked/untracked changes.
- `pnpm lint`: existing spec/type checks plus all architecture checks and fixtures.

The parser is pinned as dev-only `typescript-compiler` (TypeScript 6.0.2); TypeScript 7 remains
unchanged as the application compiler. Unsupported syntax/configuration fails closed. Keep parser
upgrades explicit and rerun fixtures. Source symlinks and imported files excluded as build output
are rejected, not silently trusted. External test runners are allowed in tests; production must
not consume testkit/eval tooling. Browser test hosts may use server adapters, while browser
production may consume only browser-safe contracts. Cross-app/private-interface rules still apply
to tests. Import graphs do not prove safety of arbitrary runtime evaluation or semantic use cases.

`scripts/architecture-policy.json` contains individually enumerated pre-existing violations from
`13e76bd5229af7d52146456297e1aa92a220908d`. No automatic baseline-update command is provided.
Records expire on 2027-02-05 (exclusive), or when the referenced removal task completes. Remove
records when the exact violation disappears. Wildcard exceptions fingerprint the exposed file set;
computed-load exceptions fingerprint the whole source file so changes to their inputs cannot
silently reuse an old exception. Ordinary import fingerprints retain names and occurrence counts.
No new source/import/export is grandfathered by an existing wildcard or importer record.

Keep the required check context stable. CODEOWNERS assigns the checker, workflows, manifest,
lockfile, templates and governing rules to the project owner. Repository rules must require code
owner review to prevent a normal PR from weakening those controls without review. An authorized
administrator can still bypass the ruleset. Tests and policy are not a sandbox for hostile code.
