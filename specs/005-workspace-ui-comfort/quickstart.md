# Quickstart: Workspace & UI Comfort

Prerequisites: Node.js 24, pnpm via Corepack (version from `package.json`), dependencies installed (`pnpm install` only if absent). Run commands from the repository root.

## Focused verification

1. Contract validation and language/emoji boundaries: `pnpm exec vitest run packages/contracts/test/package-v2-1.test.ts`
2. Repository and source-count behavior: `pnpm exec vitest run packages/db/test/workspace-preferences.test.ts`
3. Topic emoji selector behavior: `pnpm exec vitest run apps/worker/test/topic-emoji.test.ts`
4. Authenticated API behavior: `pnpm exec vitest run apps/api/test/workspace-preferences.test.ts`
5. Overview, settings, persistence and theme behavior: `pnpm exec vitest run apps/web/test/workspace-preferences.test.ts`
6. Combined feature regression: `pnpm exec vitest run packages/contracts/test/package-v2-1.test.ts packages/db/test/workspace-preferences.test.ts apps/worker/test/topic-emoji.test.ts apps/api/test/workspace-preferences.test.ts apps/api/test/chat-preferences.test.ts apps/web/test/workspace-preferences.test.ts`
7. Chromium acceptance and performance: `pnpm test:e2e --grep "Workspace comfort Chromium acceptance"`

Expected outcomes: invalid icon input is rejected without mutation; Ready counts exclude non-Ready sources; pinned notebooks stay first under every sort; list/grid, sort and theme persist; foreign-owner requests fail; language precedence and source-language citation quotes remain intact; operations do not alter source selection.

## Final required gates

- `pnpm typecheck`
- `pnpm lint`
- `node scripts/check-spec-integrity.mjs`
- `git diff --check`
- `pnpm test:unit`
- `pnpm test:e2e --grep "Workspace comfort Chromium acceptance"`

The live Flash-Lite call needs enterprise Vertex AI credentials in the approved project/`europe-west4`; without those credentials the live endpoint smoke check is `UNAVAILABLE`, not passed. The selector unit tests inject a model adapter.

Also run the exact feature Vitest command above. If any documented runner is missing, report it as `UNAVAILABLE`; do not count unavailable tests as passed. Sorting performance is measured at 100 notebooks (the v1–v5 per-user limit, SRS §5.6) and must meet 100 ms; theme application target is 50 ms and metadata is visible within 200 ms of navigation.

See [data-model.md](data-model.md) and [contracts/interfaces.md](contracts/interfaces.md) for state and API details.
