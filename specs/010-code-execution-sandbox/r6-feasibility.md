# R6 Feasibility Record: Strict-cap Sandbox

Date: 2026-10-20. Scope: FR-GC-08, NFR-SEC-01/02, Gate v3.0 #2, CC-07/08.
Status: **BLOCKED — no conforming deployed runtime established.** This is an investigation checkpoint, not completed speckit-plan or runtime acceptance evidence.

## Owner decision (FR-GC-08)

The owner answered: “Option A: We are not expecting more than one or two simultaneous users, so this should be fine.” Option A preserves ≤1 vCPU, ≤512 MB RAM, ≤64 MB temporary storage, zero network access and ≤15.0 s per execution, and holds planning completion until R6 establishes a conforming runtime. Expected load is one or two simultaneous users; resources may not be pooled or increased per execution on that basis. This investigation uses 512,000,000 and 64,000,000 bytes conservatively, without silently substituting the larger MiB values.

## Current repository boundary (FR-GC-08, CC-08)

`infra/modules/compute/main.tf` configures the existing worker at 2 vCPU / 2Gi, 600 s request timeout and internal ingress; the API uses 2 vCPU / 1Gi, 300 s timeout and startup CPU boost. Neither is an execution sandbox. There is no Pyodide dependency, dedicated sandbox runtime, read-only input enforcement, bounded scratch mount or independent execution watchdog. Do not run untrusted code in either existing service or treat internal ingress as zero network access. Existing service accounts have application permissions that must not be inherited by untrusted execution.

## Documented controls and gaps (FR-GC-08, R6)

Sources below were retrieved through ketch.scrape on 2026-10-20. They support design constraints, not proof that a target deployment has those controls.

| Source | Finding / implication |
| --- | --- |
| [Agent Platform quickstart](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/sandbox/code-execution-quickstart) | Default 2 vCPU / 1.5 GB and optional 4 vCPU / 4 GB exceed the retained caps. Do not deploy default and report compliance. |
| [Cloud Run memory limits](https://docs.cloud.google.com/run/docs/configuring/services/memory-limits) | Decimal M and binary Mi units are supported. First generation minimum is 128 MiB; second generation minimum is 512 MiB. A first-generation 512M outer limit is a candidate; 512Mi is larger than the retained decimal bound. |
| [Cloud Run execution environments](https://docs.cloud.google.com/run/docs/about-execution-environments) | First generation emulates only part of Linux syscalls. Second generation is recommended for Linux cgroups and third-party container security infrastructure. A locally working namespace/cgroup hardener cannot be presumed to work under first generation. |
| [Cloud Run request timeout](https://docs.cloud.google.com/run/docs/configuring/request-timeout) | HTTP timeout closes the connection but does not terminate the container. It cannot enforce the required execution kill. |
| [Cloud Run container contract](https://docs.cloud.google.com/run/docs/container-contract) | Writable container filesystem consumes memory and is not independently size limited; dedicated volume configuration is required for scratch limits. A 64 MB scratch mount alone does not prevent writes elsewhere. |
| [In-memory volumes](https://docs.cloud.google.com/run/docs/configuring/services/in-memory-volume-mounts) | A dedicated bounded in-memory volume rejects further writes when full; usage also counts toward container memory. Must verify compatible first-generation deployment and prevent alternate writable paths. |
| [Cloud Run security](https://docs.cloud.google.com/run/docs/securing/security) | Platform boundary protects instances; it does not automatically remove code access to its own service metadata/credentials or outbound networking. |
| [Pyodide worker guide](https://pyodide.org/en/stable/usage/webworker.html) | Separate worker prevents UI blocking but is not evidence of a security boundary. Host interoperability requires explicit containment outside generated Python. |

## Local disposable probes (FR-GC-08, CC-02)

Environment: existing Docker Engine 29.8.2 and local `everlast-lm:v1-local` image, Linux arm64 / Node. No cloud deployment, API enablement, image pull, application implementation or company data. Each probe used a new container, no host mounts, no credentials and no published ports. Containers were removed afterward.

Shared controls: `--network none --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --cpus 1 --memory 512000000 --memory-swap 512000000 --tmpfs /tmp:rw,noexec,nosuid,size=64000000 --user 65534:65534`.

| Probe | Observed result | Evidence limit |
| --- | --- | --- |
| Inspect cgroup configuration | memory.max = 512000000; cpu.max = 100000 100000 | Configuration observed, not a full enforcement/peak-resource benchmark |
| Write root path | EROFS | Local read-only root works; no proof for Cloud Run or Pyodide virtual filesystem |
| Fill scratch in 1,000,000-byte writes | ENOSPC after 64 whole MB written | Local bounded scratch works; underlying page rounding may exist, so exact-byte boundary still requires finer probing |
| Network interface inventory | Only lo | No external interface observed; loopback remains. No packet-capture or comprehensive socket test performed; zero-network acceptance not claimed |
| Allocate memory repeatedly | `docker wait` did not complete within 20 s; investigation watchdog timed out and forced container removal | **INCONCLUSIVE / NOT PASSED:** no observed OOM-kill evidence; configured memory.max is not substituted for termination proof |

No Python/numpy/pandas/scipy/matplotlib stack was exercised. No arithmetic, latency, 15-second enforcement, read-only Pyodide input, host-bridge escape or selected managed-runtime isolation gate passed. Local architecture differs from Cloud Run's documented Linux x86_64 ABI. These observations establish only a narrow local outer-container starting point; the FR card explicitly rejects local Docker flags as managed-service evidence.

## Concrete candidate qualification design (FR-GC-08, C-02)

Use the already documented Pyodide-on-Cloud-Run fallback as the candidate, rather than introduce a new datastore/framework. A first-generation, scale-to-zero service would have a single active execution per instance, ≤1 vCPU without startup CPU boost and a 512M outer memory limit. Two users can occupy separate instances; concurrency never weakens a per-execution limit. Package libraries must be bundled before execution; no runtime installation or CDN access.

The trusted controller must transfer input/output by a bounded channel into an independently contained execution process. That process must have no service credentials, metadata/DNS/socket access or host filesystem capability; input is immutable and all writable space is bounded. A supervisor outside generated code must enforce the 15.0-second deadline and destroy the execution environment on all terminal paths. The whole instance must be discarded before reuse if isolation cannot prove complete cleanup. Application-level blacklists, Node worker separation, Cloud Run's HTTP timeout and deleting a Python global are specifically rejected as the containment boundary.

**This is a qualification candidate, not an approved design:** compatibility of the required containment/kill mechanisms with first-generation Cloud Run and the Pyodide host bridge is not established. Moving to second generation solely to gain Linux hardening support would exceed the decimal memory cap at the container boundary. Allocating a larger host with a proven smaller nested sandbox is another design possibility, but no such nested boundary is established here and no changed interpretation of the existing cap is assumed.

## Exact remaining blocker and next evidence (FR-GC-08, CC-07/08)

The missing prerequisite is a **target-compatible executable containment design and selected-environment qualification**, not another product answer. In a project-owner-authorized EU test deployment, R6 must demonstrate all of:

1. An actual hard boundary around Pyodide and host interoperability that denies metadata/credentials, all inbound/outbound networking and unauthorized files; packet observations and escape attempts must test that boundary.
2. Enforced ≤1 vCPU, ≤512 MB total execution memory, read-only input and ≤64 MB total permitted scratch, with required libraries loaded and an exact numerical workload. Resolve the local inconclusive memory-kill probe before treating its pattern as usable.
3. Independent termination by 15.0 s, confirmed process/sandbox destruction on timeout/OOM/cancel, and no late publication. Client request timeout is insufficient.
4. Fresh state per attempt, one exception retry/zero timeout-OOM retries, private artifact transfer, EU/no-training settings and cold/warm ≤4.0 s P95 at one and two simultaneous users.

This requires an approved test runtime/image and target-environment deployment permissions, plus any required API/service enablement authorization and IaC. None was exercised or inferred here. If that candidate cannot satisfy the retained caps, return the concrete failed control to the owner before changing architecture or requirements. Until the evidence exists, keep plan status ERROR, CC-07/08 unresolved, runtime/eval gates UNAVAILABLE, and do not start dependent package planning under the current sequential procedure.
