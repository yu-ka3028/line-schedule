import type { CalendarCreateCommand } from './calendar-command.js';

export type CalendarEventInput = Omit<CalendarCreateCommand, 'type'>;

export type CalendarEvent = CalendarEventInput & {
  eventId: string;
};

export interface CalendarProvider {
  createEvent(
    input: CalendarEventInput,
    idempotencyKey: string,
  ): Promise<CalendarEvent>;
}

export class CalendarIdempotencyConflictError extends Error {
  constructor() {
    super('calendar idempotency key conflict');
    this.name = 'CalendarIdempotencyConflictError';
  }
}

const MAX_IDEMPOTENCY_KEY_LENGTH = 256;

function assertIdempotencyKey(key: string): void {
  if (
    typeof key !== 'string' ||
    key.length === 0 ||
    key.length > MAX_IDEMPOTENCY_KEY_LENGTH
  )
    throw new Error('invalid idempotency key');
}

/** An external-API-free provider for contract tests and local development. */
export class InMemoryCalendarProvider implements CalendarProvider {
  private readonly events = new Map<
    string,
    { fingerprint: string; event: CalendarEvent }
  >();
  private nextEventId = 1;

  async createEvent(
    input: CalendarEventInput,
    idempotencyKey: string,
  ): Promise<CalendarEvent> {
    assertIdempotencyKey(idempotencyKey);
    const fingerprint = JSON.stringify(input);
    const existing = this.events.get(idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new CalendarIdempotencyConflictError();
      return existing.event;
    }

    const event = {
      ...input,
      eventId: `fake-calendar-event-${this.nextEventId++}`,
    };
    this.events.set(idempotencyKey, { fingerprint, event });
    return event;
  }

  get size(): number {
    return this.events.size;
  }
}
