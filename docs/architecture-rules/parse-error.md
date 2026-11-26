# Rule: `parse-error`

| Property | Value |
| --- | --- |
| **Rule ID** | `parse-error` |
| **Category** | Integrity |
| **Authority** | Constitution IV / `CC-09`, [Agent Architecture Guardrails](../agent-architecture-guardrails.md), `D21` |
| **Inspected Surfaces** | All `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` files under `apps/*` and `packages/*` |
| **Implementation** | [`parse-error.mjs`](../../scripts/architecture/rules/parse-error.mjs) |
| **Index** | [Architecture Rules Index](README.md) |

## Purpose & Rationale

Fails closed if any workspace source file contains syntax parse diagnostics in the pinned TypeScript 6 compiler parser. Prevents syntax errors or unsupported syntax from causing the AST walker to miss forbidden imports.

## Detection Logic

Evaluated once per source file (`checkSourceFile`):

- Iterates `fileInfo.sf.parseDiagnostics` produced by `ts.createSourceFile(...)`.
- Emits `parse-error` with `from = fileInfo.from`, `to = ""`, and the flattened TypeScript diagnostic message as the statement payload.

## Fingerprinting & Exception Semantics

- Fingerprints the flattened TypeScript parse diagnostic text.
- Zero active legacy exceptions.

## Examples

**Invalid (`apps/api/src/broken.ts`):**

```ts
import { x from "@everlast/worker";
```

**Valid (`apps/api/src/valid.ts`):**

```ts
import { x } from "@everlast/contracts";
```

## ESLint Feasibility & Existing Plugin Comparison

- **Existing plugins / built-in**: **Already covered** by ESLint's parser (`@typescript-eslint/parser` for TS, Espree for JS) as well as `tsc -b --noEmit`.
- **Recommendation**: Keep `parse-error.mjs` inside `check-architecture.mjs` solely as a fail-closed guard when the standalone script runs on fixtures or independently of ESLint; no new ESLint plugin or rule is needed.
