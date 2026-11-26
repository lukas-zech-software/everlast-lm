# Architecture Guardrail Rules (`CC-09` / `D21`)

This directory documents each individual static architecture rule enforced by [`scripts/check-architecture.mjs`](../../scripts/check-architecture.mjs), its modular implementation under [`scripts/architecture/rules/`](../../scripts/architecture/rules/index.mjs), and an assessment of ESLint plugin/custom-rule feasibility.

Governance authority: [Constitution IV / CC-09](../../.specify/memory/constitution.md), [Agent Architecture Guardrails](../agent-architecture-guardrails.md), and [`D21`](../solution-architecture.md#d21--incremental-architecture-enforcement-2026-11-07).

## Architecture Rules Catalog

| Rule ID | Category | Inspected Surfaces | Legacy `T035` Exceptions | ESLint Verdict | Implementation |
| --- | --- | --- | --- | --- | --- |
| [`wildcard-export`](wildcard-export.md) | Manifest | `package.json` `exports` | 0 | Custom `@eslint/json` rule feasible (no exact plugin rule forbids valid wildcards) | [`wildcard-export.mjs`](../../scripts/architecture/rules/wildcard-export.mjs) |
| [`invalid-export`](invalid-export.md) | Manifest | `package.json` `exports` | 0 | Partial in `eslint-plugin-package-json` (`package-json/valid-exports`) | [`invalid-export.mjs`](../../scripts/architecture/rules/invalid-export.mjs) |
| [`no-cross-app`](no-cross-app.md) | Dependency direction | `package.json` deps + TS/JS imports | 51 | Partial in `eslint-plugin-boundaries` / `import-x`; blocked by `D21` exceptions & manifest/loader gaps | [`no-cross-app.mjs`](../../scripts/architecture/rules/no-cross-app.mjs) |
| [`no-shared-to-app`](no-shared-to-app.md) | Dependency direction | `package.json` deps + TS/JS imports | 37 | Partial in `eslint-plugin-boundaries` / `import-x`; blocked by `D21` exceptions & manifest/loader gaps | [`no-shared-to-app.mjs`](../../scripts/architecture/rules/no-shared-to-app.mjs) |
| [`contracts-only`](contracts-only.md) | Package role | `package.json` deps + TS/JS production imports | 0 | Partial in `eslint-plugin-boundaries` + `no-restricted-imports` (misses `package.json` & `createRequire`) | [`contracts-only.mjs`](../../scripts/architecture/rules/contracts-only.mjs) |
| [`browser-safe`](browser-safe.md) | Package role | `package.json` prod deps + TS/JS production imports | 0 | Partial in `import-x/no-nodejs-modules` + `boundaries` + `no-restricted-imports` | [`browser-safe.mjs`](../../scripts/architecture/rules/browser-safe.mjs) |
| [`no-production-testkit`](no-production-testkit.md) | Package role | `package.json` prod deps + TS/JS production imports | 0 | Partial in `eslint-plugin-boundaries` / `import-x/no-restricted-paths` (misses `package.json` & `createRequire`) | [`no-production-testkit.mjs`](../../scripts/architecture/rules/no-production-testkit.mjs) |
| [`public-entrypoint`](public-entrypoint.md) | Boundary | TS/JS cross-package imports vs. `exports` | 0 | Custom ESLint rule required (`package.json` `exports` + `tsconfig` alias awareness) | [`public-entrypoint.mjs`](../../scripts/architecture/rules/public-entrypoint.mjs) |
| [`unscanned-module`](unscanned-module.md) | Integrity | TS/JS imports resolving inside skipped build dirs | 0 | Keep in standalone checker (requires full workspace scan vs. ESLint ignores) | [`unscanned-module.mjs`](../../scripts/architecture/rules/unscanned-module.mjs) |
| [`outside-workspace`](outside-workspace.md) | Boundary | TS/JS imports escaping `apps/*` and `packages/*` | 0 | Custom ESLint rule feasible (no exact existing plugin rule for realpath workspace containment) | [`outside-workspace.mjs`](../../scripts/architecture/rules/outside-workspace.mjs) |
| [`unresolved-internal`](unresolved-internal.md) | Integrity | `package.json` `@everlast/*` + TS/JS internal imports | 0 | Partial in `import-x/no-unresolved` + `tsc -b` (misses `package.json`; `no-unresolved` flags CDN URLs) | [`unresolved-internal.mjs`](../../scripts/architecture/rules/unresolved-internal.mjs) |
| [`computed-module`](computed-module.md) | Integrity | Dynamic `import(expr)` and `require`/loader calls | 0 | Custom ESLint rule ideal (`import-x/no-dynamic-require` misses `import()` & `createRequire` aliases) | [`computed-module.mjs`](../../scripts/architecture/rules/computed-module.mjs) |
| [`parse-error`](parse-error.md) | Integrity | TS/JS syntax diagnostics | 0 | **Already covered** by ESLint parser + `tsc -b` | [`parse-error.mjs`](../../scripts/architecture/rules/parse-error.mjs) |
| [`package-cycle`](package-cycle.md) | Graph | Whole-repo production package dependency graph | 0 | Keep in standalone checker (`import-x/no-cycle` only checks file-level cycles, misses package-level cycles) | [`package-cycle.mjs`](../../scripts/architecture/rules/package-cycle.mjs) |

## Policy Governance & Structural Invariants

In addition to the 14 inspection rules above, the architecture gate enforces fail-closed invariants and D21 migration-debt governance in [`scripts/architecture/policy.mjs`](../../scripts/architecture/policy.mjs) and [`scripts/check-architecture.mjs`](../../scripts/check-architecture.mjs):

- **Fail-closed structural errors (thrown, not policy-exceptable)**:
  - Source symlinks inside `apps/` or `packages/` (`walk()` in [`utils.mjs`](../../scripts/architecture/utils.mjs))
  - Duplicate workspace package names across `apps/*/package.json` and `packages/*/package.json`
  - Workspace source files without an owning `package.json`
- **Exception record checks (`scripts/architecture-policy.json`)**:
  - `duplicate-exception`: duplicate `[rule, from, to, fingerprint]` key
  - `invalid-exception`: missing required metadata (`owner`, `decision` matching `^D\d+$`, valid `YYYY-MM-DD` `expires`, `baseline`, `removalTask`, `reason`, positive integer `count`)
  - `expired-exception`: `expires <= now` (current `T035` inventory expires `2027-02-05`)
  - `invalid-removal-task` / `completed-or-missing-removal-task`: `removalTask` must reference an open `- [ ] Txxx` task in `specs/<feature>/tasks.md`
  - `stale-exception` / `exception-count`: excepted violation disappeared or changed occurrence count
  - `exception-expansion`: `--base-ref` comparison prohibits adding or modifying exceptions in PRs

---

## ESLint Plugin & Custom Rule Validation

### Repository Constraints Affecting ESLint Migration

Before moving any rule into [`eslint.config.mjs`](../../eslint.config.mjs), five repository-specific constraints apply:

1. **D21 Token-Fingerprinted Exceptions & `--base-ref` Anti-Expansion**: There are **88** remaining `T035` exceptions (`51` `no-cross-app`, `37` `no-shared-to-app`) in [`scripts/architecture-policy.json`](../../scripts/architecture-policy.json), keyed by `sha256` of TypeScript scanner tokens and protected against `eslint-disable` comments or PR expansion via `--base-ref`. ESLint's `/* eslint-disable-next-line */` model violates the repo's [zero-suppression discipline](../code-conventions.md) and has no built-in `--base-ref` expiry/count/removal-task governance.
2. **File Coverage (`package.json` vs. `.ts`/`.mjs`)**: Current [`eslint.config.mjs`](../../eslint.config.mjs) only lints `**/*.{ts,mts,cts}` and `**/*.{js,mjs,cjs}`. Checking `package.json` (`wildcard-export`, `invalid-export`, `dependencies`/`devDependencies` edges) requires adding `@eslint/json` (not currently installed).
3. **Syntax Coverage Beyond Standard ES Imports**: `check-architecture.mjs` inspects ESM `import`/`export ... from`, `import type`, inline `import("pkg").Type`, TypeScript `import x = require("pkg")`, dynamic `import(...)`, CommonJS `require(...)`, **renamed `createRequire` factories and aliases**, and `tsconfig.json` `paths` precedence. Standard import plugins inspect ES/CJS imports and `import type`, but miss `createRequire` aliasing and `TSImportType` (`import('...').X`) unless extended.
4. **TypeScript 7 + TS 6 `registerHooks` Compatibility**: [`eslint.config.mjs`](../../eslint.config.mjs) routes `typescript` to `typescript-compiler` (`6.0.2`). Any ESLint resolver or custom rule using the TS compiler API works cleanly with this setup, whereas third-party plugins spawning `ts` or expecting `eslint-import-resolver-typescript` must be tested against TS 6/7 path resolution.
5. **Browser HTTPS CDN Imports**: `apps/web/src/lib/auth.ts` uses browser-native HTTPS Firebase CDN imports (`@ts-expect-error TS2307` documented in [`docs/code-conventions.md`](../code-conventions.md)). Rules like `import-x/no-unresolved` flag external URLs unless explicitly ignored, whereas `unresolved-internal` intentionally validates only internal/relative/alias/`@everlast/*` specifiers.

### Detailed Rule-by-Rule Assessment

#### 1. Already Covered by ESLint & TypeScript (`tsc -b`)
- **`parse-error`**: ESLint's built-in parser (`@typescript-eslint/parser` for TS, Espree for JS) already fails on syntax errors, alongside `tsc -b --noEmit`. **No new plugin needed.** Keeping `parse-error` inside `check-architecture.mjs` remains useful only as a fail-closed guard when the standalone script runs on fixtures or before ESLint.

#### 2. Existing Plugin Equivalents Available (With Gaps)
- **`no-cross-app`** & **`no-shared-to-app`**:
  - *Existing plugin*: `eslint-plugin-boundaries` (`boundaries/element-types`) or `eslint-plugin-import-x` (`import-x/no-restricted-paths`).
  - *Gaps*: Neither inspects `package.json` `dependencies` nor `createRequire` aliases nor `TSImportType` (`type X = import('@everlast/worker').Y`) out of the box, and migrating now is blocked by the 88 `D21` exceptions without violating zero-suppression rules.
  - *Recommendation*: Defer ESLint adoption until `specs/004-ui-skeleton-quality-gates T035` eliminates the 88 exceptions; keep manifest and `createRequire` coverage in `check-architecture.mjs` or a custom rule.
- **`contracts-only`**, **`browser-safe`**, **`no-production-testkit`**:
  - *Existing plugins*:
    - `boundaries/element-types` can express `@everlast/contracts -> nothing` (and `boundaries/external` can restrict external packages to `zod`), `@everlast/web -> @everlast/contracts`, and `prod -> !testkit/evals` (with `test` file overrides).
    - ESLint core `no-restricted-imports` (applied via `files: ["apps/web/src/**/*.ts"]` excluding tests) plus `import-x/no-nodejs-modules` can block `node:*`, `pg`, `@google/*`, and `@google-cloud/*` in `@everlast/web`.
    - `import-x/no-restricted-paths` can block `@everlast/testkit` and `@everlast/evals` in non-test files.
  - *Gaps*: `no-restricted-imports` misses `require()`, `import()`, and `package.json` dependencies; `boundaries` and `import-x` miss `package.json` `dependencies` and `createRequire` aliases.
  - *Recommendation*: **Can be enabled in ESLint today for instant IDE feedback** (0 legacy exceptions exist!) using core `no-restricted-imports` (zero new dependencies) or `eslint-plugin-boundaries` / `eslint-plugin-import-x`, while keeping `check-architecture.mjs` as the authoritative CI gate for manifests, `createRequire`, and `TSImportType`.
- **`unresolved-internal`**:
  - *Existing plugin*: `eslint-plugin-import-x` (`import-x/no-unresolved` with `eslint-import-resolver-typescript`).
  - *Gaps*: `import-x/no-unresolved` checks *all* imports (requiring ignore patterns for `apps/web/src/lib/auth.ts` HTTPS CDN URLs), does not check `package.json` `@everlast/*` dependencies, and uses a different resolver than `ts.resolveModuleName` + `package.json` `exports`. Furthermore, `tsc -b --noEmit` already catches unresolved TS imports.
  - *Recommendation*: Rely on `tsc -b` + `check-architecture.mjs`; adding `import-x/no-unresolved` adds noise for limited gain.
- **`invalid-export`**:
  - *Existing plugin*: `eslint-plugin-package-json` (`package-json/valid-exports`) via `@eslint/json`.
  - *Gaps*: `valid-exports` checks Node `exports` syntax and `./` prefixes, but needs verification for path-traversal containment (`./../outside`) and requires installing `@eslint/json` + `eslint-plugin-package-json`.
  - *Recommendation*: Optional if `eslint-plugin-package-json` is adopted for general `package.json` hygiene; otherwise keep in `check-architecture.mjs`.

#### 3. Custom ESLint Rule Candidates (No Exact Existing Plugin Rule)
- **`computed-module`**:
  - *Existing plugin comparison*: `import-x/no-dynamic-require` catches non-literal `require(x)`, **but** does not catch non-literal dynamic `import(x)` or renamed `createRequire` loaders.
  - *Custom rule feasibility*: **High (trivial, pure AST)**. A ~40-line local ESLint rule (no extra dependencies, no filesystem I/O) can flag `ImportExpression` with non-literal `source`, `CallExpression` on `require` or `createRequire` aliases with non-literal `arguments[0]`, and `TSImportType` with non-literal argument. Ready to enable immediately (0 exceptions).
- **`public-entrypoint`**:
  - *Existing plugin comparison*: `boundaries/entry-point` and `import-x/no-internal-modules` / `import-x/no-relative-packages` approximate this with glob patterns, **but** they do not resolve `package.json` `exports` maps dynamically, reject wildcard fallback targets, or detect `tsconfig.json` `paths` alias spoofing (`@everlast/contracts -> apps/worker/src/index.ts`).
  - *Custom rule feasibility*: **Medium**. A custom ESLint rule reusing [`scripts/architecture/resolve.mjs`](../../scripts/architecture/resolve.mjs) works in ESLint, though computing per-file `tsconfig` options adds lint overhead unless cached across ESLint's file pass. Ready in principle (0 exceptions).
- **`outside-workspace`**:
  - *Existing plugin comparison*: `import-x/no-relative-packages` catches relative imports into *another* package, not escapes to repo-root scripts/docs/fixtures outside `apps/*` and `packages/*` resolved through `realpathSync`.
  - *Custom rule feasibility*: **Medium** (same resolution cache as `public-entrypoint`).
- **`wildcard-export`**:
  - *Existing plugin comparison*: `package-json/valid-exports` allows valid wildcard patterns (`"./*": "./src/*.ts"`), whereas this repo forbids them outright.
  - *Custom rule feasibility*: **High**, if `@eslint/json` is added to `eslint.config.mjs` (simple JSON AST visitor on `exports` keys/values).

#### 4. Must Remain in Standalone Architecture Checker
- **`package-cycle`**:
  - *Existing plugin comparison*: `import-x/no-cycle` checks **file-level** cycles (`a.ts -> b.ts -> a.ts`). It does **not** catch **package-level** cycles across disjoint files (`pkgA/a.ts -> pkgB/x.ts` and `pkgB/y.ts -> pkgA/b.ts`) and ignores `package.json` dependency cycles.
  - *ESLint feasibility*: **Low / Anti-pattern**. Cross-package whole-graph reachability requires scanning all `apps/*` and `packages/*` manifests and production files before answering any single file—defeating ESLint's per-file incremental architecture.
- **`unscanned-module`**:
  - *ESLint feasibility*: **Not suitable**. Detecting imports into directories ignored by the scanner (`dist/`, `build/`) contradicts ESLint's ignore model and requires comparing resolved paths against the full scanned file set.
- **Policy & Structural Invariants** (`policy.mjs`, `--base-ref`, symlink rejection):
  - *ESLint feasibility*: **Not suitable**. Whole-inventory exception accounting (`stale-exception`, `exception-count`, `duplicate-exception`, `completed-or-missing-removal-task`, `--base-ref` `exception-expansion`) is inherently cross-repo and git-aware.

### Recommended Phased Strategy

1. **Immediate (Zero New Dependencies)**:
   - Add core ESLint `no-restricted-imports` rules in `eslint.config.mjs` for `@everlast/web` (`node:*`, `pg`, `@google/*`, `@google-cloud/*`) and non-test production code (`@everlast/testkit`, `@everlast/evals`) for immediate IDE squiggles, plus an optional local custom ESLint plugin in `scripts/eslint-rules/` for **`computed-module`** (pure AST, zero I/O, instant).
   - Keep `scripts/check-architecture.mjs` as the single authoritative CI gate covering `package.json`, `createRequire`, `TSImportType`, `tsconfig` paths, `package-cycle`, `unscanned-module`, and `D21` policy governance.
2. **After `T035` Burn-Down (0 Remaining Exceptions)**:
   - Optionally expose **`public-entrypoint`**, **`outside-workspace`**, **`no-cross-app`**, **`no-shared-to-app`**, and **`contracts-only`** through a lightweight local ESLint plugin backed by [`scripts/architecture/resolve.mjs`](../../scripts/architecture/resolve.mjs) for real-time editor feedback, while retaining [`scripts/check-architecture.mjs`](../../scripts/check-architecture.mjs) for whole-repo manifest, graph cycle, and fail-closed integrity checks.
