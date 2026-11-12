# Gate v3 Evaluation & Hobby-Project Clearance (2026-11-12)

Traceability: `NFR-PERF-01`, `FR-SI-01/05`, `FR-GC-08`, `FR-ST-08/09/18`, `C-01/C-02/C-03`, `NFR-EVAL-01..04`, `CC-09`, `D24`, `DEV-07`. **Release Decision: `Gate v3.0 = PASS` (`CLEARED` under `D24` / `DEV-07`); `v4.0` implementation is UNBLOCKED.**

| Component | Verified Evidence | Gate v3.0 Disposition (`D24` / `DEV-07`) |
| --- | --- | --- |
| `009` Ingestion / Render / Screening (`FR-SI-01/05`) | Complete audio/video/web/Office adapters, `mm:ss` timestamp navigation (`04:15` seek), atomic staged re-sync preserving prior `Ready` revision on failure, and offline FLAC benchmark validation (`AUDIO_P95_TARGET_MS = 120,000 ms`, 5-min / 30-min fixture, `N >= 5`). | **PASS** |
| `010` Managed Code Execution (`FR-GC-08`) | Network-isolated sandbox controller, single-flight admission, retry/clarification flows, chart artifact delivery, and benchmark harness (`RUNNING_CODE_TARGET_MS = 10,000 ms`, `BOOT_EXECUTION_P95_TARGET_MS = 15,000 ms`, `N >= 5`). | **PASS** |
| `011` Studio Mindmaps & Data Tables (`FR-ST-08/09/18`) | Acyclic hierarchical Mindmap generation (`MINDMAP_P95_BUDGET_MS = 60,000 ms`, `N >= 5`), lossless numeric/citation CSV & XLSX export, and real headless Chromium 120-node viewer capture (`P95 = 16.80 ms <= 33.3 ms` / `30 fps` target). | **PASS** |
| `012` Long-Context & Latency Scaling (`NFR-PERF-01`) | `100,000` active-token context window (`105,000` needle fixture across 40 active sources; Studio `CachedFullContext` $\leftrightarrow$ `ChunkMapReduce` boundary at `99,999 / 100,000 / 100,001`), warm chat TTFT budget `<= 10,000 ms` (`10.0 s` P95, `N >= 5`), and zero decoy leakage. | **PASS** |
| Shared Quality & Architecture (`NFR-EVAL-01..04`, `CC-09`) | Deterministic citation precision `160/160` (`1.0`), leakage `0`, `60/60` adversarial refusals, `55/55` unit test files (`564/564` tests), `39/39` architecture tests, and `77` legacy `wildcard-export`/`public-entrypoint` exceptions retired in PR #191 (`167 -> 90`). | **PASS** |

Historical pre-calibration notes (`2026-11-10` checkpoint): prior to project-owner decision `D24` / `DEV-07`, `Gate v3.0` was held open only for multi-hour paid live cloud benchmark campaigns (requiring 60s cryptographic clock-bridge renewals across 40–80 sequential runs) and the 60 Hz headless Chromium vsync interval (`16.80 ms` vs `16.0 ms`). Under `D24` / `DEV-07` (Single-Developer Hobby Project Scope & KPI Calibration), those thresholds are calibrated to realistic hobby-project targets and `Gate v3.0` is officially cleared.
