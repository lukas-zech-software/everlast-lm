# Proposed Gemini model and processing-region decision

Status: **PROPOSED — owner decision required; no region or model policy changed**.
Date:2026-11-11. Traceability: Constitution VI/CC-07/CC-08, D3, NFR-SEC-01,
NFR-PERF-01, NFR-EVAL-01..04, Gate v3.0.

## Concrete decision requested

Permit Google Cloud enterprise Gemini inference, token counting and context caching
to use the **EU multi-region `eu`** for supported replacement Gemini models.
Continue to require contractual no-training enterprise endpoints. Keep Cloud Run,
Cloud SQL, object storage, embeddings, ingestion services and managed code execution
in their already-approved per-feature locations, including `europe-west4`.
Do not add a global or Gemini Developer API fallback.

Candidate role mapping for local migration and later qualification:

| Existing role | Candidate | Initial thinking configuration |
| --- | --- | --- |
| Flash: grounded chat and Studio generation | `gemini-3.8-flash` | `LOW`; `MINIMAL` is unsupported |
| Flash-Lite: Source Guides, suggestions and judges | `gemini-3.5-flash-lite` | `MINIMAL` |

These candidates are not accepted quality/latency results. Select the smallest
approved tier that passes the original package targets; keep exact failure
denominators, rejection/faithfulness thresholds and warm/cold timing boundaries.
Probe output budgets and SDK thinking parameters need compatibility tests; do not
carry retired-model assumptions into the new profile.

## Why this decision is necessary

The repository still defaults to Gemini2.5Flash/Flash-Lite. Google's current
[lifecycle table](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions)
and [2.5Flash card](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash)
list retirement on2026-10-20, before this proposal date. No project inference was
called to test an entitlement exception; historical successful runs stay historical.

The examined replacement cards list EU multi-region availability but do not list
`europe-west4`:

- [Gemini3.8Flash](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-flash):
  EU multi-region supported; context limit1,048,576; LOW/MEDIUM/HIGH thinking,
  with MINIMAL explicitly rejected.
- [Gemini3.5Flash-Lite](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-5-flash-lite):
  EU multi-region supported; context limit1,048,576; MINIMAL supported.

This establishes a mismatch for these candidates, not proof that every other
current model or a contractual provider exception is unavailable in the Netherlands.
Those alternatives remain unverified.

Constitution VI states: **“Every exception MUST be documented in a per-feature
region map and approved via a recorded decision.”** Its EU/defaultregion rule
takes priority over D3's older broad global-fallback wording. The existing exception
process can record this limited decision; no blanket constitutional weakening or
automatic global routing is proposed. Allocate the next canonical D-number only
after the active bridge agent finishes, avoiding another provisional-number collision.

## Implementation after an affirmative decision

1. Serialize the decision and affected SRS/FR region maps after current012bridge
   flow-back. Record explicit Gemini `eu` processing as an approved exception.
2. Separate Gemini processing configuration from embedding and infrastructure
   locations; reject unsupported/undeclared model-region combinations. Preserve
   enterprise/keyless authentication and no silent fallback.
3. Add compatibility/region/privacy tests before changes, then migrate each owning
   package in a separate sequential branch. Shared configuration is coordinated
   first; chat, Guides, reports, structure and evaluation consumers retain their
   own feature scope and regression evidence.
4. Verify explicit caching against Google's
   [cache limits](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview):
   model-dependent token minimums,10MB blob/text limit and minimum1minute TTL.
   Approve explicit diagnostic cache fixtures when primary fixtures are too small;
   preserve all originals and refuse unsupported envelopes.
5. Freeze new model/tokenizer versions, fixtures, configuration and immutable image
   identities. Old2.5live results do not qualify the new model. Run the single common
   fixed stratified50-case judged campaign only on that final approved candidate,
   with all IDs/categories/hash/errors/numerators/denominators retained.

An affirmative answer authorizes the recorded region exception and local migration
work. Actual cloud changes, resource/IAM configuration, paid probes and benchmark
campaigns still require a concrete reviewed execution plan. Existing main merges
also retain their separate explicit approval requirement.

## If the owner retains strict `europe-west4` model processing

Keep current residency enforcement. Continue local bridge, refusal coverage and
architecture work; do not deploy the examined replacement models there or redirect
globally. Locate a currently supported regional alternative or obtain verifiable
provider entitlement evidence, then propose its exact compatibility plan. Live
provider acceptance remains unavailable until that requirement is resolved.

## Review evidence

Primary pages above were retrieved with Ketch on2026-11-11 using bounded scrapes;
no provider inference, cache creation or cloud mutation occurred. Earlier search
snippets mentioned a different retirement date; the matching lifecycle/card date
above is authoritative for this proposal. No full third-party page is copied here.
Governance proposal only: no application, deployment, constitution, SRS, authority
decision or feature pin was changed by this document.
