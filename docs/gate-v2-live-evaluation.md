# Gate v2.0 record

> **Audience:** project stakeholders. **Date:** 2026-10-20. **Outcome:** Gate v2.0 **approved by owner override**.
> The live re-run after the fixes was **not executed**. Evidence so far: [006 validation](../specs/006-source-guide-chat-control/validation.md),
> [008 validation](../specs/008-studio-text-reports/validation.md).

## Decision

On 2026-10-20 the project owner approved Gate v2.0
([release gates](../spec/requirements/README.md#release-gates)) on their own authority, so a
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

## Open follow-ups

- Run `pnpm eval:judged` once on main and record the numbers (specs/006 T088, specs/008 T065).
- Dev sign-in uses Identity Platform email/password with open self-registration (no external IdP). Restrict
  sign-up (allowlist or admin-created accounts) before sharing the link beyond the stakeholder group.
