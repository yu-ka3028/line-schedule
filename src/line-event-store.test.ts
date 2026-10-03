import { randomBytes } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { decryptWebhookPayload } from './crypto.js';
import { SupabaseLineEventStore } from './line-event-store.js';

function createClientMock() {
  const userUpsert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi
        .fn()
        .mockResolvedValue({ data: { id: 'user-row-1' }, error: null }),
    })),
  }));
  const eventInsert = vi
    .fn<
      (...args: unknown[]) => {
        select: () => { single: () => Promise<unknown> };
      }
    >()
    .mockImplementation(() => ({
      select: vi.fn(() => ({
        single: vi
          .fn()
          .mockResolvedValue({ data: { id: 'event-row-1' }, error: null }),
      })),
    }));
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'users') return { upsert: userUpsert };
      if (table === 'inbound_events') return { insert: eventInsert };
      throw new Error(`unexpected table: ${table}`);
    }),
  } as unknown as SupabaseClient;
  return { client, userUpsert, eventInsert };
}

const userEvent = {
  type: 'message' as const,
  webhookEventId: 'event-user',
  timestamp: 1710000000000,
  source: { type: 'user' as const, userId: 'U123' },
  replyToken: 'reply-token',
  message: { id: 'message-1', type: 'text' as const, text: 'private text' },
};

function followEvent(webhookEventId: string) {
  return {
    type: 'follow' as const,
    webhookEventId,
    timestamp: 1710000000000,
    source: { type: 'user' as const, userId: 'U123' },
  };
}

describe('SupabaseLineEventStore', () => {
  it('uses insert and reports a returned row as newly inserted', async () => {
    const { client, userUpsert, eventInsert } = createClientMock();
    const key = randomBytes(32);
    const store = new SupabaseLineEventStore(client, key);

    await expect(store.save({ events: [userEvent] })).resolves.toEqual({
      inserted: true,
    });
    expect(userUpsert).toHaveBeenCalledWith(
      { line_user_id: 'U123' },
      { onConflict: 'line_user_id' },
    );
    expect(eventInsert).toHaveBeenCalledOnce();
    const [row] = eventInsert.mock.calls[0] as [Record<string, unknown>];
    expect(row).toMatchObject({
      user_id: 'user-row-1',
      line_event_id: 'event-user',
      message_type: 'message_text',
    });
    expect(row.payload_ciphertext).not.toContain('private text');
    const persisted = JSON.parse(
      decryptWebhookPayload(row.payload_ciphertext as string, key),
    );
    expect(persisted).toEqual({
      webhookEventId: userEvent.webhookEventId,
      timestamp: userEvent.timestamp,
      source: userEvent.source,
      type: userEvent.type,
      message: userEvent.message,
    });
    expect(persisted).not.toHaveProperty('replyToken');
  });

  it('removes top-level replyToken from unknown event types before encryption', async () => {
    const { client, eventInsert } = createClientMock();
    const key = randomBytes(32);
    const event = {
      type: 'future_event',
      webhookEventId: 'future-1',
      timestamp: 1710000000000,
      source: { type: 'user' as const, userId: 'U123' },
      replyToken: 'sensitive-token',
      futureField: 'kept',
    } as never;
    const safeStore = new SupabaseLineEventStore(client, key);
    await safeStore.save({ events: [event] });
    const [row] = eventInsert.mock.calls[0] as [Record<string, unknown>];
    const persisted = JSON.parse(
      decryptWebhookPayload(row.payload_ciphertext as string, key),
    );
    expect(persisted).not.toHaveProperty('replyToken');
    expect(persisted.futureField).toBe('kept');
  });

  it('reports false only for a line_event_id unique violation', async () => {
    const { client, eventInsert } = createClientMock();
    eventInsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: null,
          error: {
            code: '23505',
            constraint: 'inbound_events_line_event_id_key',
          },
        }),
      })),
    });
    const store = new SupabaseLineEventStore(client, randomBytes(32));

    await expect(
      store.save({ events: [followEvent('event-duplicate')] }),
    ).resolves.toEqual({
      inserted: false,
    });
  });

  it('reports true when any event in a batch is newly inserted', async () => {
    const { client, eventInsert } = createClientMock();
    eventInsert.mockReturnValueOnce({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: null,
          error: {
            code: '23505',
            constraint: 'inbound_events_line_event_id_key',
          },
        }),
      })),
    });
    const store = new SupabaseLineEventStore(client, randomBytes(32));

    await expect(
      store.save({
        events: [followEvent('event-duplicate'), followEvent('event-new')],
      }),
    ).resolves.toEqual({ inserted: true });
    expect(eventInsert).toHaveBeenCalledTimes(2);
  });

  it.each([
    { code: '23505', constraint: 'some_other_unique_key' },
    { code: '42501', message: 'permission denied' },
  ])('propagates non-line-event insert errors: %o', async (error) => {
    const { client, eventInsert } = createClientMock();
    eventInsert.mockReturnValue({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: null, error }),
      })),
    });
    const store = new SupabaseLineEventStore(client, randomBytes(32));

    await expect(
      store.save({ events: [followEvent('event-1')] }),
    ).rejects.toEqual(error);
  });
});
