# Rule: `outside-workspace`

| Property | Value |
| --- | --- |
| **Rule ID** | `outside-workspace` |
| **Category** | Boundary |
| **Authority** | Constitution IV / `CC-09`, `D21` |
| **Inspected Surfaces** | All TS/JS imports, exports, `import type`, `TSImportType`, dynamic `import()`, `require()`, and `createRequire` loaders |
| **Implementation** | [`outside-workspace.mjs`](../../scripts/architecture/rules/outside-workspace.mjs) |
| **Index** | [Architecture Rules Index](README.md) |

## Purpose & Rationale

Prevents source files in `apps/*` and `packages/*` from importing files outside any declared workspace package (such as repo-root `scripts/`, `specs/`, or files outside the repository via relative traversal or `tsconfig.json` `paths` aliases).

## Detection Logic

Evaluated on resolved module references (`checkModuleReference`):

- Computes `isWorkspaceEscape`: true when `specifier` starts with `.` or `/`, or when the `realpathSync`-resolved `target` is inside `ctx.root` outside `node_modules`.
- Triggers `outside-workspace` when `ref.target && !ref.targetOwner && isWorkspaceEscape`.
- Installed external packages under `node_modules/` (when not reached via `.` or `/`) do not trigger this rule.

## Fingerprinting & Exception Semantics

- Fingerprints `moduleTokens(node, sf)`.
- Zero active legacy exceptions.

## Examples

**Invalid (`apps/api/src/handler.ts`):**

```ts
import "../../../scripts/check-architecture.mjs";
```

**Valid (`apps/api/src/handler.ts`):**

```ts
import { z } from "zod";
import { ChunkSchema } from "@everlast/contracts";
```

## ESLint Feasibility & Existing Plugin Comparison

- **Existing plugins**: `import-x/no-relative-packages` catches relative imports into *other* packages, not escapes into unowned repo folders (`scripts/`, root files) via relative paths or `tsconfig` aliases. `boundaries/no-unknown` checks whether the *current* file belongs to an element, not arbitrary unowned repo targets.
- **Custom ESLint rule**: **Medium feasibility** using [`resolve.mjs`](../../scripts/architecture/resolve.mjs) + `realpathSync` containment checks.
