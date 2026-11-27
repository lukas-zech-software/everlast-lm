# Rule: `no-production-harness-import`

| Property | Value |
| --- | --- |
| **Rule ID** | `no-production-harness-import` |
| **Category** | Package role |
| **Authority** | Constitution IV / `CC-09` (2.4.0), `D25`, [Agent Architecture Guardrails](../agent-architecture-guardrails.md) |
| **Inspected Surfaces** | Non-harness TS/JS files in `apps/*` and `packages/*`, including imports within their own package |
| **Implementation** | [`no-production-harness-import.mjs`](../../scripts/architecture/rules/no-production-harness-import.mjs) |
| **Index** | [Architecture Rules Index](README.md) |

## Purpose & Rationale

`D25` exempts harness edges from `no-cross-app` and `no-shared-to-app`. Without this rule, production code could reach another application through a harness file, for example `apps/api/src/server.ts` → `../test/bridge.ts` → `@everlast/worker`. That would give a production cross-app dependency with zero findings. Harness code is never loaded by a deployed service, and this rule enforces that.

## Detection Logic

Evaluated on every resolved module reference (`checkModuleReference`):

- The importer is not a harness file (`isHarnessPath(from)` in [`roles.mjs`](../../scripts/architecture/roles.mjs)), and its package is not a declared harness package (`@everlast/evals`).
- The resolved target is a workspace file whose path is a harness path. Harness paths are package-level `test/` or `tests/` directories, `__tests__/` directories, and `*.test.*`/`*.spec.*` files.
- Relative imports within the same package are checked too.
- A `test/` directory nested under `src/` is production code, not a harness path.

## Fingerprinting & Exception Semantics

Fingerprints are computed from `moduleTokens(node, sf)`, as in the other rules. There are no legacy exceptions; every finding blocks.

## Examples

- Rejected: `apps/api/src/y.ts` importing `../test/bridge.ts`.
- Allowed: `apps/api/test/a.test.ts` importing `./support.ts`.
- Allowed: `packages/evals/src/x.ts` importing another package's test fixture through declared exports.
