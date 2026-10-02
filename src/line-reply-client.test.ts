import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLineReplyClient } from './line-reply-client.js';

afterEach(() => {
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  vi.unstubAllGlobals();
});

describe('createLineReplyClient', () => {
  it('does not call fetch when the access token is unavailable', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await createLineReplyClient().reply(
      'reply-token',
      Date.now() + 800,
    );

    expect(outcome).toBe('reply_unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps non-2xx responses to error without reading the response body', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await createLineReplyClient().reply(
      'reply-token',
      Date.now() + 800,
    );

    expect(outcome).toBe('error');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(['AbortError', 'TimeoutError'] as const)(
    'maps %s from fetch to timeout',
    async (name) => {
      process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new DOMException('aborted', name)),
      );

      const outcome = await createLineReplyClient().reply(
        'reply-token',
        Date.now() + 800,
      );

      expect(outcome).toBe('timeout');
    },
  );

  it('maps a successful 2xx response to replied', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await createLineReplyClient().reply(
      'reply-token',
      Date.now() + 800,
    );

    expect(outcome).toBe('replied');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.line.me/v2/bot/message/reply',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
