import { describe, expect, it, vi } from 'vitest';

import { encryptWebhookPayload } from './crypto.js';
import {
  createLineOAuthPushText,
  MAX_PUSH_TEXT_LENGTH,
} from './line-oauth-push.js';

const key = Buffer.alloc(32, 7);
const userId = 'internal-user';

function encrypted(payload: unknown, encryptionKey = key) {
  return encryptWebhookPayload(JSON.stringify(payload), encryptionKey);
}

describe('LINE OAuth push text', () => {
  it('starts OAuth only for the exact command and returns a bounded body', async () => {
    const start = vi.fn().mockResolvedValue('https://example.test/oauth');
    const text = await createLineOAuthPushText(
      encrypted({
        type: 'message',
        message: { type: 'text', text: 'Google連携' },
      }),
      userId,
      { encryptionKey: key, createGoogleOAuthStart: start },
    );
    expect(text).toBe('Google連携はこちら:\nhttps://example.test/oauth');
    expect(text?.length).toBeLessThanOrEqual(MAX_PUSH_TEXT_LENGTH);
    expect(start).toHaveBeenCalledWith(userId);
  });

  it.each([
    { type: 'message', message: { type: 'text', text: 'google連携' } },
    { type: 'message', message: { type: 'image' } },
    { type: 'follow' },
  ])('returns unhandled for a non-target event', async (payload) => {
    const start = vi.fn();
    await expect(
      createLineOAuthPushText(encrypted(payload), userId, {
        encryptionKey: key,
        createGoogleOAuthStart: start,
      }),
    ).resolves.toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it('classifies decryption failure without returning a URL', async () => {
    await expect(
      createLineOAuthPushText('invalid-ciphertext', userId, {
        encryptionKey: key,
        createGoogleOAuthStart: vi.fn(),
      }),
    ).rejects.toMatchObject({
      name: 'LineOAuthPushProcessingError',
      code: 'decrypt-failure',
    });
  });

  it.each([null, [], 'event', 42, true])(
    'classifies a non-record JSON payload as invalid event: %j',
    async (payload) => {
      await expect(
        createLineOAuthPushText(encrypted(payload), userId, {
          encryptionKey: key,
          createGoogleOAuthStart: vi.fn(),
        }),
      ).rejects.toMatchObject({ code: 'invalid-event' });
    },
  );

  it('classifies OAuth generation and state-store failures', async () => {
    await expect(
      createLineOAuthPushText(
        encrypted({
          type: 'message',
          message: { type: 'text', text: 'Google連携' },
        }),
        userId,
        {
          encryptionKey: key,
          createGoogleOAuthStart: vi.fn().mockRejectedValue({
            code: 'state-store-failure',
          }),
        },
      ),
    ).rejects.toMatchObject({ code: 'state-store-failure' });

    await expect(
      createLineOAuthPushText(
        encrypted({
          type: 'message',
          message: { type: 'text', text: 'Google連携' },
        }),
        userId,
        {
          encryptionKey: key,
          createGoogleOAuthStart: vi
            .fn()
            .mockRejectedValue(new Error('failed')),
        },
      ),
    ).rejects.toMatchObject({ code: 'oauth-start-failure' });
  });

  it('classifies a body over the LINE limit', async () => {
    await expect(
      createLineOAuthPushText(
        encrypted({
          type: 'message',
          message: { type: 'text', text: 'Google連携' },
        }),
        userId,
        {
          encryptionKey: key,
          createGoogleOAuthStart: vi
            .fn()
            .mockResolvedValue(
              `https://example.test/${'x'.repeat(MAX_PUSH_TEXT_LENGTH)}`,
            ),
        },
      ),
    ).rejects.toMatchObject({ code: 'message-too-long' });
  });
});
