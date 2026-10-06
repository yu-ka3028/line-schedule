import { describe, expect, it, vi } from 'vitest';

import { encryptWebhookPayload } from './crypto.js';
import {
  createLinePushExecutor,
  LinePushRetryableError,
} from './line-push-executor.js';

const job = { jobId: '00000000-0000-4000-8000-000000000001' };
const token = '00000000-0000-4000-8000-000000000002';

const encryptionKey = Buffer.alloc(32, 7);
const oauthDependencies = (payload: string, start = vi.fn()) => ({
  processingStore: {
    read: vi.fn().mockResolvedValue({
      userId: '00000000-0000-4000-8000-000000000003',
      payloadCiphertext: encryptWebhookPayload(payload, encryptionKey),
    }),
  },
  encryptionKey,
  createGoogleOAuthStart: start,
});

describe('LINE push executor opt-in outcomes', () => {
  it('does not call LINE when the claim is blocked', async () => {
    const push = vi.fn();
    const store = {
      claim: vi.fn().mockResolvedValue({ outcome: 'blocked' as const }),
      sent: vi.fn(),
      fail: vi.fn(),
    };

    const result = await createLinePushExecutor(store, { push })(job, token);

    expect(result).toEqual({ outcome: 'blocked' });
    expect(push).not.toHaveBeenCalled();
    expect(store.sent).not.toHaveBeenCalled();
  });

  it('uses the processing token and retry key for the OAuth command', async () => {
    const pushText = vi.fn().mockResolvedValue('sent' as const);
    const start = vi
      .fn()
      .mockResolvedValue('https://accounts.example.test/oauth');
    const processingStore = oauthDependencies(
      JSON.stringify({
        type: 'message',
        message: { type: 'text', text: 'Google連携' },
      }),
      start,
    );
    const store = {
      claim: vi.fn().mockResolvedValue({
        outcome: 'claimed' as const,
        recipientId: 'line-user',
        retryKey: '00000000-0000-4000-8000-000000000004',
      }),
      sent: vi.fn().mockResolvedValue('sent' as const),
      fail: vi.fn(),
    };

    await expect(
      createLinePushExecutor(
        store,
        { push: vi.fn(), pushText },
        processingStore,
      )(job, token),
    ).resolves.toEqual({ outcome: 'sent' });
    expect(processingStore.processingStore.read).toHaveBeenCalledWith(
      job.jobId,
      token,
    );
    expect(start).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000003');
    expect(pushText).toHaveBeenCalledWith(
      'line-user',
      '00000000-0000-4000-8000-000000000004',
      expect.stringContaining('https://accounts.example.test/oauth'),
    );
  });

  it('keeps non-command events on the fixed push path', async () => {
    const push = vi.fn().mockResolvedValue('sent' as const);
    const processingStore = oauthDependencies(
      JSON.stringify({ type: 'follow' }),
    );
    const store = {
      claim: vi.fn().mockResolvedValue({
        outcome: 'claimed' as const,
        recipientId: 'line-user',
        retryKey: '00000000-0000-4000-8000-000000000004',
      }),
      sent: vi.fn().mockResolvedValue('sent' as const),
      fail: vi.fn(),
    };

    await createLinePushExecutor(store, { push }, processingStore)(job, token);
    expect(push).toHaveBeenCalled();
    expect(processingStore.createGoogleOAuthStart).not.toHaveBeenCalled();
  });

  it('requeues processing and missing dynamic push failures', async () => {
    const fail = vi.fn().mockResolvedValue('requeued' as const);
    const processingStore = oauthDependencies(
      JSON.stringify({
        type: 'message',
        message: { type: 'text', text: 'Google連携' },
      }),
      vi.fn().mockResolvedValue('https://accounts.example.test/oauth'),
    );
    const store = {
      claim: vi.fn().mockResolvedValue({
        outcome: 'claimed' as const,
        recipientId: 'line-user',
        retryKey: '00000000-0000-4000-8000-000000000004',
      }),
      sent: vi.fn(),
      fail,
    };

    await expect(
      createLinePushExecutor(
        store,
        { push: vi.fn() },
        processingStore,
      )(job, token),
    ).rejects.toBeInstanceOf(LinePushRetryableError);
    expect(fail).toHaveBeenCalledWith(
      job.jobId,
      token,
      '00000000-0000-4000-8000-000000000004',
      'retryable',
    );
  });

  it('keeps an already terminal delivery from calling LINE', async () => {
    const push = vi.fn();
    const store = {
      claim: vi.fn().mockResolvedValue({ outcome: 'sent' as const }),
      sent: vi.fn(),
      fail: vi.fn(),
    };

    await expect(
      createLinePushExecutor(store, { push })(job, token),
    ).resolves.toEqual({
      outcome: 'already_sent',
    });
    expect(push).not.toHaveBeenCalled();
  });
});
