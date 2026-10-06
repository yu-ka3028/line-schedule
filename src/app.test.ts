import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';
import type { GoogleOAuthCallbackDependencies } from './google-oauth-callback.js';
import type { LineEventStore } from './line-event-store.js';

const dummySecret = 'test-only-line-channel-secret';

function sign(body: string): string {
  return createHmac('sha256', dummySecret).update(body).digest('base64');
}

async function request(
  body: string,
  store?: LineEventStore,
): Promise<Response> {
  return await createApp(store).request('/webhooks/line', {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'x-line-signature': sign(body),
    },
    body,
  });
}

const validBody = JSON.stringify({
  events: [
    {
      type: 'follow',
      webhookEventId: 'event-1',
      timestamp: 1710000000000,
      source: { type: 'user', userId: 'U123' },
    },
  ],
});

afterEach(() => {
  delete process.env.LINE_CHANNEL_SECRET;
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  delete process.env.GOOGLE_OAUTH_ENABLED;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REDIRECT_URI;
});

describe('app', () => {
  it('keeps the Google OAuth callback inert when disabled', async () => {
    const callback: GoogleOAuthCallbackDependencies = {
      stateStore: { consume: vi.fn() } as never,
      codeExchanger: { exchangeCode: vi.fn() },
      connectionStore: { upsert: vi.fn() },
      encryptionKey: Buffer.alloc(32),
    };
    const response = await createApp(undefined, {
      oauth: { callback },
    }).request('/oauth/google/callback?code=secret-code&state=secret-state');
    expect(response.status).toBe(404);
    expect(callback.stateStore.consume).not.toHaveBeenCalled();
    expect(callback.codeExchanger.exchangeCode).not.toHaveBeenCalled();
    expect(callback.connectionStore.upsert).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('secret');
  });

  it('rejects incomplete and provider-error callbacks safely', async () => {
    process.env.GOOGLE_OAUTH_ENABLED = 'true';
    const exchangeCode = vi
      .fn()
      .mockRejectedValue(new Error('provider detail'));
    const callback: GoogleOAuthCallbackDependencies = {
      stateStore: {
        consume: vi.fn().mockResolvedValue({ userId: 'user' }),
      } as never,
      codeExchanger: { exchangeCode },
      connectionStore: { upsert: vi.fn() },
      encryptionKey: Buffer.alloc(32),
    };
    const app = createApp(undefined, { oauth: { callback } });

    expect(
      (await app.request('/oauth/google/callback?state=state')).status,
    ).toBe(400);
    const response = await app.request(
      '/oauth/google/callback?code=secret-code&state=secret-state',
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('secret');
    expect(exchangeCode).toHaveBeenCalledOnce();
  });

  it('returns a fixed success response and classifies store failures', async () => {
    process.env.GOOGLE_OAUTH_ENABLED = 'true';
    const callback: GoogleOAuthCallbackDependencies = {
      stateStore: {
        consume: vi.fn().mockResolvedValue({ userId: 'user' }),
      } as never,
      codeExchanger: {
        exchangeCode: vi.fn().mockResolvedValue({
          googleAccountId: 'account',
          accessToken: 'access',
          tokenExpiresAt: new Date(Date.now() + 60_000),
          scopes: ['https://www.googleapis.com/auth/calendar.events'],
        }),
      },
      connectionStore: { upsert: vi.fn().mockResolvedValue(undefined) },
      encryptionKey: Buffer.alloc(32),
    };
    const app = createApp(undefined, { oauth: { callback } });
    const response = await app.request(
      '/oauth/google/callback?code=secret-code&state=secret-state',
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe('Google OAuth connection successful.');
    expect(body).not.toContain('secret');

    callback.connectionStore.upsert = vi
      .fn()
      .mockRejectedValue(new Error('migration unavailable'));
    const failed = await app.request(
      '/oauth/google/callback?code=code&state=state',
    );
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toContain('migration');
  });

  it('returns a healthy status', async () => {
    const response = await createApp().request('/healthz');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('returns 503 when the channel secret is not configured', async () => {
    const response = await createApp().request('/webhooks/line', {
      method: 'POST',
    });
    expect(response.status).toBe(503);
  });

  it('rejects a missing signature', async () => {
    process.env.LINE_CHANNEL_SECRET = dummySecret;
    const response = await createApp().request('/webhooks/line', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(401);
  });

  it('does not call the store before signature verification', async () => {
    process.env.LINE_CHANNEL_SECRET = dummySecret;
    const store = {
      save: vi.fn().mockResolvedValue({ inserted: false }),
    } satisfies LineEventStore;
    const response = await createApp(store).request('/webhooks/line', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-line-signature': 'invalid',
      },
      body: validBody,
    });
    expect(response.status).toBe(401);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid payload after successful verification', async () => {
    process.env.LINE_CHANNEL_SECRET = dummySecret;
    const body = '{"events":[{"type":"message"}]}';
    const response = await request(body, {
      save: vi.fn().mockResolvedValue({ inserted: false }),
    });
    expect(response.status).toBe(400);
  });

  it('accepts a case-insensitive JSON content type', async () => {
    process.env.LINE_CHANNEL_SECRET = dummySecret;
    const response = await createApp({
      save: vi.fn().mockResolvedValue({ inserted: false }),
    }).request('/webhooks/line', {
      method: 'POST',
      headers: {
        'content-type': 'Application/JSON; charset=utf-8',
        'x-line-signature': sign(validBody),
      },
      body: validBody,
    });

    expect(response.status).toBe(200);
  });

  it('stores a valid payload and returns 200', async () => {
    process.env.LINE_CHANNEL_SECRET = dummySecret;
    const store = {
      save: vi.fn().mockResolvedValue({ inserted: false }),
    } satisfies LineEventStore;
    const response = await request(validBody, store);
    expect(response.status).toBe(200);
    expect(store.save).toHaveBeenCalledOnce();
    expect(store.save).toHaveBeenCalledWith({
      events: [
        {
          type: 'follow',
          webhookEventId: 'event-1',
          timestamp: 1710000000000,
          source: { type: 'user', userId: 'U123' },
        },
      ],
    });
  });

  it('does not synchronously reply to a single user text event', async () => {
    process.env.LINE_CHANNEL_SECRET = dummySecret;
    const body = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-token',
          webhookEventId: 'text-event',
          timestamp: 1710000000000,
          source: { type: 'user', userId: 'U123' },
          message: { id: 'message-1', type: 'text', text: 'do not echo' },
        },
      ],
    });
    const reply = vi.fn().mockResolvedValue('replied');
    const usage = { record: vi.fn().mockResolvedValue(undefined) };
    const response = await createApp(
      { save: vi.fn().mockResolvedValue({ inserted: true }) },
      { line: { replyClient: { reply }, usageLogs: usage } },
    ).request('/webhooks/line', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-line-signature': sign(body),
      },
      body,
    });
    expect(response.status).toBe(200);
    expect(reply).not.toHaveBeenCalled();
    expect(usage.record).not.toHaveBeenCalled();
  });

  it('does not reply when persistence reports a duplicate insert', async () => {
    process.env.LINE_CHANNEL_SECRET = dummySecret;
    const body = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-token',
          webhookEventId: 'duplicate-event',
          timestamp: 1710000000000,
          source: { type: 'user', userId: 'U123' },
          message: { id: 'message-1', type: 'text', text: 'private' },
        },
      ],
    });
    const reply = vi.fn().mockResolvedValue('replied');
    const response = await createApp(
      { save: vi.fn().mockResolvedValue({ inserted: false }) },
      { line: { replyClient: { reply } } },
    ).request('/webhooks/line', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-line-signature': sign(body),
      },
      body,
    });
    expect(response.status).toBe(200);
    expect(reply).not.toHaveBeenCalled();
  });

  it('does not reply when persistence insert status is unknown', async () => {
    process.env.LINE_CHANNEL_SECRET = dummySecret;
    const body = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-token',
          webhookEventId: 'unknown-insert-event',
          timestamp: 1710000000000,
          source: { type: 'user', userId: 'U123' },
          message: { id: 'message-1', type: 'text', text: 'private' },
        },
      ],
    });
    const reply = vi.fn().mockResolvedValue('replied');
    const legacyStore = {
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as LineEventStore;
    const response = await createApp(legacyStore, {
      line: { replyClient: { reply } },
    }).request('/webhooks/line', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-line-signature': sign(body),
      },
      body,
    });
    expect(response.status).toBe(200);
    expect(reply).not.toHaveBeenCalled();
  });

  it('does not reply to repeated or concurrent events', async () => {
    process.env.LINE_CHANNEL_SECRET = dummySecret;
    const body = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-token',
          webhookEventId: 'same-event',
          timestamp: 1710000000000,
          source: { type: 'user', userId: 'U123' },
          message: { id: 'message-1', type: 'text', text: 'private' },
        },
      ],
    });
    const reply = vi.fn().mockResolvedValue('replied');
    const app = createApp(
      { save: vi.fn().mockResolvedValue({ inserted: true }) },
      { line: { replyClient: { reply } } },
    );
    const init = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-line-signature': sign(body),
      },
      body,
    } as const;
    const responses = await Promise.all([
      app.request('/webhooks/line', init),
      app.request('/webhooks/line', init),
    ]);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(reply).not.toHaveBeenCalled();

    await app.request('/webhooks/line', init);
    expect(reply).not.toHaveBeenCalled();
  });

  it('returns 200 when usage or reply fails', async () => {
    process.env.LINE_CHANNEL_SECRET = dummySecret;
    const body = JSON.stringify({
      events: [
        {
          type: 'message',
          replyToken: 'reply-token',
          webhookEventId: 'failed-event',
          timestamp: 1710000000000,
          source: { type: 'user', userId: 'U123' },
          message: { id: 'message-1', type: 'text', text: 'private' },
        },
      ],
    });
    const response = await createApp(
      { save: vi.fn().mockResolvedValue({ inserted: true }) },
      {
        line: {
          replyClient: { reply: vi.fn().mockResolvedValue('timeout') },
          usageLogs: {
            record: vi.fn().mockRejectedValue(new Error('telemetry')),
          },
        },
      },
    ).request('/webhooks/line', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-line-signature': sign(body),
      },
      body,
    });
    expect(response.status).toBe(200);
  });

  it('returns 500 without persistence details when storage fails', async () => {
    process.env.LINE_CHANNEL_SECRET = dummySecret;
    const store = {
      save: vi.fn().mockRejectedValue(new Error('database secret')),
    } satisfies LineEventStore;
    const response = await request(validBody, store);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'persistence_unavailable',
    });
  });

  it('returns 503 when storage configuration is unavailable', async () => {
    process.env.LINE_CHANNEL_SECRET = dummySecret;
    const response = await request(validBody);
    expect(response.status).toBe(503);
  });

  it('returns 200 for an empty verified payload without storage', async () => {
    process.env.LINE_CHANNEL_SECRET = dummySecret;
    const body = '{"events":[]}';
    const response = await request(body);
    expect(response.status).toBe(200);
  });
});
