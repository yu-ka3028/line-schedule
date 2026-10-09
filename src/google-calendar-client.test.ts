import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setCredentials: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn(() => ({ setCredentials: mocks.setCredentials })),
    },
  },
}));

import {
  GoogleCalendarEventConflictError,
  GoogleapisCalendarClient,
} from './google-calendar-client.js';
import { googleCalendarEventIdFromOperationKey } from './google-calendar-event-id.js';
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
        id: googleCalendarEventIdFromOperationKey('operation-key'),
        summary: 'Planning',
        start: { dateTime: input.start, timeZone: input.timezone },
        end: { dateTime: input.end, timeZone: input.timezone },
      },
    });
  });

  it('passes expiry epoch milliseconds and refresh token to OAuth credentials', async () => {
    const insert = vi.fn().mockResolvedValue({ data: { id: 'event-id' } });
    const client = new GoogleapisCalendarClient({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      calendar: { events: { insert } } as never,
    });
    const expiredConnection = {
      ...connection,
      tokenExpiresAt: new Date('2025-01-01T00:00:00.000Z'),
    };

    await client.createEvent(expiredConnection, input, 'operation-key');

    expect(mocks.setCredentials).toHaveBeenCalledWith({
      access_token: 'access-token',
      expiry_date: expiredConnection.tokenExpiresAt.getTime(),
      refresh_token: 'refresh-token',
    });
  });

  it('classifies an API conflict with the deterministic event ID', async () => {
    const insert = vi.fn().mockRejectedValue({ response: { status: 409 } });
    const client = new GoogleapisCalendarClient({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      calendar: { events: { insert } } as never,
    });

    await expect(
      client.createEvent(connection, input, 'same-key'),
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'GoogleCalendarEventConflictError',
        eventId: googleCalendarEventIdFromOperationKey('same-key'),
      }),
    );
    await expect(
      client.createEvent(connection, input, 'same-key'),
    ).rejects.toBeInstanceOf(GoogleCalendarEventConflictError);
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
