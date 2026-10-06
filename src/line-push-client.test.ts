import { describe, expect, it, vi } from 'vitest';

import {
  FetchLinePushClient,
  LINE_PUSH_ENDPOINT,
  LINE_PUSH_TEXT,
  LINE_PUSH_MAX_TEXT_LENGTH,
} from './line-push-client.js';

describe('FetchLinePushClient', () => {
  it('sends the fixed push shape and never reads response body', async () => {
    const response = new Response('sensitive response body', { status: 200 });
    const fetcher = vi.fn().mockResolvedValue(response);
    const result = await new FetchLinePushClient('test-token', fetcher).push(
      'Urecipient',
      '11111111-1111-4111-8111-111111111111',
    );
    expect(result).toBe('sent');
    expect(fetcher).toHaveBeenCalledWith(LINE_PUSH_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
        'x-line-retry-key': '11111111-1111-4111-8111-111111111111',
      },
      body: JSON.stringify({
        to: 'Urecipient',
        messages: [{ type: 'text', text: LINE_PUSH_TEXT }],
      }),
    });
    expect(response.bodyUsed).toBe(false);
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain(
      'sensitive response body',
    );
  });

  it('sends a dynamic body and blocks an oversized body', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    const client = new FetchLinePushClient('test-token', fetcher);
    await expect(
      client.pushText!('Urecipient', 'retry-key', 'dynamic'),
    ).resolves.toBe('sent');
    expect(
      JSON.parse(fetcher.mock.calls[0][1].body as string).messages[0].text,
    ).toBe('dynamic');
    await expect(
      client.pushText!(
        'Urecipient',
        'retry-key',
        'x'.repeat(LINE_PUSH_MAX_TEXT_LENGTH + 1),
      ),
    ).resolves.toBe('blocked');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    [429, 'retryable'],
    [500, 'retryable'],
    [400, 'blocked'],
  ] as const)(
    'classifies %s without exposing the body',
    async (status, result) => {
      const fetcher = vi
        .fn()
        .mockResolvedValue(new Response('private body', { status }));
      await expect(
        new FetchLinePushClient('test-token', fetcher).push(
          'Urecipient',
          '11111111-1111-4111-8111-111111111111',
        ),
      ).resolves.toBe(result);
    },
  );

  it('classifies network failure as retryable', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValue(new Error('private network detail'));
    await expect(
      new FetchLinePushClient('test-token', fetcher).push(
        'Urecipient',
        '11111111-1111-4111-8111-111111111111',
      ),
    ).resolves.toBe('retryable');
  });
});
