# Rule: `computed-module`

| Property | Value |
| --- | --- |
| **Rule ID** | `computed-module` |
| **Category** | Integrity |
| **Authority** | Constitution IV / `CC-09`, [Agent Architecture Guardrails](../agent-architecture-guardrails.md), `D21` |
| **Inspected Surfaces** | Dynamic `import(expr)`, `require(expr)`, `createRequire` loader calls, and `TSImportType` nodes with non-literal specifiers |
| **Implementation** | [`computed-module.mjs`](../../scripts/architecture/rules/computed-module.mjs) |
| **Index** | [Architecture Rules Index](README.md) |

## Purpose & Rationale

Rejects non-literal module specifiers in dynamic `import()`, `require()`, and `createRequire` loader calls. Computed module names cannot be resolved statically and could otherwise smuggle cross-app or private-module imports past the dependency checker.

## Detection Logic

Evaluated on AST references whose specifier argument is missing or neither `ts.isStringLiteral` nor `ts.isNoSubstitutionTemplateLiteral` (`checkComputedReference`):

- Emits `computed-module` with `to = "<computed>"` at the call's line number.
- Covers `import(varName)`, `` import(`./${name}`) ``, `require(expr)`, and aliased `const load = createRequire(...); load(expr)`.

## Fingerprinting & Exception Semantics

- Statement payload: `[statement, content]` (hashes both the AST tokens and the full source file contents so an excepted computed loader cannot silently change surrounding inputs).
- Zero active legacy exceptions.

## Examples

**Invalid (`apps/api/src/loader.ts`):**

```ts
export async function loadPlugin(name: string) {
  return import(name);
}
```

**Valid (`apps/api/src/loader.ts`):**

```ts
export async function loadContracts() {
  return import("@everlast/contracts");
}
```

## ESLint Feasibility & Existing Plugin Comparison

- **Existing plugins**: `eslint-plugin-import-x` (`import-x/no-dynamic-require`) catches non-literal `require(expr)`, **but** it does not catch non-literal dynamic `import(expr)` or renamed `createRequire` loaders.
- **Custom ESLint rule**: **High feasibility (ideal ESLint candidate)**. A small, pure-AST custom ESLint rule (zero filesystem I/O, zero new npm dependencies) can flag non-literal `ImportExpression`, `require(...)`, and `createRequire`-derived calls identically to `computed-module.mjs`.
