# Rule: `no-cross-app`

| Property | Value |
| --- | --- |
| **Rule ID** | `no-cross-app` |
| **Category** | Dependency direction |
| **Authority** | Constitution IV / `CC-09`, `D16`, `D21` |
| **Inspected Surfaces** | `apps/*/package.json` (`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`) and all TS/JS imports/exports/loaders |
| **Implementation** | [`no-cross-app.mjs`](../../scripts/architecture/rules/no-cross-app.mjs) |
| **Index** | [Architecture Rules Index](README.md) |

## Purpose & Rationale

Forbids any deployment application (`apps/*`) from depending on or importing another deployment application (`apps/*`). Deployment applications must not act as shared libraries for other applications; shared logic must live behind explicit public interfaces in `packages/*`.

## Detection Logic

Evaluated on every cross-package dependency edge (`checkDependencyEdge`):

- Triggers when `edge.fromDirRel.startsWith("apps/")` and `edge.toDirRel.startsWith("apps/")` (with `fromPkg !== toPkg`).
- Covers both `package.json` dependency sections and source references resolved across ESM `import`/`export ... from`, `import type`, `import x = require(...)`, `TSImportType` (`import('...').T`), dynamic `import()`, `require()`, renamed `createRequire` loaders, relative paths, and `tsconfig.json` `paths` aliases.

## Fingerprinting & Exception Semantics

- Source imports fingerprint `moduleTokens(node, sf)` (whitespace/comments ignored; quote style, imported bindings, and trailing commas retained).
- Manifest dependencies fingerprint `[section, name, version]`.
- Currently accounts for **51** legacy `D21` exceptions in [`scripts/architecture-policy.json`](../../scripts/architecture-policy.json) (`specs/004-ui-skeleton-quality-gates T035`, expiring `2027-02-05`).

## Examples

**Invalid (`apps/api/src/route.ts`):**

```ts
import { runJob } from "@everlast/worker";
import type { JobState } from "../../worker/src/index.ts";
```

**Valid (`apps/api/src/route.ts`):**

```ts
import { JobSchema } from "@everlast/contracts";
import { createJobRecord } from "@everlast/db";
```

## Harness exemption (D25)

Test-file importers and `devDependencies` manifest edges between apps are harness edges (`scripts/architecture/roles.mjs`, Constitution IV/CC-09 2.4.0) and are not reported
by this rule. A harness edge is one of three kinds: an importer in a package-level `test/`/`tests/` directory, a
`__tests__/` directory or a `*.test.*`/`*.spec.*` file (a `test/` directory under `src/` is production code); a
`devDependencies` manifest edge; or an importer in `@everlast/evals`. Harness code still reaches other packages
only through declared `exports`, because `public-entrypoint` reports deep imports and relative escapes.
`no-production-harness-import` keeps production code from loading harness files, and `no-production-testkit`
keeps it from importing `@everlast/evals`.

## ESLint Feasibility & Existing Plugin Comparison

- **Existing plugins**: `eslint-plugin-boundaries` (`boundaries/element-types`) and `eslint-plugin-import-x` (`import-x/no-restricted-paths`) can forbid `apps/* -> apps/*` for source `import`/`require` statements.
- **Gaps**: Neither plugin checks `package.json` dependencies, `createRequire` aliases, or `TSImportType`, and enabling them in ESLint is currently **blocked by the 51 `D21` legacy exceptions** (using `eslint-disable` comments violates [zero-suppression discipline](../code-conventions.md) and bypasses `--base-ref` expiry/count checks).
- **Custom ESLint rule**: **Medium feasibility** after `T035` burn-down completes, reusing [`resolve.mjs`](../../scripts/architecture/resolve.mjs) for source files while keeping `package.json` checks in `check-architecture.mjs`.
