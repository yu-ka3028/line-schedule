import {
  CalendarCommandValidationError,
  parseCalendarTextCommand,
} from './calendar-command.js';
import {
  CalendarCreateExecutorError,
  executeCalendarCreate,
  type CalendarCreateExecutorDependencies,
} from './calendar-create-executor.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CALENDAR_CREATE_SUCCESS_MESSAGE = '予定登録完了';

export type CalendarCreateFlowOutcome =
  | 'success'
  | 'unsupported'
  | 'invalid'
  | 'invalid_input'
  | 'connection_unavailable'
  | 'google_api_failure'
  | 'retryable'
  | 'reconciliation_required'
  | 'schedule_link_deleted';

export type CalendarCreateFlowResult =
  | {
      outcome: 'success';
      pushText: typeof CALENDAR_CREATE_SUCCESS_MESSAGE;
    }
  | {
      outcome: Exclude<CalendarCreateFlowOutcome, 'success'>;
    };

export type CalendarCreateFlowDependencies =
  CalendarCreateExecutorDependencies & {
    executeCalendarCreate: typeof executeCalendarCreate;
  };

function parserOutcome(error: unknown): 'unsupported' | 'invalid' {
  if (
    error instanceof CalendarCommandValidationError &&
    error.message === 'Unsupported calendar text command'
  )
    return 'unsupported';
  return 'invalid';
}

/**
 * Parses one decrypted LINE event body and executes only the exact calendar
 * text command. This boundary deliberately returns safe classifications rather
 * than propagating parser, connection, provider, or persistence details.
 */
export async function executeCalendarCreateFlow(
  eventText: string,
  userId: string,
  operationKey: string,
  dependencies: CalendarCreateFlowDependencies,
): Promise<CalendarCreateFlowResult> {
  if (!UUID.test(operationKey)) return { outcome: 'invalid_input' };

  let command;
  try {
    command = parseCalendarTextCommand(eventText);
  } catch (error) {
    return { outcome: parserOutcome(error) };
  }

  try {
    await dependencies.executeCalendarCreate(
      userId,
      command,
      operationKey,
      dependencies,
    );
  } catch (error) {
    if (error instanceof CalendarCreateExecutorError)
      return { outcome: error.code };
    return { outcome: 'retryable' };
  }

  return {
    outcome: 'success',
    pushText: CALENDAR_CREATE_SUCCESS_MESSAGE,
  };
}
