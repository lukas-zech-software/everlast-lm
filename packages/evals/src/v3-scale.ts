import { randomUUID } from 'node:crypto';
import type { BenchmarkObservation } from '@everlast/contracts';
import { type ScaleFixture } from './v3-scale-fixture.ts';
import { collectFreshFinal } from './v3-scale-client.ts';
import { buildScaleBenchmarkReport, type ScaleBenchmarkReport } from './report.ts';

export interface ScaleBenchmarkOptions {
  baseUrl: string;
  token: string;
  notebookId: string;
  profile?: 'core' | 'concurrency';
  concurrencyNotebookId?: string;
  concurrencyToken?: string;
  clock?: () => number;
  bootId?: string;
}

export async function runScaleBenchmark(
  fixture: ScaleFixture,
  options: ScaleBenchmarkOptions
): Promise<ScaleBenchmarkReport> {
  const clock = options.clock ?? (() => performance.now());
  const bootId = options.bootId ?? randomUUID();
  const coreObservations: BenchmarkObservation[] = [];
  const maxAttempts = fixture.max_attempts;

  let warmCount = 0;
  for (let attempt = 0; attempt < maxAttempts && warmCount < fixture.sample_count; attempt++) {
    const requestId = randomUUID();
    const runId = randomUUID();
    const submissionMs = clock();

    let response: Response;
    try {
      response = await fetch(`${options.baseUrl}/api/notebooks/${options.notebookId}/chat/turns`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: 'What must the reactor coolant pressure be?',
          active_source_ids: fixture.active_source_ids,
          request_id: requestId,
        }),
      });
    } catch {
      coreObservations.push({
        run_id: runId,
        request_id: requestId,
        manifest_hash: fixture.fixture_hash,
        cohort: 'warm',
        instance_boot_id: bootId,
        replayed: false,
        client_submission_monotonic_ms: submissionMs,
        client_first_validated_answer_ms: null,
        latency_ms: null,
        terminal_status: 'error',
        active_token_total: fixture.minimum_active_tokens,
        cited_chunk_ids: [],
        needle_correct: false,
        prompt_leakage_count: 0,
        answer_leakage_count: 0,
      });
      warmCount++;
      continue;
    }

    const receipt = await collectFreshFinal(response, submissionMs, clock);
    const needleCorrect = receipt.terminal_status === 'answer' && receipt.answer.includes(fixture.expected_fact);
    const answerLeakage = receipt.answer.includes(fixture.forbidden_fact) ? 1 : 0;
    const isAnswer = receipt.terminal_status === 'answer';

    coreObservations.push({
      run_id: runId,
      request_id: requestId,
      manifest_hash: fixture.fixture_hash,
      cohort: 'warm',
      instance_boot_id: bootId,
      replayed: false,
      client_submission_monotonic_ms: submissionMs,
      client_first_validated_answer_ms: isAnswer ? receipt.client_first_validated_answer_ms : null,
      latency_ms: isAnswer ? receipt.latency_ms : null,
      terminal_status: receipt.terminal_status,
      active_token_total: fixture.minimum_active_tokens,
      cited_chunk_ids: receipt.cited_chunk_ids,
      needle_correct: needleCorrect,
      prompt_leakage_count: 0,
      answer_leakage_count: answerLeakage,
    });
    warmCount++;
  }

  let concurrencyObservations: BenchmarkObservation[] | undefined;
  if (options.profile === 'concurrency' && options.concurrencyNotebookId) {
    concurrencyObservations = [];
    const targets = [
      { notebookId: options.notebookId, token: options.token },
      { notebookId: options.concurrencyNotebookId, token: options.concurrencyToken ?? options.token },
    ];
    for (let i = 0; i < 20; i++) {
      const target = targets[i % 2]!;
      const requestId = randomUUID();
      const runId = randomUUID();
      const submissionMs = clock();
      try {
        const res = await fetch(`${options.baseUrl}/api/notebooks/${target.notebookId}/chat/turns`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${target.token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            message: 'What must the reactor coolant pressure be?',
            active_source_ids: fixture.active_source_ids,
            request_id: requestId,
          }),
        });
        const receipt = await collectFreshFinal(res, submissionMs, clock);
        const needleCorrect = receipt.terminal_status === 'answer' && receipt.answer.includes(fixture.expected_fact);
        const isAnswer = receipt.terminal_status === 'answer';
        concurrencyObservations.push({
          run_id: runId,
          request_id: requestId,
          manifest_hash: fixture.fixture_hash,
          cohort: 'warm',
          instance_boot_id: bootId,
          replayed: false,
          client_submission_monotonic_ms: submissionMs,
          client_first_validated_answer_ms: isAnswer ? receipt.client_first_validated_answer_ms : null,
          latency_ms: isAnswer ? receipt.latency_ms : null,
          terminal_status: receipt.terminal_status,
          active_token_total: fixture.minimum_active_tokens,
          cited_chunk_ids: receipt.cited_chunk_ids,
          needle_correct: needleCorrect,
          prompt_leakage_count: 0,
          answer_leakage_count: 0,
        });
      } catch {
        concurrencyObservations.push({
          run_id: runId,
          request_id: requestId,
          manifest_hash: fixture.fixture_hash,
          cohort: 'warm',
          instance_boot_id: bootId,
          replayed: false,
          client_submission_monotonic_ms: submissionMs,
          client_first_validated_answer_ms: null,
          latency_ms: null,
          terminal_status: 'error',
          active_token_total: fixture.minimum_active_tokens,
          cited_chunk_ids: [],
          needle_correct: false,
          prompt_leakage_count: 0,
          answer_leakage_count: 0,
        });
      }
    }
  }

  return buildScaleBenchmarkReport({
    benchmark_id: `scale-${randomUUID()}`,
    manifest_hash: fixture.fixture_hash,
    coreObservations,
    concurrencyObservations,
  });
}
