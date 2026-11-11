# Pre-V4 parallel work packages

Each prepared branch starts at the same integrated candidate and adds its own
`INSTRUCTIONS_{TaskID}.md`. The instructions are the agent prompt. Start one
agent per task in a new worktree and use whichever model suits the task. The
candidate includes the main refresh through `1e5c361` and the locally verified
012 T073/T074 clock checkpoint. Release acceptance is pending.

| Task ID | Parallel work available from the prepared branch | Dependency for integration or live acceptance |
| --- | --- | --- |
| 001 | Identity and cleanup fixture preparation and independent workspace boundaries | Reviewed disposable target and approval for live checks |
| 003 | Shared Gemini configuration, grounded chat and refusal journey | Publishes the D23 routing interface for downstream consumers |
| 004 | Map D21 records, prepare evidence and judge regression tests | Use actual producer identities after 003/006/008/011/012 land |
| 005 | Topic emoji adapter tests and extraction from the worker application | Use 003 Gemini routing before wiring the D23 consumer |
| 006 | Structured SDK transport and Guide regressions | Consume 003 routing, publish the typed structured adapter interface |
| 007 | Notes normalization and Notes-specific boundary removal | Resolve shared ingestion and chat interfaces with 009 and 003 |
| 008 | Report failure analysis, bounded report processing and regression coverage | Consume 003 routing and the 006 adapter before live report work |
| 009 | Multimodal, sync and timestamp verification on local fixtures | Integrate shared C-01 and Guide hooks before the live workload |
| 010 | Sandbox isolation, provenance and collector failure tests | Agree on the timing evidence interface with 012 before live cohorts |
| 011 | Decimal exports, viewer measurement and map/table adapter tests | Consume 003 and 006, then wire the production Studio ports |
| 012 | T075 clock continuity and duration across the 010/012 campaigns | Coordinate 010's collector interface and use the migrated model/cache profile |
| GATE-V3 | Evidence ledger, exact deployment and rollback inputs, fixture inventory | Final validated packages, immutable candidate, approved target and workloads |

The parallel column is the portion agents can start together. A dependency in the
third column is a hold point for the affected part, while unrelated parts continue.
Start downstream contract tests with explicit local doubles or fixed fixtures.
Integrate the producer's committed interface before consuming it in real startup.
If a needed interface changes, record the change request and continue within the
assigned paths. Work that needs a new contract goes through its owning package.

## Starting a task

Run the worktree command in its instructions as the first Git action. The
prepared branch stays as the immutable starting point. Use the new branch and
worktree for edits, then pin the assigned feature as the next step. The release
coordination branch is documentation-only and keeps the feature pin untouched.

Read `AGENTS.md`, the constitution, architecture guardrail procedure, requirements
README, owning card and feature artifacts. Apply Spec Kit for the feature. Refresh
CC-09 plan/tasks and analyze before implementing. Use spec-derived Red → Green for
changed behavior. Test with a task-specific database, temporary directory, ports
and Docker project if applicable. Check usage regularly and stop starting work at
five-hour remaining ≤10% or weekly remaining ≤2%. Finish existing checks and leave
a clean checkpoint with exact SHAs, commands, evidence, gaps and continuation steps.

## Shared files and integration

Each task's owned paths are the write set for parallel work. Request a serialized
integration slot for common startup, registries and infrastructure composition:
`apps/api/src/server.ts`, `apps/api/src/v2/runtime.ts`,
`apps/worker/src/studio/registry.ts`, `apps/worker/src/server.ts`,
`apps/web/test/e2e-server.ts`, and common environment wiring. Package 003 owns the
new shared Gemini configuration export. Package 006 owns the structured generation
interface. Packages 010 and 012 exchange a typed timing interface. The agent that
owns the feature wires its own paths during its integration slot.

The coordinator also serializes shared manifests/lockfile, cross-feature exports,
`spec/requirements/README.md`, SRS, architecture decisions, and
`scripts/architecture-policy.json`. Bring exact upstream edits and any D21 deletion
records with the work. A row removal must accompany the actual boundary fix. During
parallel work, keep that removal as a scoped patch if another task owns the file.
Run final graph and artifacts checks after applying the real deletion in the
integration slot. The base inventory is 184 exact records. Retain 004 T035/T036 for
unassigned debt and the remaining R2 workflow work.

Sequence shared integration by the actual dependencies. Establish 003 and 006
interfaces before their consumers. Integrate shared C-01 ingestion changes before
the v3 integrated workload. Coordinate 010's evidence schema with 012 before timed
collection. Wire 005/007/008/011 in their own slots. Once the deployment candidate
is assembled, 004 verifies real adapter identities and the release evaluator.

Use the prepared branch for local execution against the integrated code. Publish
only the task's reviewed change against the appropriate PR base. The whole base
contains several locally integrated packages. Use the exact prepared start SHA for
the task diff and transfer only that delta. Apply release approvals to the concrete
reviewed deployment or merge. Gate v3 requires actual evidence under the unchanged
fixtures, limits and populations, including failures.
