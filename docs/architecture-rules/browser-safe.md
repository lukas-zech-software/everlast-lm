# Rule: `browser-safe`

| Property | Value |
| --- | --- |
| **Rule ID** | `browser-safe` |
| **Category** | Package role |
| **Authority** | Constitution IV / `CC-09`, [Agent Architecture Guardrails](../agent-architecture-guardrails.md), `D21` |
| **Inspected Surfaces** | `apps/web/package.json` (`dependencies`, `peerDependencies`, `optionalDependencies`) and non-test TS/JS files in `@everlast/web` |
| **Implementation** | [`browser-safe.mjs`](../../scripts/architecture/rules/browser-safe.mjs) |
| **Index** | [Architecture Rules Index](README.md) |

## Purpose & Rationale

Ensures `@everlast/web` production code only depends on browser-safe third-party libraries and `@everlast/contracts`. Prevents server-side workflows, PostgreSQL database drivers, Node.js built-ins, and Google Cloud / Vertex server SDKs from being bundled into browser code.

## Detection Logic

1. **Cross-package production dependencies (`checkDependencyEdge`)**: When `!edge.isTest`, any dependency or source import from `@everlast/web` to a workspace package other than `@everlast/contracts` triggers `browser-safe`. (`devDependencies` and test files are exempt so Playwright hosts can use server adapters/testkit).
2. **Server-only external specifiers (`checkModuleReference`)**: In non-test files inside `@everlast/web`, any import matching `/^(node:|pg$|@google\/|@google-cloud\/)/` triggers `browser-safe`.

## Fingerprinting & Exception Semantics

- Source imports fingerprint `moduleTokens(node, sf)`; manifest entries fingerprint `[section, name, version]`.
- Zero active legacy exceptions.

## Examples

**Invalid (`apps/web/src/view.ts`):**

```ts
import { query } from "@everlast/db";
import { readFile } from "node:fs";
import pg from "pg";
```

**Valid (`apps/web/src/view.ts`):**

```ts
import { NotebookSchema } from "@everlast/contracts";
```

## ESLint Feasibility & Existing Plugin Comparison

- **Existing plugins**:
  - ESLint core `no-restricted-imports` (scoped to `apps/web/src/**/*.ts`, excluding tests) can immediately block `node:*`, `pg`, `@google/*`, `@google-cloud/*`, and non-contracts `@everlast/*` packages with zero new plugins.
  - `eslint-plugin-import-x` (`import-x/no-nodejs-modules`) and `eslint-plugin-boundaries` (`boundaries/element-types` + `boundaries/external`) also cover source-level server imports.
- **Gaps**: Core `no-restricted-imports` misses `require()`, `import()`, `createRequire`, relative escapes, and `apps/web/package.json` `dependencies`.
- **Recommendation**: **Immediate candidate for dual enforcement**—add core `no-restricted-imports` to `eslint.config.mjs` for instant editor diagnostics while retaining `browser-safe.mjs` for full resolution and manifest coverage.
