import { describe, expect, it, vi } from 'vitest';

import { encryptWebhookPayload } from './crypto.js';
import {
  createLineOAuthPushTextProvider,
  MAX_PUSH_TEXT_LENGTH,
} from './line-oauth-push.js';

const key = Buffer.alloc(32, 7);
const job = { jobId: '00000000-0000-4000-8000-000000000001' };

function provider(
  payload: unknown,
  start = vi.fn().mockResolvedValue('https://example.test/oauth'),
) {
  return {
    text: createLineOAuthPushTextProvider({
      eventStore: {
        read: vi.fn().mockResolvedValue({
          userId: '00000000-0000-4000-8000-000000000002',
          payloadCiphertext: encryptWebhookPayload(
            JSON.stringify(payload),
            key,
          ),
        }),
      },
      encryptionKey: key,
      createGoogleOAuthStart: start,
    }),
    start,
  };
}

describe('LINE OAuth push text', () => {
  it('only targets the exact user text and returns a bounded dynamic message', async () => {
    const start = vi.fn().mockResolvedValue('https://example.test/oauth');
    const value = provider(
      {
        type: 'message',
        source: { type: 'user', userId: 'U1' },
        message: { type: 'text', text: 'Google連携' },
      },
      start,
    );
    const text = await value.text(job, 'token');
    expect(text).not.toBeNull();
    if (text === null) throw new Error('expected push text');
    expect(text).toBe('Google連携はこちら:\nhttps://example.test/oauth');
    expect(text.length).toBeLessThanOrEqual(MAX_PUSH_TEXT_LENGTH);
    expect(start).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000002');
  });

  it.each([
    {
      type: 'message',
      source: { type: 'user', userId: 'U1' },
      message: { type: 'text', text: 'google連携' },
    },
    {
      type: 'message',
      source: { type: 'user', userId: 'U1' },
      message: { type: 'image' },
    },
    { type: 'follow', source: { type: 'user', userId: 'U1' } },
  ])('does not start OAuth for non-target events', async (payload) => {
    const value = provider(payload);
    await expect(value.text(job, 'token')).resolves.toBeNull();
    expect(value.start).not.toHaveBeenCalled();
  });

  it('does not expose decryption or state errors', async () => {
    const eventStore = { read: vi.fn().mockResolvedValue(null) };
    const text = createLineOAuthPushTextProvider({
      eventStore,
      encryptionKey: key,
      createGoogleOAuthStart: vi.fn(),
    });
    await expect(text(job, 'token')).rejects.toThrow(
      'line_oauth_push_processing_failed',
    );
  });
});
