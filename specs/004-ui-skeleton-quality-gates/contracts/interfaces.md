# Interface Contracts: UI Skeleton & Quality Gates

Trace: FR-UI-01, NFR-EVAL-01, NFR-EVAL-02, NFR-EVAL-03, NFR-EVAL-04, NFR-SEC-01, C-01, C-02. Import the [single shared baseline](../../001-workspace-foundation/contracts/shared-context.md) and [admission contract](../../001-workspace-foundation/contracts/workspace-api.md).

### Workspace integration contract (FR-UI-01)

Compose existing modules into header + Sources/Chat/Studio panels. At >=1280px both side panels default expanded; 1024–1279px right defaults collapsed; <1024px Sources/Chat/Studio tabs preserve state. Apply saved collapse preference only within a compatible desktop/laptop mode; switching to tabs does not erase preference or draft. Left/right collapse independent, transitions <=200ms at60fps; input and scroll never reset. Inspector widens/un-collapses Sources; on narrow screens activate Sources tab while retaining Chat state. Placeholder is exactly “Notes and Studio tools will appear here”. No generation tiles or Notes creation in v1.

### Evaluation runner contract (NFR-EVAL-01..04, NFR-SEC-01, Gate v1.0)

Golden JSONL dataset has >=100 unanswerable cases, >=50 deselected-source/history cases and >=50 multi-document synthesis cases. Category membership and case IDs are validated before execution; missing samples or invalid fixtures fail the run, never improve denominators. Every non-executed/error case remains explicit and prevents passing the affected suite. Version all source fixture text and expected evidence.

Deterministic citation check: every displayed badge resolves to a real chunk in the exact request context, precision=1.0. Deterministic scope check observes retrieval logs, serialized model input and published output, leakage=0; include history/summary/tool/cache paths, decoys and malicious cross-notebook requests. Semantic support and hallucination are separate judged results. Require every evaluated cited claim to be supported; no95% exception for unsupported citations. Claim-level hallucination rate strictly<0.05 (target<=0.02 informational). Negative rejection case rate>=0.99. Unknown/invalid judge output fails closed; no silent reroll until pass. Record judge rubric, cases and result evidence for review.

Metric definitions (NFR-EVAL-01..04): hallucination rate = unsupported factual claims / all evaluated factual claims; citation precision = valid scoped badges / all evaluated badges; rejection rate = correctly refused unanswerable cases / all unanswerable cases. Report numerators and denominators; empty claim/badge sets cannot establish a passing synthesis suite. Missing cases, errors or zero denominators fail validation. Leakage counts forbidden chunks at each observed boundary and must be zero at every boundary.

Runner writes `eval-report-v1.json` plus Markdown summary/audit per build commit, exits0 only for all requested completed/passing checks, otherwise nonzero with exact failing IDs. Full gate combines (1) real PDF/MD C-01 upload, (2) four eval metrics plus support check, (3) deterministic citation target navigation. Gate remains Pending when required infrastructure/runner is UNAVAILABLE; never unlock v2 on that basis.

CI runs lint/type/unit/contract/deterministic every PR; judged suites on retrieval/prompt/chat PRs and every release gate. No-training preflight covers LLM, OCR and embeddings enterprise endpoints, no consumer keys. No-training does not imply zero retention. Verify configured region/service limitations and recorded exceptions, do not assert unverified vendor guarantees. Use synthetic data; secrets/keyless identity follow existing OpenTofu baseline.

## Universal failure rules

Owner-only v1–v5; explicit nonempty Ready source IDs, immutable submission revisions, current authorization before reads/publication, singleton inspection without selection mutation. All source reads go through C-02; history/cache eligibility covers complete provenance, not only citations. Deleted/revoked content is hidden or unavailable; invalid factual citations cause immediate refusal before publication. Byte and word limits are independent and inclusive. All future roles, overview/chips/Source Guide, personas, re-sync, media and Studio features remain in their assigned releases.
