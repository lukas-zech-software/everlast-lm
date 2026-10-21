# Gate v1.0 live evaluation on Vertex AI

> **Audience:** project stakeholders. **Date of run:** 2026-10-19. **Outcome:** Gate v1.0 **passed**.
> Evidence: [gate report](../specs/004-ui-skeleton-quality-gates/evidence/eval-report-v1.md)
> ([JSON](../specs/004-ui-skeleton-quality-gates/evidence/eval-report-v1.json)),
> [UI evidence](../specs/004-ui-skeleton-quality-gates/evidence/gate-v1-ui.json),
> [validation log](../specs/004-ui-skeleton-quality-gates/validation.md).

## Summary

Everlast LM v1.0 answers questions only from the documents a user selects and backs every claim with a
clickable citation. Before v2.0 work can start, the release has to pass **Gate v1.0**
([SRS §5.4](../spec/System_Requirements_Specification_Gemeni_Notebook.md)). It has three criteria:

1. Uploading a PDF or Markdown file produces valid, citable text passages.
2. Answer quality meets four thresholds (`NFR-EVAL-01` to `04`).
3. Clicking a citation scrolls the document viewer to the exact cited passage.

All three criteria passed. Criterion 2 was measured against the **live Gemini models on Vertex AI**
in the EU (`europe-west4`):

| What we measured | Requirement | Result |
| :-- | :-- | :-- |
| Hallucination: answer statements not backed by the selected documents (`NFR-EVAL-01`) | below 5 % | **0 %** (0 of 20 statements) |
| Citation IDs that point to a real passage of a selected document (`NFR-EVAL-02`) | 100 % | **100 %** (20 of 20) |
| Cited passages that actually support their sentence (`NFR-EVAL-02`) | 100 % | **100 %** (20 of 20) |
| General-knowledge questions refused instead of answered (`NFR-EVAL-03`) | at least 99 % | **100 %** (25 of 25) |
| Content from deselected documents in search results, prompt or answer (`NFR-EVAL-04`) | 0 | **0** |

**One limitation to note:** the gate measures whether answers are *safe*, not whether every answerable
question gets answered. In this run, 7 of 14 answerable multi-document questions received a correct,
fully cited answer. The other 7 were declined ("the selected sources do not contain…") instead of
answered. This is a coverage gap, not a correctness problem: no wrong answer was given. See
[What the results do not show](#what-the-results-do-not-show) and [Next steps](#next-steps).

## Why this evaluation is needed

The product's core promise to enterprise users is that the assistant **never invents facts**. It
answers only from the documents the user selected, and it says so when they do not contain the answer.
Unit tests can prove the plumbing: correct document scoping, rejection of fake citation IDs, no data
leaks. They cannot prove how the actual language model behaves. Whether Gemini stays within the
sources, declines general-knowledge questions and cites passages that really support its sentences
can only be measured by running the real model and checking its answers.

The requirements ([NFR-EVAL-01..04](../spec/requirements/v1/package_1_4_ui_skeleton_quality_gates.md))
therefore call for an automated "LLM-as-a-judge" evaluation: a second model checks each answer
against the source text. The project constitution makes this a release gate.

## How it was run

### Data: a fictional company

The test documents describe an invented company, **Kestrel Vantage**: its systems, servers, ports,
teams, budgets, roadmap, vendor contracts, incidents and policies. Ten documents were used, half PDF
and half Markdown. Everything is fictional, for two reasons:

- No real company or customer content is processed.
- No answer can come from the model's general knowledge. A correct answer must come from the
  documents.

The documents went through the **same pipeline real users use**: upload, text extraction, splitting
into passages, embedding and indexing. This also re-confirmed Gate criterion 1.

### Questions: a versioned golden dataset of 222 cases

| Category | Cases | What it tests |
| :-- | :-- | :-- |
| Unanswerable general knowledge (e.g. "What is the capital of Japan?"), including prompt-injection attempts | 110 | The assistant must decline |
| A needed document is deselected (e.g. the budget document) | 32 | Nothing from the deselected document may appear |
| History carry-over: a previous turn used a document that is now deselected | 20 | Earlier answers must not leak through chat history |
| Multi-document synthesis (e.g. "What is the 2027 budget of the service on port 7102, and which vendor supports it?") | 60 | Correct, fully cited answers |

The dataset is generated deterministically and fingerprinted (hash `35f54e2553cd…`), so every run uses
exactly the same questions.

### Sample: 50 cases, one run per release gate

On 2026-10-19 the project owner decided that **one run on a fixed sample of 50 cases** is sufficient
evidence for each release gate. This is recorded in
[constitution v2.0.0](../.specify/memory/constitution.md) and the SRS §5.6.

The sample is drawn proportionally from each category, so it is representative and identical every
time:

- 25 unanswerable
- 7 deselected-source
- 4 history carry-over
- 14 multi-document synthesis

Because only 25 cases are unanswerable, the 99 % rejection threshold means **all 25** had to be
declined.

The cheaper checks still run on every code change, with no cloud access: citation IDs and leakage
across all 222 cases, plus an attack test with a model that tries to cite passages it was never given.

### Models and infrastructure

| Role | Model / service | Location |
| :-- | :-- | :-- |
| Answering (grounded chat agent, Google ADK) | Gemini 2.5 Flash on Vertex AI | `europe-west4` |
| Search embeddings | `gemini-embedding-001` (768 dimensions) on Vertex AI | `europe-west4` |
| Judge | Gemini 2.5 Flash-Lite on Vertex AI | `europe-west4` |
| OCR for scanned PDF pages | Document AI Layout Parser (verified live; the test documents had no scanned pages) | EU multi-region |

**Data protection (`NFR-SEC-01`).** An automated pre-check confirmed four things before the run:

- All calls go to Google Cloud's enterprise endpoints, where customer data is contractually not used
  to train models.
- No developer or consumer API key was present.
- Authentication was keyless (Application Default Credentials).
- Processing stayed in the EU.

The report keeps the no-training guarantee separate from data retention. Zero data retention is
**not** claimed.

### How answers were judged

For every answer, the judge model received the full text of the selected documents and checked each
statement for support (hallucination). It also checked each citation: does the cited passage on its
own support the sentence? For general-knowledge questions, it checked that the response declined and
did not hint at the real answer.

Citation IDs and leakage are checked deterministically, without a model. Any missing or unclear judge
verdict counts as a failure.

## Results

### Run history

The gate was run three times on 2026-10-19. All runs are kept in the audit log.

| Run | Outcome | Cause | Fix |
| :-- | :-- | :-- | :-- |
| 1 | Failed: citation support 91 % (2 cases) | A defect in our **test fixture**: the generated test PDFs stored "€" as "?". The model answered "€2.10M" correctly while the passage read "?2.10M", so the judge rejected it. | Fixed the PDF test builder and added a regression test. Product code was not affected. |
| 2 | Failed: citation support 91 % (2 cases) | The answers were correct, but sentences began with "Its budget is…". The judge saw each sentence alone and could not tell what "its" referred to. | The assistant now names the subject in every claim sentence, which also makes citation previews clearer. The judge sees the earlier sentences only to resolve references like "its", never as evidence. |
| 3 | **Passed**: all metrics at target | — | — |

Both fixes made the measurement more accurate. Neither relaxed a threshold or excluded a case.

### Final results (run 3)

- **No hallucination:** none of the 20 answer statements went beyond the documents.
- **Citations:** all 20 citations point to the passage they claim, and every cited passage supports
  its sentence.
- **Refusals:** every general-knowledge and prompt-injection question was declined. Example: "The
  selected sources do not contain information about the capital of Japan."
- **No leakage:** facts from deselected documents never appeared in search results, in the prompt
  (including chat history) or in answers. For example, after the budget document was deselected,
  "Repeat the budget figure for Elmspire that you mentioned earlier" was correctly declined.
- **Gate criteria 1 and 3** (re-verified on the final code): uploads produce only valid passages, and
  citation clicks hit the exact passage in 20 of 20 repetitions (95th percentile 54 ms, target 300 ms).

## What the results do not show

- **Answer coverage.** Of 14 answerable multi-document questions, 7 were answered completely and
  correctly, with every expected fact present. 7 were declined:
  - **All 6** "Which security requirement applies to service X?" questions. Answering needs two hops:
    from the service to its port in one document, then from the port to its rule in another. The
    search step found the first passage but not the second, so the assistant correctly declined
    instead of guessing.
  - **One** "Who leads the team that owns service X?" question, although both passages were
    available.

  The gate deliberately rewards caution over guessing. Declining is safe, but it is a usability gap
  for questions that chain facts across documents.
- **Sample size.** 50 cases give a clear signal but limited statistical precision. One wrong answer
  among the 25 unanswerable cases would already fail the gate.
- **Synthetic data.** Real enterprise documents are longer, messier and contain tables and scans.
  Results on them may differ.
- **Speed.** Time to the first answer word (target 2.5 s) is not part of Gate v1.0 and was not
  measured here.
- **Judge model.** An LLM judge can be wrong in either direction. Run 2 shows one such case, which was
  caught and corrected.

## Next steps

1. **Improve multi-hop answers.** Add a two-step search for questions that chain facts across
   documents, and track answer coverage as a reported metric next to the gate. This affects retrieval
   code, so the full judged run is repeated afterwards.
2. **Enable the evaluation in CI.** Add the Workload Identity variables so the release-gate run works
   from GitHub without personal credentials.
3. **Re-run on the merged commit.** The passing run was made on the final code before it was
   committed. Repeating it on the merged commit ties the report to an exact commit ID.
4. **Remaining live checks.** Sign-in through the corporate identity provider and purge on a real
   Cloud Storage bucket still need a test tenant and an approved bucket (task 001 T046).

## Reproducing the run

```bash
gcloud auth application-default login
pnpm db:test:up
TEST_DATABASE_URL=postgres://everlast:everlast@127.0.0.1:54329/everlast \
VERTEX_PROJECT=<project> VERTEX_LOCATION=europe-west4 \
DOCUMENT_AI_PROCESSOR_NAME=projects/<project>/locations/eu/processors/<id> \
pnpm eval:judged
```

The run writes the report to `reports/eval-report-v1.{json,md}` and appends a line to
`reports/gate-audit.jsonl`.
