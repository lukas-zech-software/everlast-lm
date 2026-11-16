# Package 1.1 live identity/storage plan (T046/T061, pre-V4 task 001)

Traceability: FR-WM-01/04, NFR-SEC-01/02, D22, Gate v1.0. Status: **PREPARED, NOT EXECUTED**.
No cloud call, policy apply or paid action occurred. Approval of a reviewed disposable target is required.

## Frozen inputs (`frozenLiveFixturePlan`, packages/testkit/src/live-fixtures.ts)

| Input | Value / env |
| --- | --- |
| Project | `WORKSPACE_IT_PROJECT` (non-production, disposable) |
| User A / B | `WORKSPACE_IT_IDENTITY_UID[_B]`, `WORKSPACE_IT_EMAIL[_B]`, `WORKSPACE_IT_PASSWORD[_B]`; distinct uid and email; `WORKSPACE_IT_APPROVED_FIXTURE[_B]=<project>/identity/<uid>` |
| API key | `WORKSPACE_IT_API_KEY` |
| Bucket | `WORKSPACE_IT_BUCKET`; approval `WORKSPACE_IT_APPROVED_STORAGE=<project>/storage/<bucket>`; labelled `everlast-fixture=disposable`, europe-west4, versioning on, soft delete 0, no retention |
| Database | local PostgreSQL only (`TEST_DATABASE_URL`) |
| Signup rollback | `WORKSPACE_IT_SIGNUP_ROLLBACK=disabledUserSignup=true` |

Objects (random notebook prefix per user, nothing else touched):

| Owner | Object | Generations | Hold |
| --- | --- | --- | --- |
| A | `sources/fixture/raw` | v1, v2 | v1 temporary hold |
| A | `sources/late/raw` | late-put (signed PUT before expiry) | none |
| B | `sources/fixture/raw` | v1, v2 | none |

## Run order

1. Verify target policy is readable; abort UNAVAILABLE otherwise.
2. A signs in; token verifies.
3. Signup probe with A's existing email must return `ADMIN_ONLY_OPERATION`.
4. Revoke A (`validSince`): A's token rejected as revoked; B subsequently signs in and its token verifies. This does not assert survival of a B token issued before A's revocation.
5. Cleanup: A's notebook delete → `retry:RetainedObject` (hold) → release hold → `deferred` (active PUT capability) → real PUT, wait for expiry, late PUT fails → `purged`; zero versions; status contains no title/object names; user B cannot read A's status; B's objects untouched.

Commands (after approval):
`WORKSPACE_IDENTITY_IT=1 pnpm vitest run apps/api/test/identity.integration.test.ts` and
`WORKSPACE_STORAGE_IT=1 pnpm vitest run apps/worker/test/notebook-cleanup.integration.test.ts`.

## Policy change and rollback (prepared for approval, not applied)

- Change: module `infra/modules/iam_identity` already sets `client.permissions.disabled_user_signup = true` (D22/DEV-06). Review a saved `tofu plan` for the disposable project using the deploy-dev tfvars; apply only after approval.
- Rollback: re-plan with the previous reviewed state; record the pre-change `disabledUserSignup` value in the approval. Revoked disposable user: re-enable by deleting the fixture user (disposable). Delete all random prefixes by version with holds cleared (suite `afterAll` does this).

## Resumable upload scenarios (`RESUMABLE_SCENARIOS`)

| Scenario | Verifiable through existing API |
| --- | --- |
| signed-put-expiry-late-sweep | Yes |
| post-resumable-denied-on-put-capability | Yes |
| externally-created-resumable-session-cancel | **UNAVAILABLE** – API issues no resumable sessions |
| resumable-session-survives-notebook-delete | **UNAVAILABLE** – needs API-issued resumable session |

Local proof so far: 4 testkit tests (incl. frozen plan Red→Green), 19 focused tests; the two live suites SKIP by opt-in guard.

## Current disposition — 2026-11-16 (D24/DEV-07, NFR-SEC-01/02)

Local verification of identity revocation, cleanup, and retry paths passes in deterministic/PostgreSQL integration suites; live cloud execution of `T046`/`T061` (`WORKSPACE_IDENTITY_IT=1`, `WORKSPACE_STORAGE_IT=1`) is explicitly recorded **UNAVAILABLE** in this environment because no approved disposable Identity Platform tenant, GCS test bucket, or signing ADC were supplied. Under `D24`/`DEV-07`, local contract/PostgreSQL/Playwright verification clears release gates without paid cloud campaigns, while live-only scenarios (`externally-created-resumable-session-cancel`, `resumable-session-survives-notebook-delete`) remain individually **UNAVAILABLE**.

Identity invocation uses `WORKSPACE_IT_APPROVED_FIXTURE=<project>/identity/<uidA>`; the storage invocation instead uses `WORKSPACE_IT_APPROVED_FIXTURE=<project>/storage/<bucket>`. Both also retain `WORKSPACE_IT_APPROVED_STORAGE`; identity requires `WORKSPACE_IT_APPROVED_FIXTURE_B`. Supply approved disposable targets and signing ADC privately before any live run.
