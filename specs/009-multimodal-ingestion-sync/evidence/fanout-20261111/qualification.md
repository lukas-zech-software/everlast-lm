# Task 009 local qualification and live handoff

Scope FR-SI-01/02/04/05, FR-GC-03, NFR-SEC-01/02, C-01/C-02, SC-001/002, Gate v3.0 #1.
Prepared implementation start `5ff6d75d6ad820b83a1f4cad1170d8fd26678f73`.
Live [T049 and T050](../../tasks.md) remain open.

## Freeze the live fixture set

- **30-minute cohort.** Approve one immutable, fully decodable, exactly 1,800,000
  ms native FLAC of representative non-sensitive spoken audio, and its explicit
  language code. Use the same bytes for attempt IDs 1–20 in serial order.
  Declare the target environment, provider `speech.googleapis.com/v2`, model
  `chirp_2`, approved EU region, candidate SHA and API/worker/render revisions
  before the first accepted attempt. Use a dedicated fixture owner/notebook and
  a bounded temporary storage prefix. Retain rejected uploads separately,
  every accepted attempt, failures, unfinished states, and cleanup outcomes.
- **Interview citation.** Approve a separate real 600,000 ms Interview.mp3 with a
  documented spoken statement beginning at 255000 ms. Record its hash/bytes,
  language, exact quote and question. Upload as the fixture Owner, wait for
  Ready, and verify every transcript chunk has a bounded C-01 time_span. Ask
  the known question, click the corresponding citation, verify Interview.mp3
  and the 04:15 highlight/scroll plus actual player seek. Retain transcript,
  selected citation, seek timestamp and browser evidence. Also record a
  permitted video with an authorized caption track or audio stream and its
  timestamp click. The local Interview MP3 fixture contains synthetic header
  frames with a scripted 10-minute ASR transcript. A separate playable WAV test
  checks actual local seek to 255 seconds.
- **Drive and Picker.** Use a test Google account and disposable delegated
  Docs/Slides with known paragraphs, tables, speaker notes and descriptions.
  Record the file IDs, Owner, consent scope and verified OAuth redirect/webhook
  URLs in the private workload declaration. Review OAuth client plus Secret
  Manager client/refresh-token configuration, matching Picker API key/App ID,
  and target access to Drive/Picker. Test initial delegated selection, replacement,
  identical sync, invalid callback and revocation during publish. Remove fixture
  channels and authorization after evidence capture.
- **Screening and renderer.** Record either the existing approved regional Model
  Armor template ID or the reviewed managed template plan, with matching worker
  region and fail-closed policy. Verify both a clean article and known injection
  as the fixture owner. Record the existing `everlast-render` job ID/location,
  image digest, worker invocation permissions and isolated generation-bound GCS
  input/output prefix. Exercise Office rendering and M4A normalization through
  the configured job, and retain cleanup. Keep fallback/native rendering
  observations separate from job execution.
- **Release candidate.** Inspect the reviewed target configuration, immutable
  deployed revisions and same-candidate deterministic results before scheduling
  the separately approved 50-case judged sample. Include the 006 Ready hook and
  007 normalization integration or record their absence before release tests.

## Create and verify the declaration

Set these values from the approved fixture and target. Use the
application's approved region (the existing dev plan uses `europe-west4`).
The fixture and declaration may contain private workload information and belong
in the scoped evidence location. Continue to declaration only after the local
decode command succeeds.

```bash
audio_fixture=/absolute/path/to/approved-30-minute.flac
cohort_dir=/absolute/path/to/approved-workload-evidence
audio_language=en-US
speech_region=europe-west4
target_environment=replace-with-reviewed-candidate-environment
mkdir -p "$cohort_dir"
ffmpeg -v error -xerror -i "$audio_fixture" -map 0:a:0 -f null -
node --input-type=module - "$audio_fixture" "$cohort_dir/plan.json" "$audio_language" "$speech_region" "$target_environment" <<'NODE'
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const [fixturePath, planPath, languageCode, region, environment] = process.argv.slice(2);
const bytes = readFileSync(fixturePath);
const plan = {
  fixture: {
    name: basename(fixturePath),
    durationMs: 1_800_000,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    codec: "flac",
    languageCode,
    bytes: bytes.length,
  },
  repetitions: 20,
  provider: { service: "speech.googleapis.com/v2", model: "chirp_2", region },
  environment,
  concurrency: 1,
  declaredAt: new Date().toISOString(),
};
writeFileSync(planPath, JSON.stringify(plan, null, 2) + "\n", { flag: "wx" });
NODE
node scripts/eval-v3-audio.mjs --validate-only --plan "$cohort_dir/plan.json" --fixture "$audio_fixture"
```

Archive the validated declaration and candidate/target metadata before execution.
After approval, the direct provider collector uses the same command with
`--out "$cohort_dir"` in place of `--validate-only`, with the matching project,
workspace bucket, Speech location and keyless ADC. Preserve its checkpoints
and actual object cleanup. The direct runner's accept-to-timestamped-transcript
clock starts immediately after fixture upload because it calls Speech itself.
Separately capture acceptance after upload, queue and preprocessing transitions,
and complete validated transcript availability where the deployed ingestion
path uses them. Include queue/preprocessing and exclude upload/indexing from
the product latency. Keep the declared 20 IDs, nearest-rank P95 ≤45,000 ms,
and positive infinity for accepted attempts that fail or never finish. If
an incomplete run has fewer than 20 observations, retain it and report the
cohort unavailable.

## Serial integration

Apply the [three D21 deletions](d21-media-fixture-deletions.patch) together
with the API media-test refactor. Apply the [owning FR card flow-back](fr-card-audio-qualification.patch)
through the coordinator's shared-file slot. The API fixture uses the public
DB publication port and keeps real upload receipt, C-01 DTOs and authorized
storage delivery. The actual worker processing, replacement fencing and
browser behavior are covered in their owning suites. Remaining cross-app test
fixtures and shared startup composition remain in the coordinator queue.

## Local results — 2026-11-11

| Check | Result |
| --- | --- |
| Red → Green (T067/T068, FR-SI-01, SC-002) | Before the runner change both new CLI tests failed with the early missing-cloud-configuration error. After the change the benchmark suite passed, including hash-matched shorter/malformed bytes, supported offline preflight and unsupported concurrency. |
| Real local decode and preflight | FFmpeg generated and decoded a synthetic 16 kHz FLAC. FFprobe reported 1800.000000 seconds. The documented declaration command returned `VALIDATED` for 20 attempts; no ASR was requested. Fixture SHA-256 `4e0bdfdd9372a16c9d420392abbfcb9ce14329a7ec0ed36efb1f0630333a7b25`. |
| Worker, API, evaluator, renderer | 143/143 passed across 21 suites on dedicated PostgreSQL 16/pgvector. Includes audio/video adapters, sync fencing and durable Guide events, prior PDF/text, authorization/revocation, mixed-modality deterministic evaluation and local render/screening configuration. |
| Integrated Chromium | 15/15 passed with labelled provider doubles. MP3 citation opened and highlighted 04:15, the WAV player sought to 255 seconds, captions linked to the correct video time, successful re-sync replaced May with June and upstream 503 preserved the prior committed revision. Initial sandboxed execution failed at macOS Mach-port registration; the localhost-only retry passed. |
| Deterministic evaluation (NFR-EVAL-02/04) | 222-case corpus plus 60 adversarial drafts, citation precision 160/160, leakage 0 and 0 invalid drafts published. |
| Infrastructure | OpenTofu backend-free, lockfile-read-only initialization, seven mocked policy cases, validation and formatting passed. No resources applied. |
| CC-09 branch | 39 architecture fixture tests and the feature-artifact check passed. The full graph reported the three stale rows reserved for serialized deletion; no new violations. |
| CC-09 composed candidate | In a separate validation tree, both scoped patches applied cleanly. Graph and artifact checks against the prepared start, lint/type compilation, spec integrity and diff validation passed with 181 remaining exact legacy exceptions. |
| Live acceptance | UNAVAILABLE. Actual provider observations, approved representative FLAC and Interview.mp3, delegated documents and target checks, deployed timestamp/timing evidence, and the fixed judged sample remain pending. |
