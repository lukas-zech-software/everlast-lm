# Quickstart Validation: Multimodal Ingestion & Sync

Scope: FR-SI-01/05, C-01/C-02, NFR-EVAL-01..04, Gate v3.0 #1. This is a validation guide, not implementation or a claim of runnable v3 services.

## Current checks and prerequisites (FR-SI-01/05, CC-01/02)

From this worktree, current planning validation is runnable:

```bash
node scripts/check-spec-integrity.mjs
git diff --check
```

Before implementation: documented Gate v2 pass, prior contract/route baseline reconciliation, isolated Postgres/Storage fixture environment, approved Speech/Drive/Model Armor API enablement and delegated test account. Use no production data. Pin cloud regions and provider/language/model revisions in benchmark manifests. Runtime v3 adapters, provider fixtures and live integrated services are currently UNAVAILABLE; root dev/db:migrate scripts print harness placeholders and do not provision them.

After the implementation stage supplies those services and failing spec-derived tests, existing commands are:

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test:contract
pnpm test:unit
pnpm test:integration
pnpm eval:deterministic
pnpm test:e2e
pnpm eval:judged
```

Run the package-specific tests first; a green preexisting suite without the scenarios below is not package acceptance. Judged runner currently remains guarded/unavailable until configured. Do not report it passed from an empty run.

## End-to-end scenarios (FR-SI-01/05, C-01/C-02)

1. Import DOCX/PPTX containing known text, tables, speaker notes and described visuals; import linked Docs/Slides using a delegated test user. Inspect all expected canonical passages and page_span anchors. Revoke delegation and confirm re-sync denies, no privileged fallback. Exercise provider export-limit and failed long-running export without truncation or product-quota mislabeling.
2. Import permitted article, HTML→PDF redirect, paywall, empty article and JS-only shell. Article has canonical URL and stable DOM anchors; latter failures have the required message. Private/metadata/loopback, IPv4-mapped IPv6, redirect/rebinding cases cannot reach forbidden destinations. Quarantined content never enters C-02. Model Armor timeout fails closed.
3. Upload 10-minute Interview.mp3 and a video with accessible captions/audio. Every chunk has a valid time interval. Ask a grounded question yielding the 04:15 citation; Inspector highlights matching passage and seeks to 255000ms. Video with no accessible transcript/audio shows exact required failure. Deselect and revoke fixtures to test history and player authorization.
4. Change roadmap May→June then Re-sync. During refresh May remains Ready; after commit new request answers June. Repeat with upstream 503, oversized extraction, embedding error and worker crash; prior complete June revision/slot survives. Send manual and webhook overlap while active: both distinct requests return Sync already in progress, no follow-up. Redeliver one transport operation: no duplicate revision or chunks.
5. Capture a generation snapshot, commit sync/delete/revoke before publication, assert no output or substitution. Old citation is Source updated with no exact jump; deleted citation is Source deleted and unclickable. Deletion invalidates content/caches/history/exports/media on next read without waiting for cleanup. Source Guide regenerates against exact new revision via C-02.
6. Test title lengths 0/1/200/201 Unicode code points after trim, and independent bytes 199999999/200000000/200000001 and words 499999/500000/500001. Assert reject, never truncate; concurrent quota exhaustion cannot over-admit; failed import releases once and failed sync preserves slot.

## Timing and release evidence (FR-SI-01, NFR-EVAL-01..04)

Use a versioned 30-minute fixture and declare codec, language, hash, size, environment, queue/concurrency, sample count and provider configuration before testing. Run at least 20 independent repetitions as an initial benchmark, retain every measurement/failure and compute nearest-rank P95 (sorted sample ceil(0.95*N)); expand samples for release confidence. Start at accepted-for-transcription event after upload, stop when complete timestamped transcript is available; include queue/preprocessing/provider/assembly and exclude subsequent indexing. Failed runs are reported separately and cannot be removed to manufacture a pass. Target ≤45s remains unchanged; record cold/warm context, no warm-only exemption for this audio target.

Gate v3.0 #1 requires the integrated timestamp click scenario. Full v3 also requires other package gates. Deterministic citation validity must equal 1.0 and leakage 0; release judged evidence requires hallucination <5%, out-of-source rejection ≥99% and semantic support checks. All live provider, browser-integrated v3 and performance results are UNAVAILABLE at this planning stage.
