# Rule: `wildcard-export`

| Property | Value |
| --- | --- |
| **Rule ID** | `wildcard-export` |
| **Category** | Manifest |
| **Authority** | Constitution IV / `CC-09`, `C-01..C-03`, `D21` |
| **Inspected Surfaces** | `apps/*/package.json`, `packages/*/package.json` (`exports`) |
| **Implementation** | [`wildcard-export.mjs`](../../scripts/architecture/rules/wildcard-export.mjs) |
| **Index** | [Architecture Rules Index](README.md) |

## Purpose & Rationale

Forbids wildcard patterns (`*`) in `package.json` `exports` keys or target values. Wildcard exports expose an entire internal source tree as public API, bypassing explicit public interfaces and allowing consumers to couple to private implementation files.

## Detection Logic

1. Normalizes `pkg.data.exports` via `exportMap()` (handles string, array, conditional root object, or subpath map).
2. For each `[key, value]` entry, flattens leaf target strings via `leaves(value)`.
3. Emits `wildcard-export` (`from = <pkg>/package.json`, `to = key`) if `key.includes("*")` or any leaf target contains `*`.

## Fingerprinting & Exception Semantics

- Statement payload: `[key, value, wildcardMatches(ctx.files, pkg.dir, value).map(ctx.rel)]`.
- Fingerprinting the matched file list guarantees that adding a new source file under an excepted wildcard export invalidates the legacy exception rather than silently exposing new modules.

## Examples

**Invalid (`package.json`):**

```json
{
  "name": "@everlast/db",
  "exports": {
    "./*": "./src/*.ts"
  }
}
```

**Valid (`package.json`):**

```json
{
  "name": "@everlast/db",
  "exports": {
    ".": "./src/index.ts",
    "./ports": "./src/ports.ts"
  }
}
```

## ESLint Feasibility & Existing Plugin Comparison

- **Existing plugins**: `eslint-plugin-package-json` (`package-json/valid-exports`) validates Node `exports` syntax, which *permits* valid wildcard patterns. No standard plugin forbids wildcard exports specifically.
- **Custom ESLint rule**: **High feasibility** if `@eslint/json` is added to [`eslint.config.mjs`](../../eslint.config.mjs) (a small JSON AST rule checking `exports` keys and string leaves for `*`). Note that ESLint would only catch the presence of `*`, not fingerprint the expanded file list for `D21` exception anti-widening.
