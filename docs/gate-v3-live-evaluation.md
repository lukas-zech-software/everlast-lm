# Gate v3 Evaluation & Hobby-Project Clearance (2026-11-12; finalized 2026-11-16)

Traceability: `NFR-PERF-01`, `FR-SI-01/05`, `FR-GC-08`, `FR-ST-08/09/18`, `C-01/C-02/C-03`, `NFR-EVAL-01..04`, `CC-09`, `Constitution v2.3.0`, `D1`–`D24`, `DEV-01`–`DEV-07`. **Release Decision: `Gate v3.0 = PASS` (`CLEARED` under `D24` / `DEV-07`, [PR #192](https://github.com/lukas-zech-software/everlast-lm/pull/192)); `v4.0` implementation is UNBLOCKED.**

| Component | Verified Evidence | Gate v3.0 Disposition (`D24` / `DEV-07`) |
| --- | --- | --- |
| `009` Ingestion / Render / Screening (`FR-SI-01/05`) | Complete audio/video/web/Office adapters, `mm:ss` timestamp navigation (`04:15` seek), atomic staged re-sync preserving prior `Ready` revision on failure, and offline FLAC benchmark validation (`AUDIO_P95_TARGET_MS = 120,000 ms`, 5-min / 30-min fixture, `N >= 5`). | **PASS** |
| `010` Managed Code Execution (`FR-GC-08`) | Network-isolated sandbox controller, single-flight admission, retry/clarification flows, chart artifact delivery, trusted private execution producer (`apps/api/src/chat/service.ts`), and benchmark harness (`RUNNING_CODE_TARGET_MS = 10,000 ms`, `BOOT_EXECUTION_P95_TARGET_MS = 15,000 ms`, `N >= 5`). | **PASS** |
| `011` Studio Mindmaps & Data Tables (`FR-ST-08/09/18`) | Acyclic hierarchical Mindmap generation (`MINDMAP_P95_BUDGET_MS = 60,000 ms`, `N >= 5`), lossless numeric/citation CSV & XLSX export (#153), real Studio adapter identities (`everlast-worker-mindmap-gemini-adapter/v1`, `everlast-worker-table-gemini-adapter/v1`), and headless Chromium 120-node viewer capture (`P95 = 16.80 ms <= 33.3 ms` / `30 fps` target). | **PASS** |
| `012` Long-Context & Latency Scaling (`NFR-PERF-01`) | `100,000` active-token context window (`105,000` needle fixture across 40 active sources; Studio `CachedFullContext` $\leftrightarrow$ `ChunkMapReduce` boundary at `99,999 / 100,000 / 100,001`), warm chat TTFT budget `<= 10,000 ms` (`10.0 s` P95, `N >= 5`), and zero decoy leakage. | **PASS** |
| Shared Quality & Architecture (`NFR-EVAL-01..04`, `CC-09`) | Deterministic citation precision `160/160` (`1.0`), leakage `0`, `60/60` adversarial refusals, `39/39` architecture tests, legacy exceptions reduced `167 -> 90` (PR #191) `-> 88` (`004` `T036` retired; only `T035` remains open), `005` `T061` `D23` Flash-Lite topic emoji routing completed, and `check-kpi-sanity --include-specs --strict` passes with `0` warnings. | **PASS** |

Historical pre-calibration notes (`2026-11-10` checkpoint): prior to project-owner decision `D24` / `DEV-07`, `Gate v3.0` was held open only for multi-hour paid live cloud benchmark campaigns (requiring 60s cryptographic clock-bridge renewals across 40–80 sequential runs) and the 60 Hz headless Chromium vsync interval (`16.80 ms` vs `16.0 ms`). Under `Constitution v2.3.0` and `D24` / `DEV-07` (`Single-Developer Hobby Project Scope & KPI Calibration`), those thresholds are calibrated to realistic hobby-project targets and `Gate v3.0` is officially cleared. Live paid cloud benchmark and LLM-judged runs (`pnpm eval:judged`) remain explicitly recorded **UNAVAILABLE** without deployed credentials.

## Dev Live-Cloud Smoke Suite (`pnpm test:cloud:dev`)

To verify live GCP integration (Vertex AI Gemini/Embeddings/Context Caching, Agent Engine Sandbox, Speech-to-Text V2, GCS signed URLs/cleanup, and Identity Platform) without disposable cloud infrastructure or multi-hour benchmark cohorts:

- Runs exclusively against the `dev` environment (`EVERLAST_ENV=dev`, never `staging` or `prod`).
- Inspects `everlast-dev-pg` (and `everlast-dev-api` with `--warmup-api`) via `ensureDevEnvironmentForTests`; if scaled down to zero, prompts for permission before starting it, and automatically scales it back down afterward unless it was already running beforehand.
- Isolates PostgreSQL test state via `createTestDatabase()` (`everlast_t_<uuid>` on the same SQL instance, dropped in `finally`) and GCS objects under `notebooks/<uuid>/` prefixes deleted in `afterAll`.
