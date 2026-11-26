# Rule: `package-cycle`

| Property | Value |
| --- | --- |
| **Rule ID** | `package-cycle` |
| **Category** | Graph |
| **Authority** | Constitution IV / `CC-09`, [Agent Architecture Guardrails](../agent-architecture-guardrails.md), `D21` |
| **Inspected Surfaces** | Whole-workspace production dependency graph (`apps/*` and `packages/*` manifests + non-test TS/JS imports) |
| **Implementation** | [`package-cycle.mjs`](../../scripts/architecture/rules/package-cycle.mjs) |
| **Index** | [Architecture Rules Index](README.md) |

## Purpose & Rationale

Forbids circular dependencies between workspace packages across production source files and non-dev `package.json` dependencies. Cycles undermine layered modularity, contract independence, and incremental builds.

## Detection Logic

Evaluated after all manifests and source files have been scanned (`checkDependencyGraph`):

1. Collects all cross-package production edges (`!edge.isTest`, excluding `devDependencies` and test files).
2. Builds a directed package adjacency graph `a -> b`.
3. For each edge `(a -> b)`, runs DFS reachability (`reaches(adjacency, b, a)`). If `b` can reach `a`, emits `package-cycle` on that edge (`from`, `to`, `statement`, `line`).

## Fingerprinting & Exception Semantics

- Source edges fingerprint `moduleTokens(node, sf)`; manifest edges fingerprint `[section, name, version]`.
- Zero active legacy exceptions.

## Examples

**Invalid (`packages/db/src/a.ts` + `packages/contracts/src/b.ts`):**

```ts
// packages/db/src/a.ts
import "@everlast/contracts";

// packages/contracts/src/b.ts
import "@everlast/db";
```

**Valid (`packages/db/src/a.ts`):**

```ts
// packages/db/src/a.ts -> @everlast/contracts (acyclic DAG)
import "@everlast/contracts";
```

## ESLint Feasibility & Existing Plugin Comparison

- **Existing plugins**: `eslint-plugin-import-x` provides `import-x/no-cycle`, which detects **file-level** cycles (`a.ts -> b.ts -> a.ts`).
- **Gaps**: `import-x/no-cycle` does **not** detect **package-level** cycles across disjoint files (`pkgA/one.ts -> pkgB/one.ts` and `pkgB/two.ts -> pkgA/two.ts`), and ignores `package.json` dependency cycles.
- **Custom ESLint rule**: **Not suitable**. Whole-repo package graph reachability requires scanning every package manifest and source file in the monorepo, making it a poor fit for ESLint's per-file linting model. Keep `package-cycle.mjs` in the standalone architecture checker.
