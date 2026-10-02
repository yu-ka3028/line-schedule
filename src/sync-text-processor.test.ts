import { describe, expect, it, vi } from 'vitest';

import { processSyncText } from './sync-text-processor.js';

const event = {
  type: 'message' as const,
  replyToken: 'short-lived-token',
  webhookEventId: 'event-1',
  timestamp: 1,
  source: { type: 'user' as const, userId: 'U1' },
  message: { id: 'message-1', type: 'text' as const, text: 'private text' },
};

describe('processSyncText', () => {
  it('replies with a fake client and records allowlisted timing metadata', async () => {
    const reply = vi.fn().mockResolvedValue('replied');
    const record = vi.fn().mockResolvedValue(undefined);
    const outcome = await processSyncText(event, {
      replyClient: { reply },
      usageLogs: { record },
      now: (() => {
        let value = 10;
        return () => (value += 5);
      })(),
      persistenceMs: 7,
    });

    expect(outcome).toBe('replied');
    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0][0]).toBe('short-lived-token');
    expect(record).toHaveBeenCalledWith({
      schema_version: 1,
      outcome: 'replied',
      total_ms: 10,
      persistence_ms: 7,
      reply_ms: 10,
    });
  });

  it.each(['reply_unavailable', 'timeout', 'error'] as const)(
    'preserves HTTP-safe outcome %s',
    async (replyOutcome) => {
      const outcome = await processSyncText(event, {
        replyClient: { reply: vi.fn().mockResolvedValue(replyOutcome) },
      });
      expect(outcome).toBe(replyOutcome);
    },
  );

  it('skips non-user events', async () => {
    const reply = vi.fn();
    const outcome = await processSyncText(
      {
        ...event,
        source: { type: 'group', groupId: 'C1' },
      } as unknown as typeof event,
      { replyClient: { reply } },
    );
    expect(outcome).toBe('skipped');
    expect(reply).not.toHaveBeenCalled();
  });
});
