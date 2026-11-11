# Approved Gemini processing-region map

Decision: D23, recorded in the [binding architecture](solution-architecture.md)
and SRS under the existing Constitution VI exception process. Owner approval:2026-11-11,
“Approve Gemini EU exception”; see the [approved proposal](pre-v4-model-region-proposal-20261111.md).
Traceability: Constitution VI/CC-07/CC-08, D3, NFR-SEC-01, NFR-PERF-01,
NFR-EVAL-01..04. This records permitted processing, not deployed acceptance.

## Exact approved exception

Enterprise Google Cloud Gemini inference, native token counting and explicit
context caches may use EU multi-region `eu`. Initial replacement candidates are
`gemini-3.8-flash` for Flash roles and `gemini-3.5-flash-lite` for Flash-Lite roles.
The enterprise no-training requirement, keyless authentication, explicit active
source snapshots, citations and zero leakage remain mandatory. No global or
Gemini Developer API fallback is authorized.

All other components retain their existing approved feature locations. In
particular Cloud Run, Cloud SQL, workspace storage, embeddings and managed code
execution remain in `europe-west4`; existing separately approved ingestion/OCR
locations are not changed by this decision. Gemini processing location must be
configured separately from embedding and infrastructure locations.

## Per-feature map

| Feature | Gemini processing allowed in `eu` | Components whose region is unchanged |
| --- | --- | --- |
|001workspace foundation|No new model workload|Identity, Cloud Run, SQL, storage and quotas|
|002text/PDF ingestion|No new Gemini workload; post-ingestion Guides follow006|Embeddings and existing approved DocumentAI/OCR location|
|003grounded chat|Flash chat and code-generation requests, native token counting|C-02 query embeddings, PostgreSQL, managed sandbox|
|004quality gates|Flash evaluated chat and Flash-Lite judges|Fixture storage, embeddings, OCR and CI runtime|
|005workspace/UI comfort|Flash-Lite topic emoji consumer|Workspace persistence and UI hosting|
|006context intelligence|Flash-Lite Guides/overviews/followups; shared chat follows003|Quota accounting, source storage and ready watcher|
|007notes|Shared003Note Assistant inference|Note-source persistence, normalization and embeddings|
|008text reports|Flash reports, Flash-Lite suggestions, associated native token counting/cache|Studio persistence, job placement and publication fences|
|009multimodal ingestion|Post-ingestion Guides follow006; no new ingestion model fallback|Speech, ModelArmor, render, upstream delegated connectors and source storage|
|010code execution|Shared003Flash code generation|Reasoning engine/sandbox, network isolation, file limits and cleanup|
|011maps/tables|Flash structured generation and associated token counting/cache|C-03 lifecycle, export serialization and browser hosting|
|012context/latency|Gemini inference/token counting/cache in the frozen approved profile|Embeddings, SQL, private evidence storage and serving/sandbox placement|
|013PostgreSQL migration|Shared model consumers follow their owning feature|PostgreSQL schema and persistent v2 state|

No v4–v6 implementation is started by this map. Future features still require
their own region map and prior release-gate acceptance.

## Required migration evidence

Keep the model and region explicit in configuration and reports. Reject undeclared
fallbacks; never redirect an unavailable regional model globally. Update each owning
feature's spec/plan/card and tests before its implementation. Serialize shared
configuration first, then package changes in dependency order. Historical2.5model
evidence remains historical; fresh model/tokenizer/profile qualification is required.

Use current model-specific thinking parameters:3.8Flash supports LOW/MEDIUM/HIGH
and rejects MINIMAL;3.5Flash-Lite supports MINIMAL. Adapter compatibility, context
envelopes, actual provider minima and original latency/quality limits must be
verified rather than assumed. Preserve identifiers/formatting, all source/revision
and authorization fences, errors, attempted-case populations and failed timings.

Run deterministic checks on affected changes and one common fixed stratified50-case
judged release campaign on the final compatible candidate. Local doubles, this map,
owner approval and a merged PR do not establish live provider or release acceptance.
Cloud changes, paid execution and shared-main merges retain separate authorization.

## Primary evidence

- [Lifecycle](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions):
  2.5Flash and2.5Flash-Lite retirement2026-10-20.
- [3.8Flash card](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-flash)
  and [3.5Flash-Lite card](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash-lite):
  the examined replacements list EU multi-region rather than europe-west4.
- [Caching](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview):
  published model-dependent minima,10MB blob/text cap and minimum1minute TTL.

Retrieved with bounded Ketch scrapes on2026-11-11. Project-specific entitlement,
actual deployed residency and measured quality/latency are not verified here.
