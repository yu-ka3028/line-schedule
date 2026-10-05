import { describe, expect, it } from 'vitest';

import { InMemoryCalendarProvider } from './calendar-provider.js';

describe('InMemoryCalendarProvider', () => {
  const input = {
    title: 'Planning',
    start: '2025-05-01T10:00:00+09:00',
    end: '2025-05-01T11:00:00+09:00',
    timezone: 'Asia/Tokyo',
  };

  it('returns the same event for a repeated idempotency key', async () => {
    const provider = new InMemoryCalendarProvider();

    const first = await provider.createEvent(input, 'job-1');
    const second = await provider.createEvent(input, 'job-1');

    expect(second).toEqual(first);
    expect(provider.size).toBe(1);
  });

  it('rejects reuse of a key for different event data', async () => {
    const provider = new InMemoryCalendarProvider();
    await provider.createEvent(input, 'job-1');

    await expect(
      provider.createEvent({ ...input, title: 'Different' }, 'job-1'),
    ).rejects.toThrow('calendar idempotency key conflict');
    expect(provider.size).toBe(1);
  });
});
