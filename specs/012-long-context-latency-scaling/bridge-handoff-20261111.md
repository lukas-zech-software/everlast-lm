# Package 012 private bridge checkpoint — 2026-11-11

Traceability: NFR-PERF-01, FR-GC-08, C-02, NFR-SEC-01/02, NFR-EVAL-02/04, CC-01..CC-09. Local bridge implementation is saved; overall target operational qualification is still PARTIAL. This checkpoint deliberately precedes the separately analyzed clock-bootstrap CODE task.

## Exact continuation state

- Worktree `/private/tmp/everlast-pre-v4-012-bridge-20261111`; branch `codex/pre-v4-012-bridge-20261111`; base exact `d72411a` (integrated prior0138311/e664264 qualification work).
- Implementation/evidence commit **`2a4c8caef1e55e993e3c7a03100707f3f25cd2f7`**, verified clean before this handoff-only followup. Final branch tip includes this tracked handoff. Root/main was never edited; no child agent or other package was started.
- Feature pin `.specify/feature.json` points to `specs/012-long-context-latency-scaling`; temporary selection variable was unset immediately after second mandatory step.
- Current verified usage: **25% five-hour /88% weekly remaining**, no reset credits. Stop NEW implementation/tests/checks when five-hour<=10 OR weekly<=2; finish running work and save clean partial handoff. Earlier weekly10 records remain historical.
- Parent coordinates only governance/read-only release prep and will serialize approved D23 GeminiEU routing before resuming SAME012agent for T073/T074; do not merge arbitrary later parent documents into this branch. Latest current architecture decision here is **D22**; no new Dn allocated by bridge. Parent main HTTPS observation `3f4d7fd` unchanged; no GitHub/remote write.

## Implemented and tested

`packages/contracts/src/package-v3-4.ts` owns canonical operational approval, challenge, identity, generation/hash/policy, export/inbox/outcome and retained-clock schemas. `packages/cloud/src/private-benchmark.ts` owns bounded workflow/operator exchange behind object/file ports, with narrow GCS/local adapters and owner-private filesystem adapter. One explicit public `@everlast/cloud/private-benchmark` interface replaces the actual cloud wildcard; only its obsolete exact exception was removed: **185→184**, all remaining inventory unchanged. No new cross-app/test/type dependency, no production eval/testkit import, no reused worker implementation for bridge work.

`apps/api/src/observability/benchmark.ts` composes canonical file ports, independently pinned public root and existing qualification coordinator. `apps/api/src/server.ts` wires bootstrap from trusted deployment inputs into owned0700/tmp/0600files, real recorder/C-02/managed-lifecycle observation and private object channel. Startup failures/close clean private lifecycle. Default-disabled startup makes no bridge effects and remains unqualified. Missing/invalid bootstrap fails before effects. Only actual ordinary managed warmup through existing canonical controller/ledger/cleanup can supply sameboot runtime evidence; no second sandbox-create path. Signed authorization consumes ID before probes; actual bound observations qualify, never signature/config alone.

`scripts/private-benchmark.mjs` is actual Node26 operator CLI: discover, preflight, local signing, conditional approval delivery, atomic private download and bounded follow. Explicit identity/root/calibration files; no arbitrary offset flag, public route, generic logs, source/code/stdout/provider handles or credentials in exports. Actual local server→CLI delivery→canonical code measurement→CLI download passed, using local provider/storage doubles and disposablePG. Native operational cache contents above **10000000serialized bytes** reject before count/create; no truncation. A4MB declared-milliontoken local fixture fits byte cap but actual qualified token/minimum/capacity proof is still required.

Key bounds: absolute separately trusted deployment expiry<=1hour survives restarts; ticks<=3600, logical object operations<=20000, writes<=1024, upload<=128MB/read<=256MB, object<=8MB, single-attempt object deadline<=5s clipped to expiry. Put=save+metadata=2GCSRPCs, conservative physical ceiling40000/process, retries disabled. Metadata MD5 binds intended bytes to returned generation; generations stay strings above2^53. Operator caches latest validated immutable challenge/per-kind refs only; unchanged100ticks=100index metadata RPCs/0blob bytes. Timeouts keep ignored-abort effects from overlapping or qualifying late. Missing acknowledgment cannot revoke an approval already accepted remotely; do not retry blindly or discard outcomes.

Retained calibration measured_at_ms/expires_at_ms are **CLIENT epochs**, matching existing010collector; serverTime=clientTime+offset_ms. API/operator now conservatively map uncertainty before comparing lifetimes. Both±30s server tests were observed RED then GREEN. Tests prove mechanics, not actual CloudRun clock behavior.

Default-off IaC is prepared through environment→foundation→compute: allowlisted non-secret bridge inputs, absolute expiry, min=max1 requirement, cpu_idle=false only in explicitly enabled owner window. Rollback togglefalse/min0/cpu_idle=true is mandatory. No new resource/IAM/provider/model migration, no apply. See [the operator procedure](private-bridge-operations.md) for exact inputs, commands, scopes, keylessIAM/list visibility, physical/probe budgets, retention and rollback.

## Executed evidence

All retained logs: [evidence/bridge-20261111/](evidence/bridge-20261111/).

- Behavioral core Red2failed; native cache Red1failed/11passed; server-client clock Red2failed/15passed; absolute-window Red1failed/19passed. Green final core+readiness **37/37** (20core,17readiness).
- Collector-inclusive unit batch **49/49,4files** and scale-inclusive unit batch **35/35,4files** overlap core/readiness; do not sum these as unique totals.
- Full realPG scope/server **13/13**. Final targeted actual-server local/remote window roundtrip **2/2**,11intentionally nonselected tests already passed in full batch. No skipped full-suite failure is counted as pass.
- `ARCHITECTURE_BASE_REF=3f4d7fd pnpm lint`: PASS spec integrity/types, **39architecturefixtures**, **0graph findings/184exact exceptions**, **0artifact findings**. Final docs spec/artifact check PASS; diff whitespace check PASS. Lint runs underlying architecture fixture/graph/artifact commands, avoiding redundant full repeats.
- Fresh deterministic evaluation: **160/160citation precision,0leakage,60invaliddrafts0published**; Studio report/structure deterministic gates PASS. Saved full output; local doubles are not release judgments.
- OpenTofu backend-disabled local initialization, dev/staging/prod validate and recursive format checks PASS. No plan/apply/cloud mutation. No fresh image build/deployment or provider smoke is claimed; actual Node26 CLI subprocesses executed.

## Remaining CODE and actual evidence — do not collapse these

**T073–T074 are explicit remaining CODE**: non-circular bounded owner-signed GCS clock-only nonce exchange, measured conservative intervals and retained calibration installation with sameboot/candidate/revision/hash binding, no model/cache/sandbox probes, no public endpoint. Current bridge can verify already retained calibration but cannot acquire actual serving-clock proof. Hypothetical external synchronization/attestation, HTTP proxy Date, zero offset or owner signature does not close this gap. Write spec/analyze/Red first; test nonce replay/generation/steps/timeout/late results/excessive uncertainty and installation/failure fences. Parent specifically requests checkpoint integration then serialized D23 before same-agent sequential resume, while usage permits.

**T068 stays PARTIAL** for that acquisition code and deployed storage/IAM verification. Existing bucket/keyless API objectUser configuration is cited, not proof of currently effective IAM; operator list is bucket-scoped metadata visibility and requires explicit review. No automatic IAM grant/resource/retention job exists. Operator archive/prefix generation cleanup and CPU rollback require exact approved procedure. **T053 remains partial;012T064/T060,010T052/T064live,011T061 and commonfixed stratified50judged campaign remainOPEN.** Config/hash/profile matches do not independently attest immutable actual deployment, enterprise runtime, model behavior or clock safety.

Retired Gemini2.5defaults remain unmodified. Parent owns subsequent D23 serialization and owning-package Flash3.8/FlashLite3.5 migration/regressions: approved EU `eu` inference/tokenization/cache exception, other infra/embedding/managedruntime/ingestion stays europe-west4, no global/Developer API fallback. This approval is NOT paid/cloud execution permission.

Historic viewer **16.734000000000037ms FAIL**, corrected **16.733999999999924ms FAIL**, both against16ms, and report504 failure are retained. No rounding, metric/threshold/population/denominator substitution. Preserved modern006/008/009/010/011 fixes, signupD22, migration0012, scope/revocation/publication/cleanup and private canonical trace behavior. No cloud GCS write/create/apply/deploy/APIenablement/paid/audio/sandbox/GitHub write occurred during this task.
