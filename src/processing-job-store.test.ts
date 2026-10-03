import { describe, expect, it, vi } from 'vitest';

import { createSupabaseProcessingJobStore } from './processing-job-store.js';

const id = '00000000-0000-4000-8000-000000000001';
const token = '00000000-0000-4000-8000-000000000002';

function client(data: unknown) {
  return { rpc: vi.fn().mockResolvedValue({ data, error: null }) };
}

describe('processing job store', () => {
  it('rejects unknown RPC outcomes', async () => {
    await expect(
      createSupabaseProcessingJobStore(client([{ outcome: 'surprise' }])).claim(
        id,
      ),
    ).rejects.toThrow('invalid processing job claim outcome');
  });

  it('validates IDs and tokens before calling RPC', async () => {
    const rpc = vi.fn();
    const store = createSupabaseProcessingJobStore({ rpc });
    await expect(store.claim('not-an-id')).rejects.toThrow('invalid job id');
    await expect(store.succeed(id, 'not-a-token')).rejects.toThrow(
      'invalid processing token',
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('requires a valid token for claimed outcomes', async () => {
    await expect(
      createSupabaseProcessingJobStore(
        client([{ outcome: 'claimed', processing_token: 'bad' }]),
      ).claim(id),
    ).rejects.toThrow('invalid processing token');
  });

  it('uses the line retry RPC for atomic outbox recovery', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ outcome: 'requeued' }],
      error: null,
    });
    const store = createSupabaseProcessingJobStore({ rpc });
    await expect(
      store.failOrRequeueLineEvent?.(id, token, 'handler_unavailable'),
    ).resolves.toBe('requeued');
    expect(rpc).toHaveBeenCalledWith('fail_or_requeue_line_event_job', {
      p_job_id: id,
      p_processing_token: token,
      p_error: 'handler_unavailable',
    });
  });

  it('rejects unsafe error codes', async () => {
    const rpc = vi.fn();
    const store = createSupabaseProcessingJobStore({ rpc });
    await expect(
      store.failOrRequeue(id, token, 'secret detail'),
    ).rejects.toThrow('invalid processing job error code');
    expect(rpc).not.toHaveBeenCalled();
  });
});
