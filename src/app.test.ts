import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';
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
});

describe('app', () => {
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

  it('synchronously replies to a single user text event with a fake client', async () => {
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
    expect(reply).toHaveBeenCalledWith('reply-token', expect.any(Number));
    expect(usage.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'replied' }),
    );
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

  it('suppresses repeated and concurrent replies for the same event', async () => {
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
    expect(reply).toHaveBeenCalledOnce();

    await app.request('/webhooks/line', init);
    expect(reply).toHaveBeenCalledOnce();
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
