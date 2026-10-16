# FR Cards

The SRS (`../System_Requirements_Specification_Gemeni_Notebook.md`) is the index of all
requirements. The FR cards in this folder add the detail that `/speckit-specify` needs, so
specs are transcribed from observed or memorized behaviour instead of invented. Template and examples:
[`_fr-card-template.md`](_fr-card-template.md).

## What to extract per FR

For each FR collect these details from your knowledge.  Write `Unknown` if you
do not know for sure; never guess.

| # | Extract | Why the spec needs it |
| - | :- | :- |
| 1 | **Trigger and entry point**: where in the UI, which button or gesture, and the preconditions | Given/When of the scenarios |
| 2 | **Actors**: which roles may do it (Owner/Editor, Viewer, Chat-only) | Permissions; RBAC tests |
| 3 | **Main flow**: numbered steps of what happens | User story and acceptance scenarios |
| 4 | **Inputs and limits**: fields, formats, sizes, counts, defaults, with **numbers** | Testable constraints |
| 5 | **Outputs and state**: what the user sees, what is persisted, status transitions | Then-clauses; key entities |
| 6 | **Errors and edge cases**: empty, too large, unsupported, deleted meanwhile, concurrent, offline; exact message text if it matters | Edge-case section |
| 7 | **Timing**: synchronous or asynchronous, rough duration, progress indicator | Success criteria |
| 8 | **Links to other FRs**: which FRs it depends on or triggers | Dependencies; release order |
| 9 | **Deviations**: what we deliberately do differently, and why | Avoids copying the product blindly |
| 10 | **Evidence**: screenshot or recording path, help URL, date observed | Traceability; the product changes |
| 11 | **Open questions**: what you could not determine | Max 3 clarification markers per spec |

Rows 1–6 are the minimum for a card to be usable.

## How to hand them over

- **One file per release package**, named `v<N>/package_<N>_<M>_<short_name>.md`
  (e.g. `v1/package_1_2_text_pdf_ingestion_inspector.md`): the package header
  first (see template), then one FR card per FR in that package.
- **Evidence** goes in `../evidence/<FR-ID>/` and is referenced by relative path.
- **The SRS stays the index**: keep the one-sentence FR there and add a link to its card.
- **Language**: German or English; generated specs are written in English.
- **Open questions**: at most 3 may remain per package; resolve the rest before specifying.
- **Specify**: run `/speckit-specify spec/requirements/v1/<package-file>.md` once per package.
  Each spec requirement cites its SRS ID, e.g. `FR-001 (FR-SI-03)`.
- **Cadence**: cards for the current release first; the next release's cards may be written
  while the current one is implemented (Constitution Principle V).
