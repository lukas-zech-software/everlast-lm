# API & Plugin Contracts: Studio Active Learning Suite (Package 4.1)

**Feature**: `specs/014-studio-active-learning-suite`
**SRS IDs**: `FR-ST-13`, `FR-ST-14`, `FR-ST-15`, `FR-ST-12`, `C-02`, `C-03`, `FR-SI-03`, `FR-UI-02`, `NFR-SEC-02`, `NFR-EVAL-04`

## 1. Studio Job Creation (`POST /api/notebooks/:notebookId/studio/artifacts`)

- **Flashcards (`FR-ST-13`)**:
  ```json
  {
    "plugin_type": "flashcards",
    "subtype": "default",
    "active_source_ids": ["<uuid>"],
    "difficulty": "easy | medium | hard",
    "card_count": "fewer | standard | more | 10 | 20 | 35",
    "focus_prompt": "optional 0..1000 Unicode code points",
    "output_language": "optional BCP-47"
  }
  ```
- **Quiz (`FR-ST-14`)**:
  ```json
  {
    "plugin_type": "quiz",
    "subtype": "default",
    "active_source_ids": ["<uuid>"],
    "question_count": 10,
    "difficulty": "easy | medium | hard",
    "focus_prompt": "optional 0..1000 Unicode code points",
    "output_language": "optional BCP-47"
  }
  ```
- **Learning Overview (`FR-ST-12`)**:
  ```json
  {
    "plugin_type": "learning_overview",
    "subtype": "default",
    "active_source_ids": ["<uuid>"],
    "section_count": 4,
    "focus_prompt": "optional 0..1000 Unicode code points",
    "output_language": "optional BCP-47"
  }
  ```
- **Errors**: `400 EmptyScopeError` (empty `active_source_ids`), `400 UnsupportedOutputLanguage` (unsupported locale), `422 ValidationError` (over-limit `focus_prompt`, out-of-range counts, incompatible params), `403/404` (non-owner/missing notebook).

## 2. Quiz Question Grading (`POST /api/notebooks/:notebookId/studio/artifacts/:id/grade`)

- **Request**: `{ "question_id": "<uuid>", "answer": "<string | string[]>" }`
- **Validation**:
  - `multiple_choice` / `multiple_select`: deterministic matching against option IDs (`<= 50 ms`).
  - `fill_in_the_blank` / `short_answer`: `1..1,000` Unicode code points after outer trim (`422 ValidationError` on empty or `> 1,000` without truncation); evaluated (`<= 1.5 s`) against rubric + cited chunks; prompt-injection strings grade `Incorrect`.
  - Records resulting `"mastered"` / `"needs_review"` attempt into `LearningProgress` atomically.
- **Response (`200 OK`)**: `{ question_id, correct, outcome, grading_mode, elapsed_ms, explanation, citations, progress }`.

## 3. Flashcard & Quiz `"Explain"` (`POST /api/notebooks/:notebookId/studio/artifacts/:id/explain`)

- **Request**: `{ "item_id": "<uuid>", "item_kind": "flashcard | quiz_question (optional)", "active_source_ids": ["<uuid>"], "output_language": "optional" }`
- **Scope Guard (`FR-GC-01`, `C-02`, `NFR-EVAL-04`)**:
  - Resolves `item_id` exclusively from the stored `Completed` `flashcards`, `quiz`, or `learning_overview` artifact.
  - Verifies every supporting `(source_id, revision)` of that item is `Ready` and present in `active_source_ids` BEFORE constructing any prompt.
  - Missing/replaced supporting sources -> `409 SupportingSourcesRequired` with zero prompt leakage and zero chat writes.
- **Response (`200 OK`)**: `{ prompt, item_id, item_kind, messages }`.

## 4. Per-User Learning Progress (`FR-ST-15`)

- `GET /api/notebooks/:notebookId/studio/artifacts/:id/progress` -> `200 { progress: LearningProgressDto }`
- `POST /api/notebooks/:notebookId/studio/artifacts/:id/progress` -> `{ item_id, outcome: "mastered" | "needs_review" }` -> `200 { progress: LearningProgressDto }` (`422` if `item_id` does not belong to the artifact)
- `POST /api/notebooks/:notebookId/studio/artifacts/:id/progress/reset` (`{ confirm: true }`) & `DELETE /api/notebooks/:notebookId/studio/artifacts/:id/progress` -> `200 { progress: LearningProgressDto }` (clears only the calling user's `item_states_json` for `:id`)
