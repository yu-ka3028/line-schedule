import {
  parseCalendarCommand,
  type CalendarCreateCommand,
} from './calendar-command.js';
import {
  assertRefreshToken,
  readGoogleCalendarConnection,
} from './google-calendar-connection-store.js';
import {
  GoogleCalendarEventConflictError,
  type GoogleCalendarClient,
} from './google-calendar-client.js';
import type { GoogleConnectionReader } from './google-connection-store.js';
import {
  ScheduleLinkCreateConflictError,
  type ScheduleLink,
  type ScheduleLinkStore,
} from './schedule-link-store.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_OPERATION_KEY_LENGTH = 256;

type ExecutorErrorCode =
  | 'invalid_input'
  | 'connection_unavailable'
  | 'google_api_failure'
  | 'retryable'
  | 'reconciliation_required';

export class CalendarCreateExecutorError extends Error {
  constructor(readonly code: ExecutorErrorCode) {
    super(`calendar create failed: ${code}`);
    this.name = 'CalendarCreateExecutorError';
  }
}

export type CalendarCreateExecutorDependencies = {
  scheduleLinkStore: ScheduleLinkStore;
  connectionReader: GoogleConnectionReader;
  encryptionKey: Buffer;
  googleCalendarClient: GoogleCalendarClient;
};

export type CalendarCreateExecutorResult = {
  eventId: string;
  linkId: string;
};

function assertInputs(userId: string, operationKey: string): void {
  if (!UUID.test(userId))
    throw new CalendarCreateExecutorError('invalid_input');
  if (
    typeof operationKey !== 'string' ||
    operationKey.length === 0 ||
    operationKey.length > MAX_OPERATION_KEY_LENGTH
  )
    throw new CalendarCreateExecutorError('invalid_input');
}

function reused(link: ScheduleLink): CalendarCreateExecutorResult {
  return { eventId: link.googleEventId, linkId: link.id };
}

/**
 * Executes one validated calendar_create operation. The operation key is also
 * the bot event key used by schedule_links; it is never sent to logs or API
 * error messages by this layer.
 */
export async function executeCalendarCreate(
  userId: string,
  command: CalendarCreateCommand,
  operationKey: string,
  dependencies: CalendarCreateExecutorDependencies,
): Promise<CalendarCreateExecutorResult> {
  assertInputs(userId, operationKey);

  let validatedCommand: CalendarCreateCommand;
  try {
    validatedCommand = parseCalendarCommand(command);
  } catch {
    throw new CalendarCreateExecutorError('invalid_input');
  }

  let existingLink: ScheduleLink | null;
  try {
    existingLink = await dependencies.scheduleLinkStore.getByBotEventId(
      userId,
      operationKey,
    );
  } catch {
    throw new CalendarCreateExecutorError('retryable');
  }
  if (existingLink) return reused(existingLink);

  let connection;
  try {
    connection = await readGoogleCalendarConnection(
      dependencies.connectionReader,
      userId,
      dependencies.encryptionKey,
    );
    assertRefreshToken(connection);
  } catch {
    throw new CalendarCreateExecutorError('connection_unavailable');
  }

  let googleEvent;
  try {
    googleEvent = await dependencies.googleCalendarClient.createEvent(
      connection,
      {
        title: validatedCommand.title,
        start: validatedCommand.start,
        end: validatedCommand.end,
        timezone: validatedCommand.timezone,
      },
      operationKey,
    );
  } catch (error) {
    if (error instanceof GoogleCalendarEventConflictError) {
      try {
        const link = await dependencies.scheduleLinkStore.getByBotEventId(
          userId,
          operationKey,
        );
        if (link) return reused(link);
      } catch {
        // A later retry may observe the competing link.
      }
      throw new CalendarCreateExecutorError('reconciliation_required');
    }
    throw new CalendarCreateExecutorError('google_api_failure');
  }

  try {
    const link = await dependencies.scheduleLinkStore.create({
      userId,
      googleCalendarId: 'primary',
      googleEventId: googleEvent.eventId,
      botEventId: operationKey,
    });
    return { eventId: googleEvent.eventId, linkId: link.id };
  } catch (error) {
    if (error instanceof ScheduleLinkCreateConflictError) {
      if (error.existingLink) return reused(error.existingLink);
      throw new CalendarCreateExecutorError('retryable');
    }
    throw new CalendarCreateExecutorError('retryable');
  }
}

export const calendarCreateExecutorLimits = {
  operationKey: MAX_OPERATION_KEY_LENGTH,
} as const;
