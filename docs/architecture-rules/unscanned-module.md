# Rule: `unscanned-module`

| Property | Value |
| --- | --- |
| **Rule ID** | `unscanned-module` |
| **Category** | Integrity |
| **Authority** | Constitution IV / `CC-09`, [Agent Architecture Guardrails](../agent-architecture-guardrails.md), `D21` |
| **Inspected Surfaces** | TS/JS module references resolving inside skipped build/output directories (`dist`, `build`, `coverage`, `node_modules`, `.git`, `.tsbuild`) |
| **Implementation** | [`unscanned-module.mjs`](../../scripts/architecture/rules/unscanned-module.mjs) |
| **Index** | [Architecture Rules Index](README.md) |

## Purpose & Rationale

Fails closed when a source file imports a JS/TS module owned by a workspace package that was excluded from the directory walk (for example `./dist/bypass.js`). Prevents forbidden imports from hiding inside generated or ignored directories.

## Detection Logic

Evaluated on resolved module references (`checkModuleReference`):

- Checks `ref.targetOwner && sourcePattern.test(ref.target) && !ctx.fileSet.has(ref.target)`.
- Since `ctx.fileSet` holds every file discovered by `walk()` across `apps/` and `packages/`, any source-extension file under a package directory that is missing from `fileSet` came from a skipped directory.

## Fingerprinting & Exception Semantics

- Fingerprints `moduleTokens(node, sf)`.
- Zero active legacy exceptions.

## Examples

**Invalid (`apps/api/src/handler.ts`):**

```ts
import "./dist/bypass.js";
```

**Valid (`apps/api/src/handler.ts`):**

```ts
import "./service.js";
```

## ESLint Feasibility & Existing Plugin Comparison

- **Existing plugins**: None. ESLint explicitly skips files matching `ignores` (including `**/dist/**`, `**/build/**`) and does not compare import targets against a whole-repository scanned file inventory.
- **Custom ESLint rule**: **Not suitable**. Keep in [`scripts/check-architecture.mjs`](../../scripts/check-architecture.mjs), where the full `walk()` file set is already constructed.
