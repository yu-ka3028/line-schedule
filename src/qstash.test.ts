import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';
import type { ProcessingJobStore } from './processing-job-store.js';

const id = '00000000-0000-4000-8000-000000000001';
const config = {
  currentSigningKey: 'current',
  nextSigningKey: 'next',
  receiverUrl: 'https://example.test/webhooks/qstash/jobs',
};

function app(
  store: ProcessingJobStore,
  verifier = vi.fn().mockResolvedValue(true),
  executor = vi.fn().mockResolvedValue(undefined),
) {
  return createApp(undefined, {
    qstash: { config, verifier: { verify: verifier }, jobs: store, executor },
  });
}
function store(
  overrides: Partial<ProcessingJobStore> = {},
): ProcessingJobStore {
  return {
    claim: vi.fn().mockResolvedValue({ outcome: 'terminal' }),
    succeed: vi.fn(),
    failOrRequeue: vi.fn(),
    ...overrides,
  };
}

const request = (body = JSON.stringify({ jobId: id })) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'upstash-signature': 'sig' },
  body,
});

describe('QStash jobs webhook', () => {
  it('verifies before parsing or accessing the store', async () => {
    const jobs = store();
    const verify = vi.fn().mockResolvedValue(false);
    const response = await app(jobs, verify).request(
      '/webhooks/qstash/jobs',
      request('{invalid'),
    );
    expect(response.status).toBe(401);
    expect(jobs.claim).not.toHaveBeenCalled();
  });

  it('does not execute terminal jobs', async () => {
    const jobs = store();
    const executor = vi.fn();
    const response = await app(jobs, undefined, executor).request(
      '/webhooks/qstash/jobs',
      request(),
    );
    expect(response.status).toBe(200);
    expect(executor).not.toHaveBeenCalled();
  });

  it('claims and completes a job with its token', async () => {
    const jobs = store({
      claim: vi.fn().mockResolvedValue({ outcome: 'claimed', token: 'token' }),
      succeed: vi.fn().mockResolvedValue('succeeded'),
    });
    const executor = vi.fn().mockResolvedValue(undefined);
    const response = await app(jobs, undefined, executor).request(
      '/webhooks/qstash/jobs',
      request(),
    );
    expect(response.status).toBe(200);
    expect(executor).toHaveBeenCalledWith({ jobId: id }, 'token');
    expect(jobs.succeed).toHaveBeenCalledWith(id, 'token');
  });

  it('requeues executor failures without exposing the error', async () => {
    const jobs = store({
      claim: vi.fn().mockResolvedValue({ outcome: 'claimed', token: 'token' }),
      failOrRequeue: vi.fn().mockResolvedValue('requeued'),
    });
    const response = await app(
      jobs,
      undefined,
      vi.fn().mockRejectedValue(new Error('secret')),
    ).request('/webhooks/qstash/jobs', request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'job_retryable_failure' });
    expect(jobs.failOrRequeue).toHaveBeenCalledWith(
      id,
      'token',
      'handler_unavailable',
    );
  });

  it('rejects malformed payloads after verification', async () => {
    const jobs = store();
    const response = await app(jobs).request(
      '/webhooks/qstash/jobs',
      request(JSON.stringify({ jobId: id, extra: true })),
    );
    expect(response.status).toBe(400);
    expect(jobs.claim).not.toHaveBeenCalled();
  });
});
