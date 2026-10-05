const MAX_TITLE_LENGTH = 200;
const MAX_DATETIME_LENGTH = 64;
const MAX_TIMEZONE_LENGTH = 64;
const ISO_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

type RecordValue = Record<string, unknown>;

export type CalendarCreateCommand = {
  type: 'calendar_create';
  title: string;
  start: string;
  end: string;
  timezone: string;
};

export class CalendarCommandValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarCommandValidationError';
  }
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength
  )
    throw new CalendarCommandValidationError(`Invalid ${field}`);
  return value;
}

function parseDateTime(value: unknown, field: string): string {
  const datetime = requiredBoundedString(value, field, MAX_DATETIME_LENGTH);
  const match = ISO_DATETIME.exec(datetime);
  if (!match || Number.isNaN(Date.parse(datetime)))
    throw new CalendarCommandValidationError(`Invalid ${field}`);
  const [, year, month, day] = match;
  const calendarDate = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );
  if (
    calendarDate.getUTCFullYear() !== Number(year) ||
    calendarDate.getUTCMonth() !== Number(month) - 1 ||
    calendarDate.getUTCDate() !== Number(day)
  )
    throw new CalendarCommandValidationError(`Invalid ${field}`);
  return datetime;
}

function parseTimezone(value: unknown): string {
  const timezone = requiredBoundedString(
    value,
    'timezone',
    MAX_TIMEZONE_LENGTH,
  );
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new CalendarCommandValidationError('Invalid timezone');
  }
  return timezone;
}

export function parseCalendarCommand(value: unknown): CalendarCreateCommand {
  if (!isRecord(value) || Object.keys(value).length !== 5)
    throw new CalendarCommandValidationError('Invalid calendar command');
  if (value.type !== 'calendar_create')
    throw new CalendarCommandValidationError('Invalid calendar command type');

  const title = requiredBoundedString(value.title, 'title', MAX_TITLE_LENGTH);
  const start = parseDateTime(value.start, 'start');
  const end = parseDateTime(value.end, 'end');
  if (Date.parse(end) <= Date.parse(start))
    throw new CalendarCommandValidationError('End must be after start');

  return {
    type: 'calendar_create',
    title,
    start,
    end,
    timezone: parseTimezone(value.timezone),
  };
}

export const calendarCommandLimits = {
  title: MAX_TITLE_LENGTH,
  datetime: MAX_DATETIME_LENGTH,
  timezone: MAX_TIMEZONE_LENGTH,
} as const;
