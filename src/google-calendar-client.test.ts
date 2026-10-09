import { describe, expect, it, vi } from 'vitest';

import { GoogleapisCalendarClient } from './google-calendar-client.js';
import type { DecryptedGoogleConnection } from './google-connection-store.js';

const connection: DecryptedGoogleConnection = {
  userId: 'user-id',
  googleAccountId: 'account-id',
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  tokenExpiresAt: null,
  scopes: ['calendar.events'],
};

const input = {
  title: 'Planning',
  start: '2025-01-01T10:00:00+09:00',
  end: '2025-01-01T11:00:00+09:00',
  timezone: 'Asia/Tokyo',
};

describe('GoogleapisCalendarClient', () => {
  it('inserts a primary-calendar event and returns minimal response data', async () => {
    const insert = vi.fn().mockResolvedValue({
      data: { id: 'event-id', htmlLink: 'https://calendar.google.com/event' },
    });
    const calendar = { events: { insert } } as never;
    const client = new GoogleapisCalendarClient({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      calendar,
    });

    await expect(
      client.createEvent(connection, input, 'operation-key'),
    ).resolves.toEqual({
      eventId: 'event-id',
      htmlLink: 'https://calendar.google.com/event',
    });
    expect(insert).toHaveBeenCalledWith({
      calendarId: 'primary',
      requestBody: {
        summary: 'Planning',
        start: { dateTime: input.start, timeZone: input.timezone },
        end: { dateTime: input.end, timeZone: input.timezone },
      },
    });
  });

  it('does not claim adapter-level exactly-once behavior', async () => {
    const insert = vi.fn().mockResolvedValue({ data: { id: 'event-id' } });
    const client = new GoogleapisCalendarClient({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      calendar: { events: { insert } } as never,
    });

    await client.createEvent(connection, input, 'same-key');
    await client.createEvent(connection, input, 'same-key');
    expect(insert).toHaveBeenCalledTimes(2);
  });
});
