# Rule: `no-production-testkit`

| Property | Value |
| --- | --- |
| **Rule ID** | `no-production-testkit` |
| **Category** | Package role |
| **Authority** | Constitution IV / `CC-09`, [Agent Architecture Guardrails](../agent-architecture-guardrails.md), `D21` |
| **Inspected Surfaces** | `package.json` production deps and non-test TS/JS files outside `@everlast/testkit` and `@everlast/evals` |
| **Implementation** | [`no-production-testkit.mjs`](../../scripts/architecture/rules/no-production-testkit.mjs) |
| **Index** | [Architecture Rules Index](README.md) |

## Purpose & Rationale

Prevents production application and shared library code from importing `@everlast/testkit` or `@everlast/evals`. Test doubles, fixture generators, and evaluation harnesses must never ship inside production builds.

## Detection Logic

Evaluated on production cross-package edges (`checkDependencyEdge`):

- Triggers when `!edge.isTest`, `fromPkg` is neither `@everlast/testkit` nor `@everlast/evals`, and `toPkg` is `@everlast/testkit` or `@everlast/evals`.
- Test files (`isTest(from)`) and `devDependencies` in `package.json` are permitted to import both test packages; `@everlast/evals` and `@everlast/testkit` may also reference each other.

## Fingerprinting & Exception Semantics

- Source imports fingerprint `moduleTokens(node, sf)`; manifest entries fingerprint `[section, name, version]`.
- Zero active legacy exceptions.

## Examples

**Invalid (`apps/api/src/handler.ts`):**

```ts
import { createFixtureNotebook } from "@everlast/testkit";
```

**Valid (`apps/api/test/handler.test.ts`):**

```ts
import { createFixtureNotebook } from "@everlast/testkit";
```

## ESLint Feasibility & Existing Plugin Comparison

- **Existing plugins**: ESLint core `no-restricted-imports` (disallowing `@everlast/testkit` and `@everlast/evals` outside test files and `packages/{testkit,evals}/**`), `eslint-plugin-import-x` (`import-x/no-restricted-paths`), or `eslint-plugin-boundaries` (`boundaries/element-types`) cover static ES imports.
- **Gaps**: Standard ESLint rules do not inspect `package.json` `dependencies` or `createRequire` aliases.
- **Recommendation**: **Immediate candidate for core `no-restricted-imports`** in `eslint.config.mjs` (0 exceptions, zero new dependencies), backed by `no-production-testkit.mjs` in `check-architecture.mjs` for manifest and loader completeness.
