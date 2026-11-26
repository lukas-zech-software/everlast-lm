# TypeScript Clean-Code Conventions (Tier 2)

Everlast LM enforces strict formatting, type safety, and clean-code complexity discipline across all workspace apps and packages (`apps/*`, `packages/*`) via **Prettier** and **ESLint**.

## Formatting (Prettier)

Configured in [`.prettierrc.json`](../.prettierrc.json) and [`.prettierignore`](../.prettierignore):

- **Semicolons**: always (`semi: true`)
- **Quotes**: double quotes (`singleQuote: false`)
- **Trailing commas**: all (`trailingComma: "all"`)
- **Line width**: `100` (`printWidth: 100`), `2`-space indentation, LF line endings

## Lint & Clean-Code Rules (ESLint)

Configured in [`eslint.config.mjs`](../eslint.config.mjs) using ESLint flat config with `eslint-config-prettier`:

1. **Strict Type-Aware TypeScript (`typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`)**:
   - No `any`, no unsafe member access/assignment/call/return/argument, no non-null assertions (`!`).
   - Explicit module boundary return/parameter types (`@typescript-eslint/explicit-module-boundary-types`) on exported APIs in `src/`.
   - Consistent inline type imports/exports (`@typescript-eslint/consistent-type-imports`, `consistent-type-exports`, `no-import-type-side-effects`).
   - Exhaustive `switch` checks, `prefer-readonly`, `no-deprecated` (Zod v4 idioms: `z.uuid()`, `z.iso.datetime()`, `z.url()`, `"custom"`, `{ error }`).
   - Safe `async`/`await` and promise hygiene (`require-await`, `no-floating-promises`, `no-misused-promises`, `use-unknown-in-catch-callback-variable`).
2. **Complexity & Decomposition (`complexity`, `sonarjs`, core ESLint)**:
   - Cyclomatic complexity `<= 20` (`complexity`)
   - Cognitive complexity `<= 15` (`sonarjs/cognitive-complexity`)
   - Maximum block nesting depth `<= 4` (`max-depth`)
   - Maximum function parameters `<= 5` (`max-params`) — prefer typed options objects
   - Early returns (`no-else-return`), flat conditionals (`no-nested-ternary`, `no-lonely-if`, `sonarjs/no-collapsible-if`), and single-responsibility helper extraction.
3. **Modern Idioms (`eslint-plugin-unicorn`)**:
   - Explicit `node:` protocol imports (`unicorn/prefer-node-protocol`), `Number.*` methods, `structuredClone`, `Date.now()`, `Error` with messages, `.slice()`, `.some()`, `Set#has()`, and spread where safe (use `codePointAt` / `for...of` for Unicode code-point counting).
4. **Zero-Suppression Discipline**:
   - Do not add `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, or `as any` to silence rules. Refactor or narrow types properly instead.
   - Exception: `apps/web/src/lib/auth.ts` retains its two `@ts-expect-error TS2307` markers for browser-native HTTPS Firebase CDN imports.
   - Legacy D21 excepted imports tracked in [`scripts/architecture-policy.json`](../scripts/architecture-policy.json) carry `// prettier-ignore` where needed so their exact token fingerprints remain intact until their owning removal task (`specs/004-ui-skeleton-quality-gates` `T035`) completes.

## TypeScript 7 (`tsgo`) + ESLint Side-by-Side Setup

The repository compiles with TypeScript 7 (`^7.0.2`), which does not expose the legacy JS compiler API required by `typescript-eslint`. [`eslint.config.mjs`](../eslint.config.mjs) uses `node:module` `registerHooks` to route `typescript` imports inside ESLint to the repo's pinned `typescript-compiler` (`6.0.2`), keeping TypeScript 7 unchanged for `tsc -b` and `pnpm typecheck`.

## Commands

- `pnpm format` — auto-format files with Prettier
- `pnpm format:check` — verify Prettier formatting
- `pnpm lint:eslint` — run ESLint across all workspaces
- `pnpm lint:eslint:fix` — apply safe ESLint autofixes
- `pnpm lint` — run the full CI gate (spec integrity, architecture boundaries/artifacts, Prettier, ESLint, and `tsc -b --noEmit`)
