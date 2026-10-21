# R6 Qualification Record: Managed Default Sandbox

Date: 2026-10-20. Scope: FR-GC-08, NFR-SEC-01/02, Gate v3.0 #2, CC-07/08, D18.
Status: **Design complete; deployment qualification UNAVAILABLE.** This record distinguishes the selected architecture from evidence still required before implementation/runtime admission.

## Superseding owner decision (FR-GC-08, D18)

The owner first chose Option A to retain the former 1 vCPU / 512 MB caps and hold planning for feasibility evidence. The owner subsequently instructed: “Revise 3.2-P1 / FR-GC-08: accept the higher limits for default sandbox of 2 vCPU and 1.5 GB RAM”. D18 and the SRS amendment apply that later instruction. The managed default is now the primary path and the earlier CPU/RAM-related planning hold is superseded. The optional 4 vCPU / 4 GB profile is not approved.

One or two simultaneous users remains workload context. Zero inbound/outbound network, immutable scoped input, 64 MB temporary storage, 15.0-second per-attempt execution, retry rules and validated publication remain mandatory. Planning completion does not enable a cloud service or prove those controls.

## Selected design and documented support (FR-GC-08, R6)

The existing TypeScript API calls Agent Platform Code Execution through authenticated REST. OpenTofu owns one parent runtime resource with no deployed agent code. A fresh Python sandbox is created for every attempt, scoped input bytes are supplied without credentials or source URLs, output bytes are validated, and the child sandbox is destroyed. Parent runtime ownership remains separate from per-attempt cleanup.

[Google's quickstart](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/sandbox/code-execution-quickstart), retrieved with ketch.scrape on 2026-10-20, documents the selected default resources, parent creation without deployed agent code, file exchange, execution and deletion. The [overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/sandbox/code-execution-overview) describes no network and preinstalled numerical libraries. Those sources do not establish a configurable 64 MB scratch bound, read-only inputs or actual execution destruction at 15.0 s. No provider configuration parameters for those controls are invented in this plan.

R6 must qualify those retained controls before application implementation/runtime admission. The controller tracks execution deadline independently of model code and requests destruction, but request dispatch alone is not proof of timely termination. Provider TTL and client HTTP timeout are not substitutes. If qualification demonstrates an unsupported constraint, stop and return that concrete failure for an explicit decision; do not silently fall back, publish output, or widen a limit.

## Historical local investigation (FR-GC-08, CC-02)

Before the superseding decision, disposable Docker probes investigated an outer container for the former strict-cap fallback. They were Linux arm64 on Docker Engine 29.8.2, using existing everlast-lm:v1-local with no host mounts, credentials, network interface beyond loopback or published ports. Containers were removed. No cloud deployment, API enablement, image pull or production code was performed.

| Probe | Observation | Limit |
| --- | --- | --- |
| Former memory/CPU configuration | memory.max=512000000; cpu.max=100000 100000 | Configuration only; not enforcement proof or the current profile |
| Read-only root | EROFS on write | Local filesystem only |
| Former 64 MB tmpfs | ENOSPC after 64 whole 1,000,000-byte writes | No finer boundary or provider test; page rounding not excluded |
| Network inventory | Only lo | No packet capture or comprehensive socket test |
| Memory allocation | docker wait did not finish within 20 s; probe forcibly removed | Inconclusive, not passed; no OOM-kill evidence |

These probes do not qualify Agent Platform. No Python numerical stack, managed isolation, latency or 15-second kill gate was passed. They are historical evidence, not required work for the selected managed path. The repository's current Cloud Run API/worker configuration is not reused as an untrusted execution sandbox.

## Required R6 admission evidence (FR-GC-08, NFR-SEC-01/02)

| Control | Required evidence / fail condition |
| --- | --- |
| Resource profile | Returned configuration matches the documented default 2 vCPU / 1.5 GB; record effective memory bytes/runtime versions, reject unexpected or 4 vCPU profile |
| No network | Attempts covering public/private/metadata/DNS/inbound paths, zero successful connections and zero escaping packets in selected-runtime observations |
| Input/scratch boundary | Input overwrite and filesystem escape tests fail; all execution scratch is bounded to 64 MB, including alternative writable locations; no credentials injected |
| Wall clock | Infinite loop is actually stopped by 15.0 s; record provider-side process termination/destruction, not only a timed-out client; cancellation/OOM also destroy the child |
| Packages/correctness | math, statistics, numpy, pandas, matplotlib, scipy available; exact fixture outputs/charts and required retry semantics |
| Fresh state and cleanup | No cross-user/attempt files or memory; idempotent deletion, crash/orphan cleanup, no late results after generation-epoch invalidation |
| Region/security | Intended europe-west4 endpoint, approved service identity and enterprise no-training terms; no undeclared region fallback |
| Performance | Cold/warm boot+execution ≤4.0 s P95 and submission-to-real-running-code ≤2.5 s under declared one/two-user load, separate from NFR-PERF-01 answer TTFT |

R6 requires a project-owner-authorized EU test deployment and relevant deployment permissions, approved IaC/resources and API enablement approval if new services are needed. Those actions are outside this planning execution and have not occurred. Pyodide remains the recorded architecture fallback candidate only if managed qualification fails and an equivalently conforming design is established. No new product question remains for this plan; runtime results may later require flow-back and an explicit decision.

## Main refresh boundary (2026-10-21; FR-GC-08, NFR-EVAL-01..04)

Latest main includes a runnable local/cloud application path, persistent chat and enterprise ADK model integration. It adds no managed sandbox adapter or R6 admission evidence. Historical provider references above remain dated 2026-10-20 research, not a fresh deployment observation. D18 retains the approved 2 vCPU/1.5 GB default; main's D16/DEV-04 v2 PoC and D17/DEV-05 warm-service chat exception do not relax sandbox isolation, lifecycle, durability or its timing limits. New admission/cleanup state must survive API restart and reconcile unknown execution without replay. All R6 rows above remain UNAVAILABLE until the selected runtime is empirically qualified.
