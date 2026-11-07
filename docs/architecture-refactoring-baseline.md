# Architecture refactoring baseline

Review verified: 2026-11-07. Code baseline: `87f87620d44e29ea4f9c62fdc7dfd9978d37c8ee`.

This records the direct static review of Everlast LM and identifies candidate refactorings. It is not a runtime, security, or performance certification. Superpowers was suggested during the original review, but its installation and use were not confirmed; these findings are not plugin-generated. No implementation changes are included.

This document is advisory. The constitution, SRS, FR cards and architecture decisions remain authoritative. References below are relative to this file and describe the reviewed commit, not later branches.

## Summary and verdict

The architecture is pragmatic and has useful shared contracts, but responsibility boundaries are uneven. Feature-oriented modules coexist with shared persistence and cloud packages, an API application, and a worker application. Explicit source snapshots, centralized access checks, and typed Studio generators are strengths worth preserving.

Retain the feature-oriented organization and introduce consistent internal application boundaries. A wholesale move into global controller/service/repository folders is not justified by this review.

| Aspect | Current Everlast LM | Traditional layered organization |
| --- | --- | --- |
| Structure | Feature modules plus shared packages and deployment applications | Presentation, application, domain and persistence layers |
| Dependencies | Shared contracts exist, but API code imports worker implementations and some routes call repositories directly | Dependencies follow explicit layer boundaries; strict variants route business workflows through application services |
| Strength | Feature cohesion, reusable generators, lean deployment model | Predictable dependency direction and isolation of business policies |
| Tradeoff | Cross-application coupling and inconsistent orchestration ownership | Extra indirection; trivial CRUD can acquire unnecessary forwarding layers |

Layer separation does not require separate services or databases. It can be applied within each feature while retaining the existing deployment model.

## R1 — Separate shared workflows from deployment applications

**Priority:** High. **Traceability:** C-01, C-02, C-03; Constitution IV; D2, D4, D16.

**Observed:** The API imports model adapters, Ready-source hooks, runtime factories, and Studio orchestration from `@everlast/worker/*`. The worker package exposes a wildcard subpath export. This makes a deployment application also act as a shared library, enlarging the API's dependency surface and making independent changes harder to reason about.

**Affected files:**

- [API composition root](../apps/api/src/server.ts)
- [API v2 runtime](../apps/api/src/v2/runtime.ts)
- [Worker package exports](../apps/worker/package.json)
- [API package dependencies](../apps/api/package.json)
- [Shared runtime currently in worker](../apps/worker/src/package-v2-2-runtime.ts)
- [Ready-source hooks](../apps/worker/src/ready-hooks.ts)
- [Studio registry](../apps/worker/src/studio/registry.ts), [runner](../apps/worker/src/studio/runner.ts), and [dispatcher](../apps/worker/src/studio/dispatcher.ts)
- Model interfaces and adapters under `apps/worker/src/studio/{reports,mindmaps,tables}/`, plus `apps/worker/src/package-v2-2-gemini.ts` and `apps/worker/src/ingestion/topic-emoji.ts`

**Proposed direction:** Extract genuinely shared workflows and their public interfaces into a focused workspace package, selecting its name and ownership during planning. Keep API and worker entry points responsible for configuration and lifecycle wiring. Use explicit exports instead of exposing all internal files. Preserve the existing single definitions of C-01..C-03 in `packages/contracts`.

**Acceptance criteria:**

- API production code no longer imports implementation modules from the worker application.
- Shared code does not import either deployment application's entry points.
- Existing generator, scope-validation, cancellation and publication behavior remains unchanged.
- Extraction alone does not change background-job placement or remove D16's one-API-instance constraint. Such changes need a separately recorded architecture decision and recovery/concurrency evidence.

**Relevant regression coverage:** `apps/api/test/package-v2-2-runtime.test.ts`, `apps/api/test/studio-runtime.integration.test.ts`, `apps/worker/test/studio-runner.test.ts`, `apps/worker/test/studio-dispatcher.test.ts`, and `apps/worker/test/studio-plugin-flow.test.ts`.

## R2 — Give application services consistent ownership of workflows

**Priority:** Medium. **Traceability:** FR-WM-01..04, FR-WM-07; C-02; D16.

**Observed:** Notebook routes combine HTTP validation/serialization, repository calls, workspace decoration, Ready-count coordination, deletion cancellation, and job notification. Other features already have service abstractions. Direct repository access for simple CRUD is not itself a defect; the concern is multi-step behavior being owned by transport handlers.

**Affected files:**

- [Notebook routes](../apps/api/src/routes/notebooks.ts)
- [Application dependency wiring](../apps/api/src/app.ts)
- [API v2 runtime](../apps/api/src/v2/runtime.ts)
- [Workspace preferences service](../apps/api/src/services/workspace-preferences.ts)
- [Notebook persistence](../packages/db/src/notebooks.ts)

Existing examples to reuse: [NotesService](../apps/api/src/notes/service.ts) and [StudioService](../apps/api/src/studio/service.ts). These are reference patterns, not an instruction to refactor both services.

**Proposed direction:** Move notebook use-case coordination into an application service with explicit dependencies. Keep parsing, HTTP status mapping and response serialization in routes. Keep SQL and transaction mechanics in persistence adapters. Avoid adding a forwarding method for every repository call without a clear responsibility benefit.

**Acceptance criteria:**

- Notebook deletion and overview coordination can be tested without HTTP request/response objects.
- Route handlers delegate multi-step workflows rather than coordinating persistence, background work and cancellation themselves.
- Ownership checks, quota semantics, ordering, idempotency and deletion behavior remain unchanged.
- Transaction boundaries are preserved; extraction must not turn an atomic operation into separate commits.

**Relevant regression coverage:** `apps/api/test/workspace.test.ts`, `apps/api/test/workspace-preferences.test.ts`, `packages/db/test/workspace.integration.test.ts`, and `packages/db/test/workspace-cascade.integration.test.ts`.

## R3 — Enforce dependency boundaries automatically

**Priority:** High, introduced incrementally alongside R1/R2. **Traceability:** Constitution IV, CC-05, CC-08; C-01..C-03.

**Observed:** `scripts/lint.mjs` runs specification integrity and TypeScript diagnostics. That script does not check architectural dependency direction. Type correctness alone does not prevent an API-to-worker import or a shared module depending on an application.

**Affected files:**

- [Lint entry point](../scripts/lint.mjs)
- [Root scripts](../package.json)
- [TypeScript path configuration](../tsconfig.base.json)
- [Worker exports](../apps/worker/package.json) and manifests of any extracted packages

**Proposed direction:** Record a small allowed-dependency matrix and enforce it in the existing lint/CI path. Cover package aliases and relative imports, including type imports where they expose an undesired application dependency. Stage existing violations explicitly while R1 is implemented; do not silently allow all current imports forever.

**Acceptance criteria:**

- A deliberately forbidden dependency fails the check with the source file and violated rule.
- Legitimate composition-root imports of adapters remain allowed.
- Shared contracts cannot depend on deployment applications.
- API-to-worker implementation imports are rejected once R1 is complete.
- Existing specification and type checks continue to run.

## Preserve these strengths

- [Scope guards](../packages/db/src/scope-guard.ts): explicit Ready-source selection, captured revisions, ownership verification and publication fencing (C-02, NFR-EVAL-04).
- [Shared contracts](../packages/contracts/src/index.ts): one canonical definition of cross-feature contracts (C-01..C-03).
- [Studio registry](../apps/worker/src/studio/registry.ts) and [runner](../apps/worker/src/studio/runner.ts): replaceable generators and validation before publication (C-03, D13).
- Durable persistence and dispatch mechanisms already present in the runtime. The system must not be described as entirely in-memory or as lacking durable jobs.

## Suggested sequence and verification

1. Agree and document the allowed dependency directions and the shared workflow package's scope. Establish existing behavior with focused regression coverage.
2. Extract shared API/worker workflows (R1), preserving deployment and recovery behavior.
3. Enforce the resulting import boundaries (R3).
4. Extract substantive notebook orchestration into an application service (R2).

Before implementation, map each slice to the governing feature/package and follow the repository's Spec Kit and flow-back rules. This baseline is not a substitute for a feature spec or approval of a new deployment architecture.

For each slice, run `node scripts/check-spec-integrity.mjs`, lint/type checks, affected unit/contract/integration tests, and applicable NFR-EVAL gates. Add behavior-focused coverage before altering uncovered workflows; boundary-check tests should exercise both forbidden and allowed imports.

**Review verification:** inspected source imports, package exports, route orchestration, runtime composition, and the lint entry point at the recorded commit. Runtime suites and performance/evaluation gates were not run for this static review. The documentation change is checked separately for local links and specification integrity.
