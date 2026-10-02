const DEFAULT_MAX_EVENTS = 100;

type RecordValue = Record<string, unknown>;

export type LineSource =
  | { type: 'user'; userId: string }
  | { type: 'group'; groupId: string; userId?: string }
  | { type: 'room'; roomId: string; userId?: string };

type LineEventBase = {
  webhookEventId: string;
  timestamp: number;
  source: LineSource;
};

export type LineTextMessageEvent = LineEventBase & {
  type: 'message';
  message: { id: string; type: 'text'; text: string };
};

export type LineImageMessageEvent = LineEventBase & {
  type: 'message';
  message: { id: string; type: 'image' };
};

export type LinePostbackEvent = LineEventBase & {
  type: 'postback';
  postback: { data: string };
};

export type LineFollowEvent = LineEventBase & { type: 'follow' };

export type UnknownLineEvent = LineEventBase & {
  type: string;
  [key: string]: unknown;
};

export type LineEvent =
  | LineTextMessageEvent
  | LineImageMessageEvent
  | LinePostbackEvent
  | LineFollowEvent
  | UnknownLineEvent;

export type LineWebhookPayload = { events: LineEvent[] };

export class LineEventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LineEventValidationError';
  }
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new LineEventValidationError(`Invalid ${field}`);
  }
  return value;
}

function parseSource(value: unknown): LineSource {
  if (!isRecord(value)) {
    throw new LineEventValidationError('Invalid event source');
  }

  const type = requiredString(value.type, 'event source type');
  const userId =
    value.userId === undefined
      ? undefined
      : requiredString(value.userId, 'source userId');

  if (type === 'user') {
    return { type, userId: requiredString(value.userId, 'source userId') };
  }
  if (type === 'group') {
    return {
      type,
      groupId: requiredString(value.groupId, 'source groupId'),
      ...(userId ? { userId } : {}),
    };
  }
  if (type === 'room') {
    return {
      type,
      roomId: requiredString(value.roomId, 'source roomId'),
      ...(userId ? { userId } : {}),
    };
  }

  throw new LineEventValidationError('Invalid event source type');
}

function parseEvent(value: unknown): LineEvent {
  if (!isRecord(value)) {
    throw new LineEventValidationError('Invalid event');
  }

  const base: LineEventBase = {
    webhookEventId: requiredString(value.webhookEventId, 'webhookEventId'),
    timestamp:
      typeof value.timestamp === 'number' &&
      Number.isSafeInteger(value.timestamp)
        ? value.timestamp
        : (() => {
            throw new LineEventValidationError('Invalid timestamp');
          })(),
    source: parseSource(value.source),
  };
  const type = requiredString(value.type, 'event type');

  if (type === 'message') {
    if (!isRecord(value.message)) {
      throw new LineEventValidationError('Invalid message');
    }
    const messageType = requiredString(value.message.type, 'message type');
    const messageId = requiredString(value.message.id, 'message id');
    if (messageType === 'text') {
      return {
        ...base,
        type,
        message: {
          id: messageId,
          type: 'text',
          text: requiredString(value.message.text, 'message text'),
        },
      };
    }
    if (messageType === 'image') {
      return { ...base, type, message: { id: messageId, type: 'image' } };
    }
    return {
      ...base,
      type,
      message: { id: messageId, type: messageType },
    } as UnknownLineEvent;
  }

  if (type === 'postback') {
    if (!isRecord(value.postback)) {
      throw new LineEventValidationError('Invalid postback');
    }
    return {
      ...base,
      type,
      postback: { data: requiredString(value.postback.data, 'postback data') },
    };
  }

  if (type === 'follow') {
    return { ...base, type };
  }

  return { ...base, type };
}

export function parseLineWebhookPayload(
  rawBody: string | Uint8Array,
  maxEvents = DEFAULT_MAX_EVENTS,
): LineWebhookPayload {
  let parsed: unknown;
  try {
    const body =
      typeof rawBody === 'string'
        ? rawBody
        : new TextDecoder('utf-8', { fatal: true }).decode(rawBody);
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new LineEventValidationError('Invalid JSON');
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.events)) {
    throw new LineEventValidationError('Invalid events');
  }
  if (parsed.events.length > maxEvents) {
    throw new LineEventValidationError('Too many events');
  }

  return { events: parsed.events.map(parseEvent) };
}
