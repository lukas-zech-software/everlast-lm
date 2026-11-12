# Gate v1.0 evaluation report (release)

- **State:** GateFailed
- **Commit:** ef28a5c21ef9468772c539f9bcaf4df6d2c31b39+dirty
- **Timestamp:** 2026-11-06T10:26:36.549Z
- **Dataset:** v1.0.0 (35f54e2553cd), counts {"unanswerable":25,"deselection":11,"history":4,"synthesis":14,"total":50}
- **Judged sample:** 50 cases (stratified-largest-remainder-v1): NEG-003, NEG-007, NEG-012, NEG-016, NEG-020, NEG-025, NEG-029, NEG-034, NEG-038, NEG-042, NEG-047, NEG-051, NEG-056, NEG-060, NEG-064, NEG-069, NEG-073, NEG-078, NEG-082, NEG-086, NEG-091, NEG-095, NEG-100, NEG-104, NEG-108, DES-003, DES-007, DES-012, DES-017, DES-021, DES-026, DES-030, HIS-003, HIS-008, HIS-013, HIS-018, SYN-003, SYN-007, SYN-011, SYN-016, SYN-020, SYN-024, SYN-028, SYN-033, SYN-037, SYN-041, SYN-046, SYN-050, SYN-054, SYN-058
- **Models:** chat=vertex:europe-west4:gemini-2.5-flash, embedding=vertex:europe-west4:gemini-embedding-001, judge=vertex:europe-west4:gemini-2.5-flash-lite, ocr=none

| Criterion | Status | Detail |
| :-- | :-- | :-- |
| #1 Upload → valid C-01 | pending | 10 corpus documents ingested; UI evidence: missing |
| #2 NFR-EVAL-01..04 | pass | see metrics |
| #3 Citation navigation | pending | missing UI evidence (run pnpm test:e2e) |

| Metric | Value | Status | Numerator/Denominator | Failing cases |
| :-- | :-- | :-- | :-- | :-- |
| citation_precision | 1 | pass | 22/22 |  |
| scoping_leakage_count | 0 | pass | —/— |  |
| hallucination_rate | 0 | pass | 0/22 |  |
| semantic_support_rate | 1 | pass | 22/22 |  |
| negative_rejection_rate | 1 | pass | 25/25 |  |

## NFR-SEC-01 preflight

| Check | Status | Detail |
| :-- | :-- | :-- |
| SEC-01 No consumer/developer API key in the runtime environment | pass | none present |
| SEC-VERTEX-chat Grounded chat (vertex:europe-west4:gemini-2.5-flash) uses Vertex AI with ADC in europe-west4 | pass | vertexai=true apiKey=none location=europe-west4 project=lukas-gcloud-playground |
| SEC-VERTEX-embedding Embeddings (gemini-embedding-001) uses Vertex AI with ADC in europe-west4 | pass | vertexai=true apiKey=none location=europe-west4 project=lukas-gcloud-playground |
| SEC-VERTEX-judge Eval judge (gemini-2.5-flash-lite) uses Vertex AI with ADC in europe-west4 | pass | vertexai=true apiKey=none location=europe-west4 project=lukas-gcloud-playground |
| SEC-OCR OCR processor configured | unavailable | no Document AI processor configured: scanned pages cannot be OCR'd |
| SEC-ADC Keyless Application Default Credentials available | pass | access token obtained |

## FR-GC-07 response length (v2.0 release metric)

- **Status:** pass
- **Shorter / Default:** 43 % (≤ 50 %) · **Longer / Default:** 241 % (≥ 150 %)
- **Sample case IDs:** SYN-028, SYN-033, SYN-037, SYN-041, SYN-046, SYN-050, SYN-054, SYN-058
- **Excluded (Default refusal):** SYN-003, SYN-007, SYN-011, SYN-016, SYN-020, SYN-024
- **Generation parameters:** {"style":"default","lengths":["default","shorter","longer"],"token_count":"Intl.Segmenter word-like segments, citation badges removed","history":"none (empty thread per answer)","aggregation":"mean of per-case ratios","eligibility":"answerable synthesis cases; Default refusals excluded (excluded_case_ids)"}

## Failures

- preflight SEC-OCR unavailable: no Document AI processor configured: scanned pages cannot be OCR'd
