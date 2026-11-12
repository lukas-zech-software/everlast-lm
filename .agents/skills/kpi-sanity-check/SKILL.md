---
name: kpi-sanity-check
description: Run a generic hobby-tier KPI and proportionality sanity check across all currently implemented metrics, budgets, cohorts, and specs (D24 / DEV-07). Use during /speckit-plan, /speckit-implement, /speckit-converge, or before adding any new NFR/latency/performance/eval threshold.
---

# KPI Sanity Check (`D24` / `DEV-07`)

Everlast LM is a **single-developer private hobby experiment project** (Constitution `Platform Constraints` & `CC-08`). Before locking any performance budget, latency target, cohort size, token scale, or LLM-judge threshold into code, tests, or specs—including for unknown future features in `v4`–`v6`—run this sanity check.

## Automated Scan

Run the generic repository scanner:

```bash
pnpm check:kpi-sanity
```

To also scan upcoming `v4`–`v6` FR cards and feature specs for uncalibrated enterprise-SLA traps:

```bash
node scripts/check-kpi-sanity.mjs --include-specs
```

## Universal Proportionality Invariants (Feature-Agnostic)

Every newly proposed or existing metric must pass these six invariants:

1. **Display VSync Physics (`VSYNC_TRAP`)**: Never set a `requestAnimationFrame` / browser frame-interval budget `< 16.7 ms` (e.g. `<= 16 ms` for `60 fps`). On `60 Hz` displays, VSync fires at `16.67 ms`. Use `<= 33.3 ms` (`30 fps`) or measure synchronous JS commit time.
2. **Buffered vs. Streaming Latency (`BUFFERED_LATENCY_TRAP`, `D13`)**: When an answer or media payload is buffered for citation/schema validation before emission, do not set end-to-end `P95` targets `< 5,000 ms` (`5 s`). Use `>= 10,000 ms` (`10 s`) for chat and `>= 30,000–60,000 ms` for async Studio/media pipelines.
3. **Cohort Wall-Clock Budget (`COHORT_WALLCLOCK_TRAP`)**: External LLM, ASR, or cloud-sandbox benchmark cohorts must use `N <= 10` repetitions (`N = 5` recommended) so verification stays fast and affordable.
4. **Context & Fixture Scale (`MEGA_CONTEXT_TRAP`)**: Do not require `>= 500,000` active tokens in standard test/gate fixtures unless explicitly justified; `D24` calibrates long-context validation to `100,000` active tokens (`105,000` needle fixture).
5. **Probabilistic Judge Robustness (`FRAGILE_JUDGE_TRAP`)**: Keep deterministic invariants strict (`NFR-EVAL-02 = 1.0`, `NFR-EVAL-04 = 0`), but keep probabilistic LLM-as-a-judge thresholds resilient to single-case jitter (`hallucination < 0.10`, `rejection >= 0.90`).
6. **Anti-Ceremony Escalation (`CEREMONY_CREEP`)**: If measuring an NFR requires >400 lines of custom cryptographic bridges, multi-hour paid cloud runs, or always-on infrastructure (`min_instances >= 1` / PTU), **stop and propose a `DEV-xx` / `Dn` recalibration** instead of building measurement ceremony.
