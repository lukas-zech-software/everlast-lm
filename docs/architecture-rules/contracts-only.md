# Rule: `contracts-only`

| Property | Value |
| --- | --- |
| **Rule ID** | `contracts-only` |
| **Category** | Package role |
| **Authority** | Constitution IV (`C-01..C-03`, `CC-05`, `CC-09`), `D2`, `D21` |
| **Inspected Surfaces** | `packages/contracts/package.json` and non-test TS/JS files in `@everlast/contracts` |
| **Implementation** | [`contracts-only.mjs`](../../scripts/architecture/rules/contracts-only.mjs) |
| **Index** | [Architecture Rules Index](README.md) |

## Purpose & Rationale

Restricts `@everlast/contracts` production code and manifest dependencies strictly to `zod` (its schema library) and contract-local relative modules. Prevents runtime adapters, database clients, SDKs, or other workspace packages from leaking into canonical `C-01..C-03` schema definitions.

## Detection Logic

1. **Manifest & cross-package edges (`checkDependencyEdge`)**: Any dependency or import from `@everlast/contracts` to *any* other workspace package (including `devDependencies` in `package.json`) triggers `contracts-only`.
2. **External source imports (`checkModuleReference`)**: In non-test files inside `@everlast/contracts`, any non-relative import (`!specifier.startsWith(".")`) that has no workspace `targetOwner` and is neither `"zod"` nor `"zod/*"` triggers `contracts-only`.
3. Test files (`isTest(from)`) in `packages/contracts` are permitted to import external test runners such as `vitest`.

## Fingerprinting & Exception Semantics

- Source imports fingerprint `moduleTokens(node, sf)`; manifest entries fingerprint `[section, name, version]`.
- Zero active legacy exceptions.

## Examples

**Invalid (`packages/contracts/src/chunk.ts`):**

```ts
import "@everlast/db";
import { Pool } from "pg";
```

**Valid (`packages/contracts/src/chunk.ts` & `packages/contracts/test/chunk.test.ts`):**

```ts
// packages/contracts/src/chunk.ts
import { z } from "zod";
import { ScopeSchema } from "./scope.js";

// packages/contracts/test/chunk.test.ts
import { test } from "vitest";
```

## ESLint Feasibility & Existing Plugin Comparison

- **Existing plugins**: `eslint-plugin-boundaries` (`boundaries/element-types` disallowing all workspace deps for `contracts` + `boundaries/external` allowing only `zod`) or ESLint core `no-restricted-imports` (scoped to `packages/contracts/src/**/*.ts` with `patterns` excluding `zod` and relative paths) can enforce the source-file half.
- **Gaps**: ESLint source rules miss `packages/contracts/package.json` dependencies, `createRequire` aliases, and `TSImportType`.
- **Custom ESLint rule**: **Medium feasibility** (can be enabled for immediate IDE feedback since there are 0 exceptions), while `check-architecture.mjs` remains necessary for manifest checks.
