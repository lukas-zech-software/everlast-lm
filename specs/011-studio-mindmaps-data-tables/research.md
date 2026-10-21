# Research: Studio structure and extraction

Date:2026-10-20. Scope:`FR-ST-08/09/18`,`C-01..C-03`,`NFR-SEC-01/02`,`NFR-EVAL-01..04`. All research decisions are resolved; execution evidence remains future work. Research was performed inline under the parent's one-active-package-agent/no-nested-agent constraint.

## Existing contracts and compatibility (`C-03`, `FR-ST-08/18`)

**Decision:** Extend C-03 shared schemas/dispatcher/repository additively for `mindmap` and `data_table`, preserving report DTO wire shapes and exported report schemas. Add a versioned migration widening plugin/subtype constraints, no edit of deployed migrations.
**Rationale:** Inspected `packages/contracts/src/package-v2-4.ts`: manifest/registry can name arbitrary kinds, but payload/params/outcome and artifact/request schemas are report-specific. `packages/db/migrations/0004_studio_artifacts.sql` allows only report; repository create fixes plugin_type to report. API/web dispatch is similarly report-only. SRS C-03 explicitly requires future independent plugin registration, so extension is required before3.3 consumers. Keep report plugin unchanged and regress its behavior. Generic plumbing accepts registered typed variants rather than unknown unchecked JSON; preserve common job lifecycle and access fences.
**Alternatives considered:** A second Studio registry/table would duplicate C-03; treating map/table JSON as report Markdown would lose type-safe invariants; breaking existing report wire fields would require a separate approved migration/amendment.

## Grounded synthesis and reduction (`FR-ST-08/18`, `C-02`, `D12`)

**Decision:** Existing structured Gemini Flash calls in deterministic pipelines; all-original-chunk bounded processing plus evidence-bearing merge. Reuse package3.1 canonical locators unchanged. Persist content-level citations and coverage metadata, never hidden source text in cache keys or logs. Model suggestions are candidates until Zod and semantic/ID validation.
**Rationale:** Architecture§4.1 and Studio flow require structured code orchestration and D12 evidence completeness. Need schema union to distinguish missing cells and cited alternatives. Conflict values cannot be collapsed into one uncited string. Required result dimensions must be assessed over all extracted candidates before publishing, so an over-limit request cannot succeed as a truncated table.
**Alternatives considered:** Source Guide-only reduction loses facts; top-k retrieval for exhaustive table/map synthesis omits scoped evidence; agentic tool loops add no needed dynamic behavior; silent citation repair/retry violates D13.

## Native map rendering and downloads (`FR-ST-08/09`)

**Decision:** Existing DOM modules with deterministic layered tree layout and native SVG; escaped text/tspan labels and paths only, local font metrics/wrapping. Export the expanded-tree scene with full bounds; rasterize the self-contained SVG to Canvas at2× and use PNG Blob. No chart framework, external images/fonts, foreignObject, scripts, links or event handlers in exported SVG.
**Rationale:** Architecture already binds deterministic SVG and2× PNG. Native browser Canvas supports PNG output (primary [HTML Canvas standard](https://html.spec.whatwg.org/multipage/canvas.html)); [drawImage documentation](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage) explains explicit image sizing. Performance targets are acceptance tests, not implied by these APIs. Bound viewport work to≤120 nodes, group transforms, requestAnimationFrame and cached layout.
**Alternatives considered:** Graph framework unnecessary for bounded tree; image generation loses legibility; DOM screenshot loses full expanded-tree bounds; v4 render job adds unnecessary service dependency.

## Spreadsheet export (`FR-ST-18`, `Gate v3.0 #3`)

**Decision:** Server-side ExcelJS serializer for a simple text-only workbook, with reviewed locked version during implementation; deterministic own CSV emitter. All cells/headings are literal text, never formulas or user-selected external hyperlinks. Retain every conflicting value and disagreement marker in one export cell, append human-readable citation references and include an authorized citation legend in XLSX/a corresponding textual reference in CSV cells. Sanitize original dangerous prefixes including leading whitespace/control-character bypasses before CSV quoting; explicit XLSX string cells additionally preserve the same safe displayed text.
**Rationale:** [ExcelJS maintainer README](https://raw.githubusercontent.com/exceljs/exceljs/master/README.md) documents XLSX writing; use it as a library within the existing worker/API runtime, not a new service/framework. [RFC4180](https://www.rfc-editor.org/rfc/rfc4180) defines CRLF records, consistent field counts and doubled quotes. BOM and formula prevention are extra package rules, not claims supplied by RFC4180. ZIP/OOXML safety and formula absence require independent parser checks; a writer roundtrip alone is insufficient.
**Alternatives considered:** Hand-built OOXML/ZIP increases format risk; CSV alone fails XLSX requirement; LibreOffice conversion adds an avoidable render job and formula-evaluation surface; browser-only downloads bypass centralized fresh authorization for persistent artifacts.

## Access and drilldown (`FR-ST-09/18`, `FR-GC-01/06`, `NFR-EVAL-04`)

**Decision:** Artifact/node-ID drilldown preflight at API before node/parent labels enter chat. Current explicit Ready selection, exact supporting revisions and live document authorization govern eligibility. Merely deselected historical artifacts remain readable/exportable when authorized; source deletion/revocation/replacement invalidates affected content. Downloads go through guarded API, no reusable signed URLs; browser clears loaded artifact/export state on invalidation.
**Rationale:** The constitution and README distinguish historical viewing from new generation. A browser-only eligibility check would expose text to a constructed prompt and allow forged requests; a public download URL bypasses revocation. Reuse existing chat admission and publication rather than new chat/history semantics.
**Alternatives considered:** Restoring snapshot selection violates current scope; accepting client labels trusts arbitrary/out-of-scope content; persisting expansion/sort in shared artifact mutates content for other sessions.

## Feasibility boundary (`FR-ST-08/09/18`, `NFR-EVAL-01..04`)

No product questions remain. Generic tests/runner scripts are present, but new payloads/plugins/routes/exports and package-specific timing/eval fixtures do not yet exist. They are UNAVAILABLE for runtime qualification during planning. Package3.2 managed default2vCPU/1.5GB (D18) is inherited without changing its pending R6 controls;3.3 requires no sandbox execution. No new cloud API is enabled or deployment made.
