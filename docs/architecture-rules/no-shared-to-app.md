# Rule: `no-shared-to-app`

| Property | Value |
| --- | --- |
| **Rule ID** | `no-shared-to-app` |
| **Category** | Dependency direction |
| **Authority** | Constitution IV / `CC-09`, `D21` |
| **Inspected Surfaces** | `packages/*/package.json` and all TS/JS imports/exports/loaders in `packages/*` |
| **Implementation** | [`no-shared-to-app.mjs`](../../scripts/architecture/rules/no-shared-to-app.mjs) |
| **Index** | [Architecture Rules Index](README.md) |

## Purpose & Rationale

Forbids shared workspace packages (`packages/*`) from depending on or importing deployment applications (`apps/*`). Shared packages must remain independent of app entrypoints, transport layers, and app-specific composition roots.

## Detection Logic

Evaluated on every cross-package dependency edge (`checkDependencyEdge`):

- Triggers when `edge.fromDirRel.startsWith("packages/")` and `edge.toDirRel.startsWith("apps/")`.
- Covers `package.json` dependencies (`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`) as well as all TS/JS import, export, `import type`, `TSImportType`, dynamic `import()`, `require()`, and `createRequire` loader references.

## Fingerprinting & Exception Semantics

- Source imports fingerprint `moduleTokens(node, sf)`; manifest entries fingerprint `[section, name, version]`.
- Currently accounts for **37** legacy `D21` exceptions in [`scripts/architecture-policy.json`](../../scripts/architecture-policy.json) (`specs/004-ui-skeleton-quality-gates T035`, expiring `2027-02-05`).

## Examples

**Invalid (`packages/db/src/helper.ts`):**

```ts
export * from "@everlast/api";
```

**Valid (`packages/db/src/helper.ts`):**

```ts
import { ChunkSchema } from "@everlast/contracts";
```

## ESLint Feasibility & Existing Plugin Comparison

- **Existing plugins**: `eslint-plugin-boundaries` (`boundaries/element-types`) and `eslint-plugin-import-x` (`import-x/no-restricted-paths`) enforce `packages/*` cannot import `apps/*` on standard source imports.
- **Gaps**: Misses `package.json` dependencies, `createRequire` aliases, and `TSImportType`, and is **blocked until the 37 `D21` legacy exceptions are eliminated** under `T035`.
- **Custom ESLint rule**: **Medium feasibility** post-`T035` using [`resolve.mjs`](../../scripts/architecture/resolve.mjs) for source files.
