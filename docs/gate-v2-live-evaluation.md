# Gate v2.0 record

> **Audience:** project stakeholders. **Date:** 2026-10-20. **Outcome:** Gate v2.0 **approved by owner override**.
> Live re-run on 2026-10-22: Gate #3 passes; Gate #1 and `FR-GC-07` Shorter still fail (see below). Evidence: [006 validation](../specs/006-source-guide-chat-control/validation.md),
> [008 validation](../specs/008-studio-text-reports/validation.md).

## Decision

On 2026-10-20 the project owner approved Gate v2.0
([SRS §5.4](../spec/System_Requirements_Specification_Gemeni_Notebook.md)) on their own authority, so a
running proof of concept can be deployed to the dev environment for stakeholders. Known bugs and missing
features are accepted for this deployment. Staging and prod are out of scope until the next version.

## What was measured

First live run on Vertex AI (`europe-west4`, main `17217e5`, before the fixes):

| Check | Requirement | Result |
| :-- | :-- | :-- |
| Judged `NFR-EVAL-01..04` (50-case sample) | thresholds unchanged from v1.0 | **pass** (hallucination 0/22, citation precision 22/22, rejection 25/25, leakage 0) |
| Gate v2.0 #1: Source Guide in < 10 s P95 from `Ready` | 100 % GuideReady, P95 < 10 s | **fail**: 14/20 GuideReady (P95 2.8 s) |
| Gate v2.0 #3: Studio reports | all valid, P95 ≤ 25 s | **fail**: 3/4 valid, P95 28.4 s |
| `FR-GC-07` response length | Shorter ≤ 50 %, Longer ≥ 150 % of Default | **fail**: lengths identical |

Fixes merged afterwards: #134 (report latency, gate fixture) and #135 (Source Guide validation, response
length). Their deterministic suites pass; the live re-run was blocked by expired local credentials and then
superseded by this override.

## Live re-run, 2026-10-22

`pnpm eval:judged --concurrency 1` on main `51f78ab` (Vertex AI `europe-west4`, keyless ADC). NFR-SEC-01 preflight passes.

| Check | Requirement | Result |
| :-- | :-- | :-- |
| Judged `NFR-EVAL-01..04` (50-case sample) | thresholds unchanged from v1.0 | citation precision 18/18, hallucination 0/18, leakage 0; **rejection 24/25 fail** (NEG-060 errored, likely a 429) |
| Gate v2.0 #1: Source Guide | 100 % GuideReady, P95 < 10 s | **fail**: 18/20 GuideReady (P95 3.4 s); two German guides over the word or topic-length limit |
| Gate v2.0 #3: Studio reports | all valid, P95 ≤ 25 s | **pass**: 4/4 valid, P95 17.7 s |
| `FR-GC-07` response length | Shorter ≤ 50 %, Longer ≥ 150 % of Default | **fail**: Shorter 100 %, Longer 234 % |

Details: [006 validation](../specs/006-source-guide-chat-control/validation.md#live-re-run-2026-10-22-t088).
The override stands. Issue #85 is closed on this record.

## Open follow-ups

- `FR-GC-07` Shorter has no effect: Default answers are already 15–25 words. Also, 6 of 14 synthesis cases refuse at Default.
- Gate v2.0 #1: German Source Guides still exceed the 250-word summary and 40-character topic limits.
- Eval harness: one Vertex 429 in the `FR-GC-07` phase aborts the whole run (no retry). Run with `--concurrency 1` until fixed.
- Dev sign-in uses Identity Platform email/password with open self-registration (no external IdP). Restrict
  sign-up (allowlist or admin-created accounts) before sharing the link beyond the stakeholder group.
