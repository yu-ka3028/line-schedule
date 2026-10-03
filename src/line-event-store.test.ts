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
  const eventUpsert = vi
    .fn<
      (...args: unknown[]) => {
        select: () => { maybeSingle: () => Promise<unknown> };
      }
    >()
    .mockImplementation(() => ({
      select: vi.fn(() => ({
        maybeSingle: vi
          .fn()
          .mockResolvedValue({ data: { id: 'event-row-1' }, error: null }),
      })),
    }));
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'users') return { upsert: userUpsert };
      if (table === 'inbound_events') return { upsert: eventUpsert };
      throw new Error(`unexpected table: ${table}`);
    }),
  } as unknown as SupabaseClient;
  return { client, userUpsert, eventUpsert };
}

describe('SupabaseLineEventStore', () => {
  it('stores only user events as independently encrypted payloads', async () => {
    const { client, userUpsert, eventUpsert } = createClientMock();
    const key = randomBytes(32);
    const store = new SupabaseLineEventStore(client, key);
    const userEvent = {
      type: 'message' as const,
      webhookEventId: 'event-user',
      timestamp: 1710000000000,
      source: { type: 'user' as const, userId: 'U123' },
      replyToken: 'reply-token',
      message: { id: 'message-1', type: 'text' as const, text: 'private text' },
    };

    await store.save({
      events: [
        userEvent,
        {
          type: 'follow' as const,
          webhookEventId: 'event-group',
          timestamp: 1710000000001,
          source: { type: 'group' as const, groupId: 'C123', userId: 'U999' },
        },
        {
          type: 'follow' as const,
          webhookEventId: 'event-room',
          timestamp: 1710000000002,
          source: { type: 'room' as const, roomId: 'R123', userId: 'U888' },
        },
      ],
    });

    expect(userUpsert).toHaveBeenCalledWith(
      { line_user_id: 'U123' },
      { onConflict: 'line_user_id' },
    );
    expect(eventUpsert).toHaveBeenCalledOnce();
    const [row, options] = eventUpsert.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(row).toMatchObject({
      user_id: 'user-row-1',
      line_event_id: 'event-user',
      message_type: 'message_text',
    });
    expect(options).toEqual({
      onConflict: 'line_event_id',
      ignoreDuplicates: true,
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
    expect(row.payload_ciphertext).not.toContain('event-group');
    expect(row.payload_ciphertext).not.toContain('C123');
    expect(row.payload_ciphertext).not.toContain('event-room');
    expect(row.payload_ciphertext).not.toContain('R123');
  });

  it('reports inserted false when PostgREST returns null for a duplicate', async () => {
    const { client, eventUpsert } = createClientMock();
    eventUpsert.mockReturnValue({
      select: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    });
    const store = new SupabaseLineEventStore(client, randomBytes(32));

    await expect(
      store.save({
        events: [
          {
            type: 'follow',
            webhookEventId: 'event-duplicate',
            timestamp: 1710000000000,
            source: { type: 'user', userId: 'U123' },
          },
        ],
      }),
    ).resolves.toEqual({ inserted: false });
  });

  it('reports inserted true when any event in a batch is new', async () => {
    const { client, eventUpsert } = createClientMock();
    eventUpsert.mockImplementationOnce(() => ({
      select: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    }));
    const store = new SupabaseLineEventStore(client, randomBytes(32));

    await expect(
      store.save({
        events: [
          {
            type: 'follow',
            webhookEventId: 'event-duplicate',
            timestamp: 1710000000000,
            source: { type: 'user', userId: 'U123' },
          },
          {
            type: 'follow',
            webhookEventId: 'event-new',
            timestamp: 1710000000001,
            source: { type: 'user', userId: 'U123' },
          },
        ],
      }),
    ).resolves.toEqual({ inserted: true });
  });

  it('propagates non-duplicate insert errors', async () => {
    const { client, eventUpsert } = createClientMock();
    const error = { code: '42501', message: 'permission denied' };
    eventUpsert.mockReturnValue({
      select: vi.fn(() => ({
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error }),
      })),
    });
    const store = new SupabaseLineEventStore(client, randomBytes(32));

    await expect(
      store.save({
        events: [
          {
            type: 'follow',
            webhookEventId: 'event-1',
            timestamp: 1710000000000,
            source: { type: 'user', userId: 'U123' },
          },
        ],
      }),
    ).rejects.toEqual(error);
  });
});
