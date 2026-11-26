# Rule: `unresolved-internal`

| Property | Value |
| --- | --- |
| **Rule ID** | `unresolved-internal` |
| **Category** | Integrity |
| **Authority** | Constitution IV / `CC-09`, [Agent Architecture Guardrails](../agent-architecture-guardrails.md), `D21` |
| **Inspected Surfaces** | `package.json` `@everlast/*` dependencies and TS/JS internal, relative, subpath (`#`), alias, and `@everlast/*` specifiers |
| **Implementation** | [`unresolved-internal.mjs`](../../scripts/architecture/rules/unresolved-internal.mjs) |
| **Index** | [Architecture Rules Index](README.md) |

## Purpose & Rationale

Fails closed whenever an internal, relative, `#` subpath, `tsconfig.json` `paths` alias, or `@everlast/*` reference fails to resolve to a real target file or workspace package. Prevents boundary rules from silently skipping broken or misconfigured imports.

## Detection Logic

1. **Manifest dependencies (`checkPackageManifest`)**: Any dependency in `dependencies`, `devDependencies`, `peerDependencies`, or `optionalDependencies` starting with `@everlast/` that is absent from `ctx.byName` triggers `unresolved-internal`.
2. **Source references (`checkModuleReference`)**: Any literal specifier where `!ref.target` and `isInternalUnresolved(specifier, options)` is true (starts with `.`, `/`, `@everlast/`, `#`, or any `tsconfig` `paths` prefix) triggers `unresolved-internal`.
3. External package names and HTTPS CDN URLs (such as in `apps/web/src/lib/auth.ts`) are intentionally not treated as internal unresolved references.

## Fingerprinting & Exception Semantics

- Source imports fingerprint `moduleTokens(node, sf)`; manifest entries fingerprint `[section, name, version]`.
- Zero active legacy exceptions.

## Examples

**Invalid (`apps/api/src/handler.ts`):**

```ts
import "./missing.js";
import "@everlast/nonexistent";
```

**Valid (`apps/api/src/handler.ts`):**

```ts
import "./existing.js";
import { ChunkSchema } from "@everlast/contracts";
```

## ESLint Feasibility & Existing Plugin Comparison

- **Existing plugins**: `eslint-plugin-import-x` (`import-x/no-unresolved`) checks module resolution, and `tsc -b --noEmit` already reports unresolved TypeScript imports.
- **Gaps**: `import-x/no-unresolved` checks external imports too (requiring exclusions for browser HTTPS CDN imports in `apps/web/src/lib/auth.ts`), does not check `package.json` `@everlast/*` dependencies, and duplicates TypeScript's own module resolution.
- **Recommendation**: Rely on `tsc -b --noEmit` for IDE/compile errors and `unresolved-internal.mjs` for fail-closed architecture integrity; `import-x/no-unresolved` is redundant.
