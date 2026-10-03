import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { SupabaseUsageLogStore } from './usage-log-store.js';

describe('SupabaseUsageLogStore', () => {
  it('stores the sync operation and allowlisted metadata', async () => {
    const insert = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = {
      from: vi.fn(() => ({ insert })),
    } as unknown as SupabaseClient;
    const store = new SupabaseUsageLogStore(client);
    const metadata = {
      schema_version: 1 as const,
      outcome: 'replied',
      total_ms: 42,
      persistence_ms: 7,
      reply_ms: 10,
    };

    await store.record(metadata);

    expect(client.from).toHaveBeenCalledWith('usage_logs');
    expect(insert).toHaveBeenCalledWith({
      operation: 'sync_text_webhook',
      quantity: 1,
      estimated_cost_yen: 0,
      metadata,
    });
    expect(insert.mock.calls[0][0]).not.toHaveProperty('text');
    expect(insert.mock.calls[0][0]).not.toHaveProperty('replyToken');
    expect(insert.mock.calls[0][0]).not.toHaveProperty('userId');
  });

  it('propagates insert errors without exposing payload details', async () => {
    const error = { code: '42501', message: 'permission denied' };
    const insert = vi.fn().mockResolvedValue({ data: null, error });
    const client = {
      from: vi.fn(() => ({ insert })),
    } as unknown as SupabaseClient;
    const store = new SupabaseUsageLogStore(client);

    await expect(
      store.record({
        schema_version: 1,
        outcome: 'replied',
        total_ms: 1,
        persistence_ms: 0,
        reply_ms: 1,
      }),
    ).rejects.toEqual(error);
  });
});
