# Pre-V4 continuation handoff — 2026-11-11

Traceability: CC-01..CC-09, Gate v3.0, NFR-PERF-01, NFR-EVAL-01..04.
**Implementation checkpoint only. Release acceptance remains pending; V4 must not start.**

## Resume safely

Coordinator worktree `/private/tmp/everlast-pre-v4-resume-20261111`, branch
`codex/pre-v4-resume-20261111`. Integrated implementation tip
`1edd46c089b28d863f4c9b2666801063ccf28946`; this handoff commit follows it.
Fresh main fetched over HTTPS: `3f4d7fdcf25f3e535c51f1696c5aa880a0f85e86` (PR188).
Create a NEW worktree from the final coordinator branch tip as the first repository
action. Do not run tasks in root/main. Read AGENTS, Constitution IV/VI/CC-09,
`docs/agent-architecture-guardrails.md`, requirements README and owning card.
Pin the owning feature immediately after worktree creation; unset temporary
SPECIFY_FEATURE_DIRECTORY. Refresh older feature plan/tasks and analyze first.
Use one package agent at a time, sequentially, reusing logical package agents.
No active agent remains at cutoff. Parent handles governance/integration only.

User cutoff: stop NEW implementation/tests/checks at five-hour remaining <=10%
OR weekly remaining <=2%. Parent observed9%/86%; agent final8%/86%. All reported
checks completed before cutoff; only safe integration/commit/handoff afterward.
No reset credits. This is cutoff audit1 of this explicit reactivation, not the old
blocked run. Goal is incomplete. Do not mark complete or infer release acceptance.

## Completed this run

- 012 bridge code `2a4c8caef1e55e993e3c7a03100707f3f25cd2f7`, handoff tip
  `663f483b40d329fe7d039b3918ece3ed9c3823e6`, already integrated.
  See `specs/012-long-context-latency-scaling/bridge-handoff-20261111.md`.
  Canonical private generation-pinned GCS/local challenge/approval/outcome/export,
  independent Ed25519 trust root, actual server composition/operator CLI,
  bounded transport and absolute trusted deployment window, default-off bounded
  CloudRun CPU/allocation validation configuration. No apply/deployment performed.
  Native cache rejects >10MB before count/create; original sources retained.
  Client epoch calibration semantics corrected. Local37 core/readiness tests,
  full13 PG/server and final2 targeted server tests PASS (overlap), types/lint,
  architecture39fixtures/graph0/artifacts0, citation160/160 leakage0,
  60invalid/0published and dev/staging/prod IaC validation PASS.
- 012 clock PARTIAL code `9f2ba939429f8a35370d537f827159f3fd1facb2`, final tip
  `1edd46c089b28d863f4c9b2666801063ccf28946` integrated.
  See `specs/012-long-context-latency-scaling/clock-handoff-20261111.md` and
  retained Red/Green/lint evidence. Strict receipt/exchange contracts plus pure
  conservative four-timestamp interval derivation; positive/negative offsets,
  identity/nonce/generation/hash, monotonic steps and impossible uncertainty tested.
  22/22 PASS; lint/types/spec,39 architecture fixtures, graph/artifacts0 PASS.
  This helper authenticates/installs/qualifies NOTHING. T073/T074 unchecked.
- One real cloud wildcard boundary remediated:185→184 exceptions (97T035/87T036).
  No exception widened. Remaining architecture debt still requires owning-package
  remediation coordinated by004; guardrails are not a blanket waiver.
- Read-only roadmap audit:48open issues,17pre-V4 excluding roadmap1.
  `docs/pre-v4-roadmap-audit-20261111.json`; sync dry-run0updates/0closures.
  Roadmap1 displayed authority versions stale; reconcile only with acceptance.

## Approved Gemini policy and pending PR

Owner explicitly replied “Approve Gemini EU exception” on2026-11-11.
D23 is canonical; D22 remains signup. Local authority flowback `36185dd`, plus
native-cache architectural clarification `3cbe7ac`. Read
`docs/pre-v4-model-region-proposal-20261111.md` and
`docs/gemini-model-region-map.md`. Constitution VI exception process used;
Constitution text/version unchanged. Enterprise Gemini inference/token counting/
cache may use EU multi-region `eu`; all other approved infrastructure/embedding/
managed runtime locations remain unchanged. No global/Developer API fallback.
Approval does NOT authorize cloud/paid execution or a main merge.

Four-file governance-only PR189 MERGED under separate explicit user approval:
https://github.com/lukas-zech-software/everlast-lm/pull/189
Exact approved head `30f0be27f0946db3b6c154852bcc2cc6ebfac262` and successful CI/spec
were revalidated immediately before expected-head squash merge. GitHub subsequently
confirmed merged=true, merge SHA `1e5c361f7c85ad59fedc8ee2ffff33ad7269823b`.
No runtime migration, paid/cloud execution or release acceptance is implied.
PR174,188 and189 now each have separate user merge approval. No combined coordinator
PR should be published. HTTPS per-command gh helper works; SSH publickey fails.

Latest handoff-only continuation branch `codex/pre-v4-pr189-checkpoint-20261111`,
worktree `/private/tmp/everlast-pre-v4-pr189-checkpoint-20261111`, created FIRST from
`0f09c4d18f391d3f9c16e703e298e26aad585178`. Resume from this latest branch tip.
Feature pin unchanged: governance checkpoint only. No new implementation/tests/checks
started; usage cutoff and all remaining work below still apply. Goal remains blocked
on usage capacity; this explicit merge approval does not restart implementation.
CC-09: checkpoint documentation/metadata only, no runtime boundary or behavior change.

Official Google lifecycle/cards list2.5Flash and2.5Flash-Lite retirement2026-10-20.
Examined replacement3.8Flash and3.5Flash-Lite support `eu`, not europe-west4.
Runtime defaults are STILL retired2.5; no model migration/provider entitlement
proof yet. Separate Gemini config from embedding/infrastructure region first.
Migrate owning packages sequentially:3.8Flash LOW (MINIMAL unsupported),
3.5Flash-Lite MINIMAL; no blind legacy thinkingBudget0 replacement.
Review APIchat/cache, workerstructured/emoji/reports, evalCLI/judge/source-guide.
Retain historical2.5 evidence as historical. Freeze final model/tokenizer/fixtures/
images/config before the common judged50-case campaign. Primary sources and exact
scope are linked in proposal. Use ketch.scrape for web→Markdown extraction.

## Next implementation, in order after usage permits

1. Resume SAME logical012 agent in NEW worktree from this coordinator tip,
   feature `specs/012-long-context-latency-scaling`. Implement T073/T074 actual
   clock-only private authenticated exchange and atomic same-boot installation.
   Current bridge circularly needs preexisting retained calibration. Independent
   trust root, actual t1/t4 client and t2/t3 server captures with monotonic bounds,
   generation/hash/nonce/boot/revision/candidate binding, expiry/replay/late-effect
   fences and retained receipt required. No HTTP Date/zero-offset/owner-flag proof.
   Wire actual API+CLI local storage/SDK/server roundtrip; no public debug endpoint.
   Clock-only exchange must invoke no model/cache/sandbox or claim readiness.
   Actual scoped canonical warmup and dependency probes still required afterward.
   See clock handoff for detailed missing code/test plan.
2. Sequential shared-model configuration/owning-package migrations under D23,
   003 skipped GC-E04 refusal,011 numeric fidelity and004 architecture coordination.
   Issue153 current export leaves ordinary1.20/-12.40 as text. Add spec-derived
   failing numeric XLSX/numFmt and raw-decimal CSV tests, retain identifier/leading
   zero/precision/formula/citation protections. Do not close153 prematurely.
3. Resolve existing acceptance failures without changing thresholds/denominators:
   008 report504/75% validity;011 viewer original16.734000000000037ms and corrected
   16.733999999999924ms P95 both FAIL16ms. No rounding/CPU metric substitution.
   Live generation>=20/P95<=20s,010 fourcohorts>=20/security,012 fullcontext/
   latency,006 judged,001 identity/storage/signup and009 audio/timestamp pending.
4. Prepare exact immutable target images/schema/model/config/tokenizer, saved IaC
   plans, approved disposable fixtures, bounded probes/cohorts/budgets and rollback;
   ask concrete cloud/paid execution approval only after preparation. Refresh actual
   cloud metadata first; Nov10 snapshot is stale. No general apply/deploy/paid
   authorization exists. Four API registrations alone were approved previously.
5. Run qualified actual gates/common fixed50 judged only on final compatible
   candidate; preserve every failure/skip/UNAVAILABLE. Publish separate scoped
   green package PRs, get main-merge approvals, reconcile roadmap by acceptance.

## Persistent operational boundaries

No new cloud resource/apply/deploy/API/paid/audio/sandbox effects this run.
Last historical cloud: API00013-kzh/worker00009-5m2 image51f78ab; SQLPG16 STOPPED,
activationNEVER. Do not assume current. Existing EU DocumentAI processor should
not be duplicated just for missing environment configuration.

Keep sandbox creation timestamp BEFORE runtime.create (RPC/queue/boot included),
completion immediately after execute settles before cleanup, real controller
running_code_at separate from client monotonic receipt. Read canonical trace from
terminal DB AFTER publish/abandon, not provisional trace. Missing/failed/active
terminal read withholds proof. Preserve C-02/auth/quotas/publication/cleanup fences,
all006–012 fixes,signupD22/migration0012 and existing owner scope restrictions.

`docs/pre-v4-implementation-candidate.json` is the machine-readable checkpoint.
Earlier details/evidence remain in Nov10c tracked handoff and package handoffs;
private temp copies can disappear, so Git refs and tracked files are authoritative.
No issue/gate closed from local tests or merged PR alone. Gate v3 is pending.
