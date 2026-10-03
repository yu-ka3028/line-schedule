import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeEach(() => {
  process.env.LINE_ASYNC_PROCESSING_ENABLED = 'true';
});

afterEach(() => {
  delete process.env.LINE_ASYNC_PROCESSING_ENABLED;
});

const request = (body = JSON.stringify({ jobId: id })) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'upstash-signature': 'sig' },
  body,
});

describe('QStash jobs webhook', () => {
  it('does not access jobs store or executor when receiver flag is off', async () => {
    delete process.env.LINE_ASYNC_PROCESSING_ENABLED;
    const jobs = store({ claim: vi.fn() });
    const executor = vi.fn();
    const verify = vi.fn();
    const response = await app(jobs, verify, executor).request(
      '/webhooks/qstash/jobs',
      request(),
    );
    expect(response.status).toBe(200);
    expect(verify).not.toHaveBeenCalled();
    expect(jobs.claim).not.toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
  });

  it('does not access outbox or verify when dispatcher flag is off', async () => {
    delete process.env.LINE_ASYNC_PROCESSING_ENABLED;
    const outbox = {
      claimBatch: vi.fn(),
      claim: vi.fn(),
      finish: vi.fn(),
    };
    const publisher = { publish: vi.fn() };
    const verify = vi.fn();
    const response = await createApp(undefined, {
      qstash: { config, verifier: { verify }, outbox, publisher },
    }).request('/webhooks/qstash/outbox-dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'outbox_dispatch' }),
    });
    expect(response.status).toBe(200);
    expect(verify).not.toHaveBeenCalled();
    expect(outbox.claimBatch).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('verifies strict dispatcher payload and recovers a claimed lease', async () => {
    process.env.LINE_ASYNC_PROCESSING_ENABLED = 'true';
    const outbox = {
      claimBatch: vi.fn().mockResolvedValue([{ jobId: id, token: 'lease' }]),
      finish: vi.fn().mockResolvedValue('published'),
      claim: vi.fn(),
    };
    const publisher = {
      publish: vi.fn().mockResolvedValue({ messageId: 'm1' }),
    };
    const verify = vi.fn().mockResolvedValue(true);
    const response = await createApp(undefined, {
      qstash: { config, verifier: { verify }, outbox, publisher },
    }).request('/webhooks/qstash/outbox-dispatch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'upstash-signature': 'sig',
      },
      body: JSON.stringify({ kind: 'outbox_dispatch' }),
    });
    expect(response.status).toBe(200);
    expect(verify).toHaveBeenCalledOnce();
    expect(publisher.publish).toHaveBeenCalledWith(id);
    expect(outbox.finish).toHaveBeenCalledWith(id, 'lease', {
      messageId: 'm1',
    });
  });

  it('rejects extra dispatcher payload fields after signature verification', async () => {
    process.env.LINE_ASYNC_PROCESSING_ENABLED = 'true';
    const outbox = { claimBatch: vi.fn(), finish: vi.fn(), claim: vi.fn() };
    const response = await createApp(undefined, {
      qstash: {
        config,
        verifier: { verify: vi.fn().mockResolvedValue(true) },
        outbox,
      },
    }).request('/webhooks/qstash/outbox-dispatch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'upstash-signature': 'sig',
      },
      body: JSON.stringify({ kind: 'outbox_dispatch', extra: true }),
    });
    expect(response.status).toBe(400);
    expect(outbox.claimBatch).not.toHaveBeenCalled();
  });
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

  it('maps a verifier throw to 401 before parsing, storing, or executing', async () => {
    const jobs = store();
    const executor = vi.fn();
    const verify = vi.fn().mockRejectedValue(new Error('invalid signature'));
    const response = await app(jobs, verify, executor).request(
      '/webhooks/qstash/jobs',
      request('{invalid'),
    );
    expect(response.status).toBe(401);
    expect(jobs.claim).not.toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
  });

  it.each(['busy', 'not_due', 'not_found', 'inactive', 'expired'] as const)(
    'handles %s without executing',
    async (outcome) => {
      const jobs = store({ claim: vi.fn().mockResolvedValue({ outcome }) });
      const executor = vi.fn();
      const response = await app(jobs, undefined, executor).request(
        '/webhooks/qstash/jobs',
        request(),
      );
      expect(response.status).toBe(
        outcome === 'busy' || outcome === 'not_due' ? 500 : 200,
      );
      expect(executor).not.toHaveBeenCalled();
    },
  );

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

  it('requeues LINE executor failures and resets outbox retry state', async () => {
    const jobs = store({
      claim: vi.fn().mockResolvedValue({
        outcome: 'claimed',
        token: 'token',
        jobType: 'line_event_process',
      }),
      failOrRequeue: vi.fn().mockResolvedValue('requeued'),
      failOrRequeueLineEvent: vi.fn().mockResolvedValue('requeued'),
    });
    const response = await app(
      jobs,
      undefined,
      vi.fn().mockRejectedValue(new Error('secret')),
    ).request('/webhooks/qstash/jobs', request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'job_retryable_failure' });
    expect(jobs.failOrRequeueLineEvent).toHaveBeenCalledWith(
      id,
      'token',
      'handler_unavailable',
    );
  });

  it('keeps calendar failure handling on the existing RPC', async () => {
    const jobs = store({
      claim: vi.fn().mockResolvedValue({
        outcome: 'claimed',
        token: 'token',
        jobType: 'calendar_create',
      }),
      failOrRequeue: vi.fn().mockResolvedValue('requeued'),
      failOrRequeueLineEvent: vi.fn(),
    });
    const response = await app(
      jobs,
      undefined,
      vi.fn().mockRejectedValue(new Error('secret')),
    ).request('/webhooks/qstash/jobs', request());
    expect(response.status).toBe(500);
    expect(jobs.failOrRequeue).toHaveBeenCalledWith(
      id,
      'token',
      'handler_unavailable',
    );
    expect(jobs.failOrRequeueLineEvent).not.toHaveBeenCalled();
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
