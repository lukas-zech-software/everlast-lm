# Interface Contracts: Studio Text Synthesis & Reports

**Spec**: [spec.md](../spec.md) | **Data model**: [data-model.md](../data-model.md) | **SRS IDs**: FR-ST-10, FR-ST-11, C-02, C-03

All schemas are defined once in `packages/contracts/src/package-v2-4.ts` and imported by db, worker, api and web (`CC-05`).

## C-03 `StudioGeneratorPlugin` (defined here for v2.0)

```ts
interface StudioGeneratorPlugin {
  readonly manifest: { plugin_type: string; display_name: string; subtypes: readonly string[] };
  // Synchronous validation at submission; throws StudioParamsError (maps to HTTP 422).
  triggerJob(request: StudioJobRequest): StudioJobPlan;            // { title, params_json }
  // Async generation; receives only C-02 scoped chunks.
  generate(ctx: StudioGenerationContext): Promise<StudioGenerationOutcome>;
}
// ctx = { artifact_id, notebook_id, subtype, params_json, snapshot, chunks, output_language?, signal, reportProgress(stage, percent) }
// outcome = { status: 'completed', payload } | { status: 'refused', code, message }
class StudioPluginRegistry { register(p); get(plugin_type); list() }   // duplicate/unknown throw
```

Rules: plugins never read storage directly (C-02 only), never set status, never publish; the runner enforces lifecycle (`Queued → Running → Completed | Failed | Cancelled`), snapshot/authorization re-checks before reading and publishing, and citation validation. Retry is a new attempt with fresh authorization and explicit scope.

## Ports (injected)

| Port | Signature | Notes |
| :- | :- | :- |
| `ScopedContextProvider` (C-02) | `getScopedContext(notebook_id, active_source_ids): Promise<UnifiedDocumentChunk[]>` | existing contract |
| `StudioAccessVerifier` | `verifySnapshot(owner_id, notebook_id, snapshot): Promise<void>` | throws `InvalidScopeError` / `SourceSnapshotInvalidError` |
| `ReportModelClient` | `extract(batch) / compose(findings) / suggest(guides)` | structured outputs, Zod-validated |
| `SourceGuideProvider` | `getGuides(notebook_id, snapshot): Promise<SourceGuideState[]>` | FR-SI-02 consumer port |
| `StudioJobDispatcher` | `enqueue(artifact_id, owner_id): Promise<void>` | Cloud Tasks adapter in production |
| `ConvertToSource` | `convert({notebook_id, owner_id, title, content_md}): Promise<{source_id}>` | FR-NM-03 existing behavior, atomic slot reservation |

## HTTP (Owner-only, server-side authorization; `Authorization: Bearer`)

| Method & path | Body | Success | Errors |
| :- | :- | :- | :- |
| `POST /api/notebooks/:id/studio/artifacts` | `{ plugin_type:'report', subtype, active_source_ids, custom_prompt?, output_language? }` | `202 { artifact }` (`Queued`) | `400 EmptyScopeError`, `422 ValidationError` (prompt, subtype), `403 InvalidScope`, `409 SourceSnapshotInvalid` |
| `GET …/studio/artifacts` | – | `200 { artifacts[] }` (no payload) | – |
| `GET …/studio/artifacts/:artifactId` | – | `200 { artifact }` (payload only when `Completed`; unavailable placeholder if snapshot invalid) | `404` |
| `POST …/:artifactId/cancel` | – | `200 { artifact }` | `409` if terminal |
| `POST …/:artifactId/retry` | `{ active_source_ids }` (required, explicit) | `202 { artifact }` new attempt | `400`, `409` if not `Failed`/`Cancelled` |
| `POST …/:artifactId/convert-to-source` | – | `201 { source_id }` | `409` unless `Completed`, `501` if port missing |
| `DELETE …/:artifactId` | – | `204` | `404` |
| `POST …/studio/report-suggestions` | `{ active_source_ids, output_language? }` | `200 ReportSuggestionsResult` | `400 EmptyScopeError`, `403 InvalidScope` (owner and scope verified through `StudioAccessVerifier` before any guide is read) |

Error body: `{ "error": { "code", "message" } }`.

## Web module contracts

- `ReportsModalController`: `templatesEnabled` is `false` when the active set is empty; suggestion states `SuggestionsLoading → SuggestionsReady | SuggestionsUnavailable`; `canGenerate` ⇔ trimmed prompt is 1–5,000 code points.
- `StudioArtifactListController`: `Queued|Running` rows show `Generating <Template>...`; completed rows open the Markdown viewer with copy, convert-to-source and delete actions.
