import {
  parseCalendarTextCommand,
  type CalendarCreateCommand,
} from './calendar-command.js';
import {
  CalendarCreateExecutorError,
  executeCalendarCreate,
  type CalendarCreateExecutorDependencies,
} from './calendar-create-executor.js';

export const CALENDAR_CREATE_SUCCESS_TEXT = '予定を登録しました。';

export type CalendarCreateFlowDependencies =
  CalendarCreateExecutorDependencies & {
    execute?: typeof executeCalendarCreate;
  };

export class CalendarCreateFlowError extends Error {
  constructor(readonly code: 'invalid_input' | 'retryable') {
    super(`calendar create flow failed: ${code}`);
    this.name = 'CalendarCreateFlowError';
  }
}

export type CalendarCreateFlowResult = {
  text: typeof CALENDAR_CREATE_SUCCESS_TEXT;
  eventId: string;
  linkId: string;
};

export async function executeCalendarCreateText(
  text: unknown,
  userId: string,
  operationKey: string,
  dependencies: CalendarCreateFlowDependencies,
): Promise<CalendarCreateFlowResult> {
  let command: CalendarCreateCommand;
  try {
    command = parseCalendarTextCommand(text);
  } catch {
    throw new CalendarCreateFlowError('invalid_input');
  }

  try {
    const result = await (dependencies.execute ?? executeCalendarCreate)(
      userId,
      command,
      operationKey,
      dependencies,
    );
    return { ...result, text: CALENDAR_CREATE_SUCCESS_TEXT };
  } catch (error) {
    if (error instanceof CalendarCreateExecutorError) {
      throw new CalendarCreateFlowError(
        error.code === 'invalid_input' ? 'invalid_input' : 'retryable',
      );
    }
    throw new CalendarCreateFlowError('retryable');
  }
}
