# Gate v3 candidate review — 2026-11-12

Traceability: Gate v3.0 #1–3, CC-06/07/08/09, C-01/C-02/C-03,
FR-SI-01/05, FR-GC-08, FR-ST-08/09/18, NFR-PERF-01, NFR-EVAL-01..04,
D17, D19, D21 and D23. [Acceptance criteria](../spec/System_Requirements_Specification_Gemeni_Notebook.md)
and [previous evidence](gate-v3-live-evaluation.md).

**Release decision: GatePending.** The candidate is for review and local
verification. Gate v3 and the V4 implementation hold remain open until the
required live observations qualify against the same immutable candidate.

## Candidate and review boundary

The combined feature branch builds on the prepared fan-out baseline
`e1c7b1a` and the exact reviewed 001/003–010 deltas. The prerequisite branch
at `eb0390e` includes the producer routes, serialized wiring, exact D21
removals and judged preflight integration. The stacked PR shows 011 and 012 on that base.
The comparison to `main` at `1e5c361` identifies two inherited wildcard-export
exception expansions in the API and worker manifests. They must be resolved
in the prerequisite lineage before proposing a merge to `main`.

## Gate criteria and retained evidence

| Criterion | Local evidence | Live disposition |
| --- | --- | --- |
| **#1 — Audio/video ingestion and timestamp navigation** (C-01, FR-SI-01/05) | Audio/video adapter and browser journeys include 04:15 navigation, real local seek, and failed resync preserving the previous published revision. The benchmark validates duration, size and hash offline. [009 qualification](../specs/009-multimodal-ingestion-sync/evidence/fanout-20261111/qualification.md) | **UNAVAILABLE.** Requires the approved speech fixtures and target, Drive/Picker and screening/render configuration where applicable, 20 declared 30-minute audio attempts, queue-inclusive P95 ≤45 s and actual timestamp evidence. Keep 009 T049/T050 open. |
| **#2 — Network-isolated Python, exact results and plots** (FR-GC-08, D19) | Controller, authorization, lifecycle and collector regressions exercise local/fake ports. The collector retains failures and frozen denominators. [010 evidence](../specs/010-code-execution-sandbox/implementation-evidence.md) | **UNAVAILABLE.** Requires immutable managed runtime identity, two disposable Owner scopes, verified clock/qualification, four cold/warm single/paired cohorts of ≥20 attempts, isolation adversaries, exact results/plots, cleanup and full attempt retention. Keep 010 T052/T064 open. |
| **#3 — Mindmap and CSV/XLSX** (C-03, FR-ST-08/09/18) | Deterministic structure, citation and export validation and the 011 adapter/fixture coverage. [011 acceptance workflow](../specs/011-studio-mindmaps-data-tables/quickstart.md) | **UNAVAILABLE** for production generation and release viewer acceptance. The historical viewer runs recorded 16.734 ms and the fresh fixed-population diagnostic recorded 16.800 ms against the unchanged ≤16 ms threshold. Retain all frame observations and ≥20 predeclared generation attempts with failures retained. |
| **#3 — Million-token context and warm chat P95 ≤2.5 s** (NFR-PERF-01, D17) | Local lifecycle and benchmark regressions exercise D23 cache configuration, candidate/boot binding, clock continuity and scope. [012 clock handoff](../specs/012-long-context-latency-scaling/fanout-handoff-20261112.md) | **UNAVAILABLE.** Requires qualified real tokenizer, cache and runtime, actual million-token original-ledger fixture and 20 eligible warm submissions (nearest-rank 19th, max 40 total attempts), separate wake-up observations, and an authorized clock interval sufficient for the whole campaign. |
| **Shared quality and prior-gate regressions** (NFR-EVAL-01..04) | Local deterministic corpus, 60 adversarial cases, and Guide/Studio regression tests. The judge uses the D23 route and the preflight checks that Gemini and embedding endpoints are distinct and approved. | **UNAVAILABLE** for the common judged run. Requires the reviewed deployed candidate and unchanged fixed 50-case sample. The historical live report result remains 3/4 with provider 504s. [Judged workload](../specs/004-ui-skeleton-quality-gates/pre-v4-handoff.md) |

## Deployment and workload prerequisites

Prepare a reviewed candidate SHA and API/worker image digests, an additive
schema migration rehearsal, the saved infrastructure plan and rollback
procedure, and an approved target revision. Freeze the exact fixture hashes,
Owner scopes, provider routes, quotas, spend bounds, and private evidence
destination. The clock bridge requires the target secret and IAM and a
prospectively reviewed duration/renewal protocol. Gate campaigns retain
failure and unavailable records under the declared populations and thresholds.
The draft PR records exact-head local checks. No cloud deployment, managed
cohort, or paid judged workload is part of this candidate verification.
