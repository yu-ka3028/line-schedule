import { describe, expect, it, vi } from 'vitest';

import { SupabaseLineEventProcessingStore } from './line-event-processing-store.js';

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function createClientMock(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { client: { rpc }, rpc };
}

describe('SupabaseLineEventProcessingStore', () => {
  it('reads the minimal record through the processing-job RPC', async () => {
    const { client, rpc } = createClientMock([
      { user_id: USER_ID, payload_ciphertext: 'ciphertext' },
    ]);
    const store = new SupabaseLineEventProcessingStore(client);

    await expect(store.read(JOB_ID, TOKEN)).resolves.toEqual({
      userId: USER_ID,
      payloadCiphertext: 'ciphertext',
    });
    expect(rpc).toHaveBeenCalledWith('read_line_event_for_processing_job', {
      p_job_id: JOB_ID,
      p_processing_token: TOKEN,
    });
  });

  it.each(['lease expired', 'job expired', 'token mismatch'])(
    'returns no event when the RPC rejects a %s contract',
    async () => {
      const { client } = createClientMock([]);
      const store = new SupabaseLineEventProcessingStore(client);

      await expect(store.read(JOB_ID, TOKEN)).resolves.toBeNull();
    },
  );

  it('validates UUID inputs before calling the RPC', async () => {
    const { client, rpc } = createClientMock([]);
    const store = new SupabaseLineEventProcessingStore(client);

    await expect(store.read('not-a-uuid', TOKEN)).rejects.toThrow(
      'invalid job id',
    );
    await expect(store.read(JOB_ID, 'not-a-uuid')).rejects.toThrow(
      'invalid processing token',
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('validates the returned user UUID and ciphertext', async () => {
    const { client } = createClientMock([
      { user_id: 'internal-user', payload_ciphertext: 'ciphertext' },
    ]);
    const store = new SupabaseLineEventProcessingStore(client);

    await expect(store.read(JOB_ID, TOKEN)).rejects.toThrow(
      'invalid line event processing RPC response',
    );
  });

  it('propagates RPC errors without exposing event data', async () => {
    const error = new Error('rpc failed');
    const { client } = createClientMock(null, error);
    const store = new SupabaseLineEventProcessingStore(client);

    await expect(store.read(JOB_ID, TOKEN)).rejects.toBe(error);
  });
});
