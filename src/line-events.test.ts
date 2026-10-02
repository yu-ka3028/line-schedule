import { describe, expect, it } from 'vitest';

import {
  LineEventValidationError,
  parseLineWebhookPayload,
} from './line-events.js';

const base = {
  webhookEventId: 'event-1',
  timestamp: 1_700_000_000_000,
  source: { type: 'user', userId: 'user-1' },
};

describe('parseLineWebhookPayload', () => {
  it('parses supported events and preserves unknown event types safely', () => {
    const payload = parseLineWebhookPayload(
      JSON.stringify({
        events: [
          {
            ...base,
            type: 'message',
            replyToken: 'reply-1',
            message: { id: 'm-1', type: 'text', text: 'hello' },
          },
          {
            ...base,
            webhookEventId: 'event-2',
            type: 'message',
            message: { id: 'm-2', type: 'image' },
          },
          {
            ...base,
            webhookEventId: 'event-3',
            type: 'postback',
            postback: { data: 'action=1' },
          },
          { ...base, webhookEventId: 'event-4', type: 'follow' },
          {
            ...base,
            webhookEventId: 'event-5',
            type: 'memberJoined',
            extra: true,
          },
        ],
      }),
    );

    expect(payload.events).toHaveLength(5);
    expect(payload.events[0]).toMatchObject({
      type: 'message',
      message: { type: 'text', text: 'hello' },
    });
    expect(payload.events[1]).toMatchObject({
      type: 'message',
      message: { type: 'image' },
    });
    expect(payload.events[2]).toMatchObject({
      type: 'postback',
      postback: { data: 'action=1' },
    });
    expect(payload.events[3]).toMatchObject({ type: 'follow' });
    expect(payload.events[4]).toMatchObject({ type: 'memberJoined' });
  });

  it.each([
    ['malformed JSON', '{'],
    ['missing events', '{}'],
    [
      'missing webhookEventId',
      JSON.stringify({ events: [{ ...base, webhookEventId: undefined }] }),
    ],
    [
      'invalid source',
      JSON.stringify({ events: [{ ...base, source: { type: 'group' } }] }),
    ],
    [
      'invalid message',
      JSON.stringify({
        events: [{ ...base, type: 'message', message: { type: 'text' } }],
      }),
    ],
  ])('rejects %s', (_name, body) => {
    expect(() => parseLineWebhookPayload(body)).toThrow(
      LineEventValidationError,
    );
  });

  it('rejects payloads with too many events', () => {
    expect(() =>
      parseLineWebhookPayload(JSON.stringify({ events: [base, base] }), 1),
    ).toThrow(LineEventValidationError);
  });
});
