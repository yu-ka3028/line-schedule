import { encryptWebhookPayload } from './crypto.js';
import {
  executeCalendarCreate,
  type CalendarCreateExecutorDependencies,
} from './calendar-create-executor.js';
import { GoogleCalendarEventConflictError } from './google-calendar-client.js';
import { ScheduleLinkCreateConflictError } from './schedule-link-store.js';
import type { ScheduleLink } from './schedule-link-store.js';
import { describe, expect, it, vi } from 'vitest';

const userId = '11111111-1111-4111-8111-111111111111';
const operationKey = '22222222-2222-4222-8222-222222222222';
const key = Buffer.alloc(32, 7);
const command = {
  type: 'calendar_create' as const,
  title: 'Planning',
  start: '2025-01-01T10:00:00+09:00',
  end: '2025-01-01T11:00:00+09:00',
  timezone: 'Asia/Tokyo',
};

function link(overrides: Partial<ScheduleLink> = {}): ScheduleLink {
  return {
    id: 'link-id',
    userId,
    googleCalendarId: 'primary',
    googleEventId: 'event-id',
    botEventId: operationKey,
    source: 'bot',
    status: 'active',
    ...overrides,
  };
}

type MockDependencies = CalendarCreateExecutorDependencies & {
  scheduleLinkStore: {
    getByBotEventId: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  connectionReader: { getByUserId: ReturnType<typeof vi.fn> };
  googleCalendarClient: { createEvent: ReturnType<typeof vi.fn> };
};

function dependencies(
  overrides: Partial<MockDependencies> = {},
): MockDependencies {
  return {
    scheduleLinkStore: {
      getByBotEventId: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(link()),
    },
    connectionReader: {
      getByUserId: vi.fn().mockResolvedValue({
        userId,
        googleAccountId: 'account-id',
        accessTokenCiphertext: encryptWebhookPayload('access-token', key),
        refreshTokenCiphertext: encryptWebhookPayload('refresh-token', key),
        tokenExpiresAt: null,
        scopes: ['calendar.events'],
      }),
    },
    googleCalendarClient: {
      createEvent: vi.fn().mockResolvedValue({ eventId: 'event-id' }),
    },
    encryptionKey: key,
    ...overrides,
  } as MockDependencies;
}

describe('executeCalendarCreate', () => {
  it('reuses an active link without calling Google', async () => {
    const deps = dependencies();
    deps.scheduleLinkStore.getByBotEventId.mockResolvedValue(link());

    await expect(
      executeCalendarCreate(userId, command, operationKey, deps),
    ).resolves.toEqual({ eventId: 'event-id', linkId: 'link-id' });
    expect(deps.googleCalendarClient.createEvent).not.toHaveBeenCalled();
  });

  it('does not reuse a deleted link', async () => {
    const deps = dependencies();
    deps.scheduleLinkStore.getByBotEventId.mockResolvedValue(
      link({ status: 'deleted' }),
    );

    await expect(
      executeCalendarCreate(userId, command, operationKey, deps),
    ).rejects.toMatchObject({ code: 'schedule_link_deleted' });
    expect(deps.googleCalendarClient.createEvent).not.toHaveBeenCalled();
  });

  it('creates the Google event and then the schedule link', async () => {
    const deps = dependencies();

    await expect(
      executeCalendarCreate(userId, command, operationKey, deps),
    ).resolves.toEqual({ eventId: 'event-id', linkId: 'link-id' });
    expect(deps.googleCalendarClient.createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'access-token' }),
      {
        title: command.title,
        start: command.start,
        end: command.end,
        timezone: command.timezone,
      },
      operationKey,
    );
    expect(deps.scheduleLinkStore.create).toHaveBeenCalledWith({
      userId,
      googleCalendarId: 'primary',
      googleEventId: 'event-id',
      botEventId: operationKey,
    });
  });

  it('reuses the winner of a schedule link conflict', async () => {
    const deps = dependencies();
    deps.scheduleLinkStore.create.mockRejectedValue(
      new ScheduleLinkCreateConflictError(link({ id: 'winner' })),
    );

    await expect(
      executeCalendarCreate(userId, command, operationKey, deps),
    ).resolves.toEqual({ eventId: 'event-id', linkId: 'winner' });
  });

  it('classifies a link conflict without a visible winner as reconciliation required', async () => {
    const deps = dependencies();
    deps.scheduleLinkStore.create.mockRejectedValue(
      new ScheduleLinkCreateConflictError(null),
    );

    await expect(
      executeCalendarCreate(userId, command, operationKey, deps),
    ).rejects.toMatchObject({ code: 'reconciliation_required' });
  });

  it('classifies link persistence failure after Google success as reconciliation required', async () => {
    const deps = dependencies();
    deps.scheduleLinkStore.create.mockRejectedValue(
      new Error('database failure'),
    );

    await expect(
      executeCalendarCreate(userId, command, operationKey, deps),
    ).rejects.toMatchObject({ code: 'reconciliation_required' });
  });

  it('does not expose secrets for connection or API failures', async () => {
    const deps = dependencies({
      connectionReader: {
        getByUserId: vi
          .fn()
          .mockRejectedValue(new Error('refresh-token-secret')),
      },
    });
    await expect(
      executeCalendarCreate(userId, command, operationKey, deps),
    ).rejects.toMatchObject({
      code: 'connection_unavailable',
    });
    await expect(
      executeCalendarCreate(
        userId,
        command,
        operationKey,
        dependencies({
          googleCalendarClient: {
            createEvent: vi
              .fn()
              .mockRejectedValue(new Error('access-token-secret')),
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'google_api_failure' });
    await expect(
      executeCalendarCreate(userId, command, operationKey, deps),
    ).rejects.not.toThrow('refresh-token-secret');
  });

  it('classifies an unresolved Google 409 as reconciliation required', async () => {
    const deps = dependencies();
    deps.googleCalendarClient.createEvent.mockRejectedValue(
      new GoogleCalendarEventConflictError('event-id'),
    );

    await expect(
      executeCalendarCreate(userId, command, operationKey, deps),
    ).rejects.toMatchObject({ code: 'reconciliation_required' });
  });

  it('validates the user and operation key', async () => {
    const deps = dependencies();
    await expect(
      executeCalendarCreate('not-a-uuid', command, operationKey, deps),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    for (const malformedKey of [
      'contains space',
      'contains\u0000control',
      '日本語',
    ]) {
      await expect(
        executeCalendarCreate(userId, command, malformedKey, deps),
      ).rejects.toMatchObject({ code: 'invalid_input' });
    }
    await expect(
      executeCalendarCreate(userId, command, 'x'.repeat(257), deps),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(
      executeCalendarCreate(
        userId,
        { ...command, title: '' },
        operationKey,
        deps,
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
