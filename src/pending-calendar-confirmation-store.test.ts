import { describe, expect, it, vi } from 'vitest';

import { encryptWebhookPayload } from './crypto.js';
import { SupabasePendingCalendarConfirmationStore } from './pending-calendar-confirmation-store.js';

const userId = '11111111-1111-4111-8111-111111111111';
const operationKey = 'operation-1';
const token = '22222222-2222-4222-8222-222222222222';
const key = Buffer.alloc(32, 7);
const command = {
  type: 'calendar_create',
  title: 'Planning',
  start: '2026-10-10T10:00:00+09:00',
  end: '2026-10-10T11:00:00+09:00',
  timezone: 'Asia/Tokyo',
};

function claimedRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: userId,
    operation_key: operationKey,
    command_ciphertext: encryptWebhookPayload(JSON.stringify(command), key),
    expires_at: '2026-10-10T02:00:00.000Z',
    status: 'processing',
    processing_token: token,
    lease_until: '2026-10-10T01:02:00.000Z',
    created_at: '2026-10-10T01:00:00.000Z',
    updated_at: '2026-10-10T01:00:00.000Z',
    ...overrides,
  };
}

describe('SupabasePendingCalendarConfirmationStore lease RPCs', () => {
  it('propagates the claimed processing token and lease', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [claimedRow()],
      error: null,
    });
    const store = new SupabasePendingCalendarConfirmationStore(
      { rpc } as never,
      key,
    );

    const result = await store.claimPending(
      userId,
      new Date('2026-10-10T01:00:00Z'),
    );

    expect(result).toMatchObject({
      operationKey,
      status: 'processing',
      processingToken: token,
      leaseUntil: new Date('2026-10-10T01:02:00.000Z'),
    });
    expect(rpc).toHaveBeenCalledWith('claim_pending_calendar_confirmation', {
      p_user_id: userId,
      p_now: '2026-10-10T01:00:00.000Z',
    });
  });

  it('passes the token to finish and exposes stale-token rejection', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const store = new SupabasePendingCalendarConfirmationStore(
      { rpc } as never,
      key,
    );

    await expect(
      store.finish(
        userId,
        operationKey,
        token,
        new Date('2026-10-10T01:03:00Z'),
      ),
    ).resolves.toBe(false);
    await expect(
      store.finish(
        userId,
        operationKey,
        token,
        new Date('2026-10-10T01:01:00Z'),
      ),
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'finish_pending_calendar_confirmation',
      {
        p_user_id: userId,
        p_operation_key: operationKey,
        p_processing_token: token,
        p_now: '2026-10-10T01:03:00.000Z',
      },
    );
  });

  it('passes the token to requeue for lease recovery and expiry', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const store = new SupabasePendingCalendarConfirmationStore(
      { rpc } as never,
      key,
    );

    await expect(
      store.requeue(
        userId,
        operationKey,
        token,
        new Date('2026-10-10T01:03:00Z'),
      ),
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('requeue_pending_calendar_confirmation', {
      p_user_id: userId,
      p_operation_key: operationKey,
      p_processing_token: token,
      p_now: '2026-10-10T01:03:00.000Z',
    });
  });
});
