# Gate v1.0 evaluation report (release)

- **State:** GatePassed
- **Commit:** 8ca81cab1e6cf38ce076072af06d1daf93af363c+dirty
- **Timestamp:** 2026-10-19T12:57:44.181Z
- **Dataset:** v1.0.0 (35f54e2553cd), counts {"unanswerable":25,"deselection":11,"history":4,"synthesis":14,"total":50}
- **Judged sample:** 50 cases (stratified-largest-remainder-v1): NEG-003, NEG-007, NEG-012, NEG-016, NEG-020, NEG-025, NEG-029, NEG-034, NEG-038, NEG-042, NEG-047, NEG-051, NEG-056, NEG-060, NEG-064, NEG-069, NEG-073, NEG-078, NEG-082, NEG-086, NEG-091, NEG-095, NEG-100, NEG-104, NEG-108, DES-003, DES-007, DES-012, DES-017, DES-021, DES-026, DES-030, HIS-003, HIS-008, HIS-013, HIS-018, SYN-003, SYN-007, SYN-011, SYN-016, SYN-020, SYN-024, SYN-028, SYN-033, SYN-037, SYN-041, SYN-046, SYN-050, SYN-054, SYN-058
- **Models:** chat=vertex:europe-west4:gemini-2.5-flash, embedding=vertex:europe-west4:gemini-embedding-001, judge=vertex:europe-west4:gemini-2.5-flash-lite, ocr=documentai:eu:7e8fb3b073398d36

| Criterion | Status | Detail |
| :-- | :-- | :-- |
| #1 Upload → valid C-01 | pass | 10 corpus documents ingested; UI evidence: GATE-1: PDF and MD uploaded through the UI yield only valid C-01 chunks (passed, 1704 ms) |
| #2 NFR-EVAL-01..04 | pass | see metrics |
| #3 Citation navigation | pass | GATE-3: citation click scrolls to and highlights the exact chunk element in 20/20 repetitions (passed, 2217 ms) |

| Metric | Value | Status | Numerator/Denominator | Failing cases |
| :-- | :-- | :-- | :-- | :-- |
| citation_precision | 1 | pass | 20/20 |  |
| scoping_leakage_count | 0 | pass | —/— |  |
| hallucination_rate | 0 | pass | 0/20 |  |
| semantic_support_rate | 1 | pass | 20/20 |  |
| negative_rejection_rate | 1 | pass | 25/25 |  |

## NFR-SEC-01 preflight

| Check | Status | Detail |
| :-- | :-- | :-- |
| SEC-01 No consumer/developer API key in the runtime environment | pass | none present |
| SEC-VERTEX-chat Grounded chat (vertex:europe-west4:gemini-2.5-flash) uses Vertex AI with ADC in europe-west4 | pass | vertexai=true apiKey=none location=europe-west4 project=lukas-gcloud-playground |
| SEC-VERTEX-embedding Embeddings (gemini-embedding-001) uses Vertex AI with ADC in europe-west4 | pass | vertexai=true apiKey=none location=europe-west4 project=lukas-gcloud-playground |
| SEC-VERTEX-judge Eval judge (gemini-2.5-flash-lite) uses Vertex AI with ADC in europe-west4 | pass | vertexai=true apiKey=none location=europe-west4 project=lukas-gcloud-playground |
| SEC-OCR OCR runs on Document AI (enterprise) in the EU region map or under a recorded region exception | pass | location eu (EU region map, D3) |
| SEC-ADC Keyless Application Default Credentials available | pass | access token obtained |
