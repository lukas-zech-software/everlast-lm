# Package 012 private clock bootstrap completion

NFR-PERF-01, FR-GC-08, NFR-SEC-02 and CC-01 through CC-09. T073/T074 are implemented and verified locally. T075 covers the remaining live collector work.

The dedicated worktree is `/private/tmp/everlast-pre-v4-012-clock-complete-20261111` on `codex/pre-v4-012-clock-complete-20261111`, based on `3821620ff740895610503225c3b2444d52d569c7`. The feature is pinned to `specs/012-long-context-latency-scaling`. This report and its evidence are tracked with the implementation. [Previous arithmetic-only checkpoint](clock-handoff-20261111.md)

## Serving and operator behavior

The API starts from a frozen deployment template and an independently pinned owner authorization root. A dedicated serving Ed25519 key signs discovery, the actual receive/publication timestamps and the install acknowledgment. The CLI independently pins that serving public key and measures its own send time and verified receipt time. The object exchange retains exact generation strings, nonce, hashes and boot/configuration binding. Its acquisition deadline includes request submission and receipt verification. The retained proof records four wall-clock epochs and the monotonic elapsed interval on each side. Clock steps, excessive uncertainty, expiry, replay and wrong key or generation fail closed.

The CLI persists the signed proof before attempting installation. The API verifies the complete signed install, recomputes calibration and atomically stores the proof on the same boot. It publishes the serving-signed acknowledgment after this synchronous install. A failed acknowledgment leaves proof available and the ordinary approval coordinator closed. The CLI retains a verified acknowledgment independently and writes the canonical calibration file after the ordinary challenge confirms the handoff. Provider qualification still requires independently signed scoped operational authorization and actual runtime, retrieval, model and cache observations.

The default-off Cloud Run configuration references a preexisting dedicated numbered Secret Manager version in the API service only. Actual target key provision, IAM, identity, region and deployment are pending. See [the operator procedure](private-bridge-operations.md).

## Local validation

The commands ran from the isolated worktree against local adapters and disposable PostgreSQL. [Raw evidence](evidence/clock-complete-20261111/)

- Red: two signed roundtrip cases failed for missing clock discovery. The API clock-bootstrap case failed at the requirement for a pre-existing calibration hash. Two acknowledgment cases failed for the missing serving acknowledgment.
- Focused Vitest unit command selected `packages/cloud/test/private-benchmark.test.ts`, `apps/api/test/benchmark-readiness.test.ts`, `packages/evals/test/v3-scale.eval.test.ts`, `packages/evals/test/code-execution-performance.test.ts` and `packages/evals/test/code-execution-collector.test.ts` with `--project unit`. 89/89 passed. The tests include both offset signs, independent signers, binding substitutions, replay, serving steps, absolute expiry, ignored cancellation and a single monotonic request-plus-receipt deadline.
- `vitest run --project integration apps/api/test/code-execution-scope.test.ts` against disposable PostgreSQL passed 14/14. The real CLI discovers the serving boot, acquires and installs calibration, then delivers separate operational approval and downloads code evidence. A serving clock step clears readiness and retains the failed scale attempt. The final acknowledgment file-order change passed a targeted rerun of the actual clock-bootstrap case (1 selected, 13 intentionally unselected).
- `ARCHITECTURE_BASE_REF=1e5c361 pnpm lint` passed spec integrity, type checking, 39/39 architecture fixtures and both architecture checkers. Zero graph or artifact findings. The 184 scoped legacy exceptions are unchanged. Final docs and artifact checks passed.
- OpenTofu recursive formatting check and backend-disabled initialization and validation passed for dev, staging and prod. Local SDK tests used doubles. No cloud or paid calls occurred.

## Open evidence and code

T075 requires continuous client clock evidence across acquisition, timed collection and export, plus full campaign duration proof. Each independent Node process has its own monotonic clock origin. The retained per-process elapsed intervals cannot establish client continuity across those launches. The existing live collector integration must run within one guarded client process or use an independently justified platform continuity mechanism. The current clock service accepts one installation per boot for at most 60s. There is no renewal. The full scoped setup and timed cohort may exceed the conservative window, including operator and export overhead. If needed, design and test bounded same-boot renewal or an approved longer lifetime before live evidence.

Actual Cloud Run/GCS acquisition and approved enterprise probes remain unrun. Dev bucket metadata was verified separately by the coordinator, while operator permissions and the serving receipt secret remain unverified. Live 010/012 timing qualification is UNAVAILABLE. T068 target verification, T075, 012T053/T064/T060, 010T052/T064 live, 011T061 and the common fixed 50-case judged campaign remain open. The failed viewer timings and report504 evidence remain in the prior handoffs. D22 and D23 apply. Model migration is a separate package responsibility.
