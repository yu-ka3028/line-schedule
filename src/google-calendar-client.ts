import { google } from 'googleapis';

import type { CalendarEventInput } from './calendar-provider.js';
import { googleCalendarEventIdFromOperationKey } from './google-calendar-event-id.js';
import type { DecryptedGoogleConnection } from './google-connection-store.js';

export type GoogleCalendarEvent = {
  eventId: string;
  htmlLink?: string;
};

export class GoogleCalendarEventConflictError extends Error {
  constructor(readonly eventId: string) {
    super('Google Calendar event already exists');
    this.name = 'GoogleCalendarEventConflictError';
  }
}

export function isGoogleCalendarConflictError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  return (
    value.code === 409 || value.status === 409 || value.response?.status === 409
  );
}

export interface GoogleCalendarClient {
  createEvent(
    connection: DecryptedGoogleConnection,
    input: CalendarEventInput,
    idempotencyKey: string,
  ): Promise<GoogleCalendarEvent>;
}

type CalendarApi = ReturnType<typeof google.calendar>;
type OAuth2Api = InstanceType<typeof google.auth.OAuth2>;

export type GoogleCalendarClientOptions = {
  clientId: string;
  clientSecret: string;
  oauthFactory?: (clientId: string, clientSecret: string) => OAuth2Api;
  calendarFactory?: (auth: OAuth2Api) => CalendarApi;
};

/**
 * Thin Google API adapter. Google Calendar insert is not exactly-once. The
 * executor must reserve and reuse its schedule_links/operation key before
 * calling this adapter; a 409 is classified rather than treated as proof of
 * exactly-once completion.
 */
export class GoogleapisCalendarClient implements GoogleCalendarClient {
  private readonly oauthFactory: () => OAuth2Api;
  private readonly calendarFactory: (auth: OAuth2Api) => CalendarApi;

  constructor(options: GoogleCalendarClientOptions) {
    this.oauthFactory =
      options.oauthFactory === undefined
        ? () => new google.auth.OAuth2(options.clientId, options.clientSecret)
        : () => options.oauthFactory!(options.clientId, options.clientSecret);
    this.calendarFactory =
      options.calendarFactory ??
      ((auth) => google.calendar({ version: 'v3', auth }));
  }

  async createEvent(
    connection: DecryptedGoogleConnection,
    input: CalendarEventInput,
    idempotencyKey: string,
  ): Promise<GoogleCalendarEvent> {
    if (!idempotencyKey) throw new Error('invalid idempotency key');
    const eventId = googleCalendarEventIdFromOperationKey(idempotencyKey);
    const oauthClient = this.oauthFactory();
    oauthClient.setCredentials({
      access_token: connection.accessToken,
      ...(connection.tokenExpiresAt
        ? { expiry_date: connection.tokenExpiresAt.getTime() }
        : {}),
      ...(connection.refreshToken
        ? { refresh_token: connection.refreshToken }
        : {}),
    });

    let data;
    try {
      ({ data } = await this.calendarFactory(oauthClient).events.insert({
        calendarId: 'primary',
        requestBody: {
          id: eventId,
          summary: input.title,
          start: { dateTime: input.start, timeZone: input.timezone },
          end: { dateTime: input.end, timeZone: input.timezone },
        },
      }));
    } catch (error) {
      if (isGoogleCalendarConflictError(error))
        throw new GoogleCalendarEventConflictError(eventId);
      throw error;
    }
    if (!data.id)
      throw new Error('Google Calendar response is missing event ID');
    return {
      eventId: data.id,
      ...(data.htmlLink ? { htmlLink: data.htmlLink } : {}),
    };
  }
}
