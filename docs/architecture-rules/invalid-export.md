# Rule: `invalid-export`

| Property | Value |
| --- | --- |
| **Rule ID** | `invalid-export` |
| **Category** | Manifest |
| **Authority** | Constitution IV / `CC-09`, `C-01..C-03`, `D21` |
| **Inspected Surfaces** | `apps/*/package.json`, `packages/*/package.json` (`exports`) |
| **Implementation** | [`invalid-export.mjs`](../../scripts/architecture/rules/invalid-export.mjs) |
| **Index** | [Architecture Rules Index](README.md) |

## Purpose & Rationale

Requires every `package.json` `exports` target path to start with `./` and resolve strictly inside the declaring package's directory. Prevents broken export specs or directory-traversal exports (`./../other/src/index.ts`) from leaking files outside package ownership.

## Detection Logic

1. Normalizes `pkg.data.exports` via `exportMap()`.
2. Iterates every leaf string `target` in `leaves(value)`.
3. Emits `invalid-export` (`from = <pkg>/package.json`, `to = target`) if `!target.startsWith("./")` or `!resolve(pkg.dir, target).startsWith(pkg.dir + sep)`.

## Fingerprinting & Exception Semantics

- Statement payload: `[key, value]`.
- Line number defaults to `1`.

## Examples

**Invalid (`package.json`):**

```json
{
  "name": "@everlast/db",
  "exports": {
    ".": "src/index.ts",
    "./leak": "./../api/src/secret.ts"
  }
}
```

**Valid (`package.json`):**

```json
{
  "name": "@everlast/db",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

## ESLint Feasibility & Existing Plugin Comparison

- **Existing plugins**: `eslint-plugin-package-json` provides `package-json/valid-exports` (using `@eslint/json`), which validates Node `exports` format including `./` prefixes, though path-traversal resolution (`resolve(pkg.dir, target)`) should be verified against its exact implementation.
- **Custom ESLint rule**: **High feasibility** alongside `@eslint/json`, though adding `@eslint/json` solely for manifest rules adds setup for checks already covered by `check-architecture.mjs`.
