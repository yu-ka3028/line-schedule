import { google } from 'googleapis';

import type { CalendarEventInput } from './calendar-provider.js';
import type { DecryptedGoogleConnection } from './google-connection-store.js';

export type GoogleCalendarEvent = {
  eventId: string;
  htmlLink?: string;
};

export interface GoogleCalendarClient {
  createEvent(
    connection: DecryptedGoogleConnection,
    input: CalendarEventInput,
    idempotencyKey: string,
  ): Promise<GoogleCalendarEvent>;
}

type CalendarApi = ReturnType<typeof google.calendar>;

export type GoogleCalendarClientOptions = {
  clientId: string;
  clientSecret: string;
  calendar?: CalendarApi;
};

/**
 * Thin Google API adapter. It intentionally has no idempotency mechanism:
 * Google Calendar insert is not exactly-once. The executor must reserve and
 * reuse its schedule_links/operation key before calling this adapter.
 */
export class GoogleapisCalendarClient implements GoogleCalendarClient {
  private readonly oauthClient: InstanceType<typeof google.auth.OAuth2>;
  private readonly calendarFactory: () => CalendarApi;

  constructor(options: GoogleCalendarClientOptions) {
    this.oauthClient = new google.auth.OAuth2(
      options.clientId,
      options.clientSecret,
    );
    this.calendarFactory =
      options.calendar === undefined
        ? () => google.calendar({ version: 'v3', auth: this.oauthClient })
        : () => options.calendar as CalendarApi;
  }

  async createEvent(
    connection: DecryptedGoogleConnection,
    input: CalendarEventInput,
    idempotencyKey: string,
  ): Promise<GoogleCalendarEvent> {
    if (!idempotencyKey) throw new Error('invalid idempotency key');
    this.oauthClient.setCredentials({
      access_token: connection.accessToken,
      ...(connection.refreshToken
        ? { refresh_token: connection.refreshToken }
        : {}),
    });

    const { data } = await this.calendarFactory().events.insert({
      calendarId: 'primary',
      requestBody: {
        summary: input.title,
        start: { dateTime: input.start, timeZone: input.timezone },
        end: { dateTime: input.end, timeZone: input.timezone },
      },
    });
    if (!data.id)
      throw new Error('Google Calendar response is missing event ID');
    return {
      eventId: data.id,
      ...(data.htmlLink ? { htmlLink: data.htmlLink } : {}),
    };
  }
}
