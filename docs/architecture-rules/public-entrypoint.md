# Rule: `public-entrypoint`

| Property | Value |
| --- | --- |
| **Rule ID** | `public-entrypoint` |
| **Category** | Boundary |
| **Authority** | Constitution IV / `CC-09`, [Agent Architecture Guardrails](../agent-architecture-guardrails.md), `D21` |
| **Inspected Surfaces** | All TS/JS imports, exports, `import type`, `TSImportType`, dynamic `import()`, `require()`, and `createRequire` loaders |
| **Implementation** | [`public-entrypoint.mjs`](../../scripts/architecture/rules/public-entrypoint.mjs) |
| **Index** | [Architecture Rules Index](README.md) |

## Purpose & Rationale

Requires every cross-package import to enter the target package through a declared, non-wildcard `package.json` `exports` key. Blocks deep subpath imports, relative-path boundary bypasses (`../../../packages/db/src/private.ts`), wildcard export fallbacks, and `tsconfig.json` `paths` alias spoofing.

## Detection Logic

Evaluated on resolved module references (`checkModuleReference`):

1. `resolveTargetPackageEntry()` checks whether the specifier matches a workspace package name and maps to an exact, non-wildcard `exports` key (`publicEntry === true`).
2. `resolveReferenceTarget()` resolves `tsconfig.json` `paths` with precedence over `package.json` names so a spoofed path alias (`@everlast/contracts -> apps/worker/src/index.ts`) resolves to its real owner (`targetOwner !== targetPkg`).
3. Emits `public-entrypoint` if:
   - `targetOwner && targetOwner !== pkg` and (`!publicEntry || targetPkg !== targetOwner`), or
   - `targetPkg && targetPkg !== pkg` and `!publicEntry`.

## Fingerprinting & Exception Semantics

- Fingerprints `moduleTokens(node, sf)`.
- Zero active legacy exceptions.

## Examples

**Invalid (`apps/api/src/handler.ts`):**

```ts
import { secret } from "@everlast/db/src/private";
import { secret2 } from "../../../packages/db/src/private.ts";
```

**Valid (`apps/api/src/handler.ts`):**

```ts
import { dbClient } from "@everlast/db";
import { localHelper } from "./private.js";
```

## ESLint Feasibility & Existing Plugin Comparison

- **Existing plugins**: `eslint-plugin-boundaries` (`boundaries/entry-point`) and `eslint-plugin-import-x` (`import-x/no-internal-modules`, `import-x/no-relative-packages`) approximate entrypoint enforcement using manual glob patterns.
- **Gaps**: Existing plugins do not dynamically validate against each target package's non-wildcard `package.json` `exports` map, nor do they detect `tsconfig.json` `paths` spoofing (`targetPkg !== targetOwner`) or `createRequire` aliases.
- **Custom ESLint rule**: **Medium feasibility**—implementable as a custom ESLint rule backed by [`resolve.mjs`](../../scripts/architecture/resolve.mjs) with per-process `tsconfig` caching, though `check-architecture.mjs` already provides full AST and manifest resolution without IDE resolver overhead.
