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
| `ReportModelClient` | `extract(batch) / compose(findings) / suggest(guides)`; requests carry `output_language` | structured outputs, Zod-validated; `VertexReportModel` (Flash) in production, `DeterministicReportModel` for tests/evals/unconfigured runs |
| `ReportSuggestionModel` | `suggest({ guides, output_language, signal })` | Flash-Lite through the Package 2.2 `VertexStructuredGenerationClient.generateReportSuggestions`; absent → `SuggestionsUnavailable` |
| `OutputLanguageResolver` | `(owner_id, notebook_id) → Promise<string>` | `WorkspacePreferencesService.resolveLanguagePreferences` (`FR-UI-02`) |
| `SourceGuideProvider` | `getGuides(notebook_id, snapshot): Promise<SourceGuideState[]>` | FR-SI-02 consumer port |
| `StudioJobDispatcher` | `enqueue(artifact_id, owner_id): Promise<void>` | `InlineStudioDispatcher` in the single API process (D16) |
| `ConvertToSource` | `convert({notebook_id, owner_id, title, content_md}): Promise<{source_id}>` | FR-NM-03 existing behavior, atomic slot reservation |

## HTTP (Owner-only, server-side authorization; `Authorization: Bearer`)

| Method & path | Body | Success | Errors |
| :- | :- | :- | :- |
| `POST /api/notebooks/:id/studio/artifacts` | `{ plugin_type:'report', subtype, active_source_ids, custom_prompt?, output_language? }` | `202 { artifact }` (`Queued`) | `400 EmptyScopeError`, `422 ValidationError` (prompt, subtype), `403 InvalidScope`, `409 SourceSnapshotInvalid` |
| `GET …/studio/artifacts` | – | `200 { artifacts[] }` (no payload) | – |
| `GET …/studio/artifacts/:artifactId` | – | `200 { artifact }` (payload only when `Completed`; unavailable placeholder if snapshot invalid) | `404` |
| `POST …/:artifactId/retry` | `{ active_source_ids }` (required, explicit) | `202 { artifact }` new attempt | `400`, `409` if not `Failed`/`Cancelled` |
| `POST …/:artifactId/convert-to-source` | – | `201 { source_id }`: saves the report as a note (`NotesService`), then converts it through `FR-NM-03` (markers stripped, `origin_citations` kept) | `409` unless `Completed` or snapshot invalid, `501` if port missing |
| `DELETE …/:artifactId` | – | `204` | `404` |
| `POST …/studio/report-suggestions` | `{ active_source_ids, output_language? }` | `200 ReportSuggestionsResult` | `400 EmptyScopeError`, `403 InvalidScope` (owner and scope verified through `StudioAccessVerifier` before any guide is read) |

No cancel route in v2: `Cancelled` stays a C-03 state for later plugins (card FR-ST-10). Error body: `{ "error": { "code", "message" } }`; upstream model error text never reaches a response or stored job state.

## Web module contracts

- `ReportsModalController`: `templatesEnabled` is `false` when the active set is empty; suggestion states `SuggestionsLoading → SuggestionsReady | SuggestionsUnavailable`; `canGenerate` ⇔ trimmed prompt is 1–5,000 code points.
- `StudioArtifactListController`: `Queued|Running` rows show `Generating <Template>...` with a generating indicator; completed rows open the Markdown viewer with Copy, Delete (confirmation) and Convert to source.
- `createStudioPanel` (`apps/web/src/studio/panel.ts`): Reports tile → `Create report` modal (Create Your Own, four templates, 3–4 Suggested Format cards with edit pencil, loading/unavailable states); always sends the current `selection.ids()`.
