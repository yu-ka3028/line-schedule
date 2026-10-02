import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import app from './app.js';

const dummySecret = 'test-only-line-channel-secret';

function sign(body: string): string {
  return createHmac('sha256', dummySecret).update(body).digest('base64');
}

afterEach(() => {
  delete process.env.LINE_CHANNEL_SECRET;
});

describe('app', () => {
  it('returns a healthy status', async () => {
    const response = await app.request('/healthz');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('returns 503 when the channel secret is not configured', async () => {
    const response = await app.request('/webhooks/line', {
      method: 'POST',
    });

    expect(response.status).toBe(503);
  });

  it('rejects a missing signature', async () => {
    process.env.LINE_CHANNEL_SECRET = dummySecret;

    const response = await app.request('/webhooks/line', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(response.status).toBe(401);
  });

  it('rejects a modified body', async () => {
    process.env.LINE_CHANNEL_SECRET = dummySecret;
    const originalBody = '{"events":[]}';

    const response = await app.request('/webhooks/line', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-line-signature': sign(originalBody),
      },
      body: '{"events":[{"type":"message"}]}',
    });

    expect(response.status).toBe(401);
  });

  it('returns 400 for an invalid payload after successful verification', async () => {
    process.env.LINE_CHANNEL_SECRET = dummySecret;
    const body = '{"events":[{"type":"message"}]}';

    const response = await app.request('/webhooks/line', {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-line-signature': sign(body),
      },
      body,
    });

    expect(response.status).toBe(400);
  });

  it('returns not implemented after successful verification and validation', async () => {
    process.env.LINE_CHANNEL_SECRET = dummySecret;
    const body = '{"events":[]}';

    const response = await app.request('/webhooks/line', {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-line-signature': sign(body),
      },
      body,
    });

    expect(response.status).toBe(501);
  });
});
