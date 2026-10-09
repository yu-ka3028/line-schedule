import { encryptWebhookPayload } from './crypto.js';
import {
  CALENDAR_CREATE_SUCCESS_MESSAGE,
  executeCalendarCreateFlow,
} from './calendar-create-flow.js';
import { executeCalendarCreate } from './calendar-create-executor.js';
import type { CalendarCreateFlowDependencies } from './calendar-create-flow.js';
import type { ScheduleLink } from './schedule-link-store.js';
import { describe, expect, it, vi } from 'vitest';

const userId = '11111111-1111-4111-8111-111111111111';
const operationKey = '22222222-2222-4222-8222-222222222222';
const key = Buffer.alloc(32, 7);
const text = [
  '予定登録',
  'タイトル: Planning private-body',
  '開始: 2026-10-10T10:00:00+09:00',
  '終了: 2026-10-10T11:00:00+09:00',
  'タイムゾーン: Asia/Tokyo',
].join('\n');

function link(): ScheduleLink {
  return {
    id: 'link-id',
    userId,
    googleCalendarId: 'primary',
    googleEventId: 'event-id',
    botEventId: operationKey,
    source: 'bot',
    status: 'active',
  };
}

function dependencies(
  overrides: Partial<CalendarCreateFlowDependencies> = {},
): CalendarCreateFlowDependencies {
  return {
    executeCalendarCreate,
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
    encryptionKey: key,
    googleCalendarClient: {
      createEvent: vi.fn().mockResolvedValue({ eventId: 'event-id' }),
    },
    ...overrides,
  };
}

describe('executeCalendarCreateFlow', () => {
  it('classifies natural language as unsupported', async () => {
    await expect(
      executeCalendarCreateFlow(
        '明日の会議 private-secret',
        userId,
        operationKey,
        dependencies(),
      ),
    ).resolves.toEqual({ outcome: 'unsupported' });
  });

  it('classifies malformed structured text as invalid', async () => {
    await expect(
      executeCalendarCreateFlow(
        text.replace('終了:', '備考:'),
        userId,
        operationKey,
        dependencies(),
      ),
    ).resolves.toEqual({ outcome: 'invalid' });
  });

  it('passes the parsed command, user, and job operation key to the executor', async () => {
    const deps = dependencies();
    await executeCalendarCreateFlow(text, userId, operationKey, deps);
    expect(deps.googleCalendarClient.createEvent).toHaveBeenCalledWith(
      expect.anything(),
      {
        title: 'Planning private-body',
        start: '2026-10-10T10:00:00+09:00',
        end: '2026-10-10T11:00:00+09:00',
        timezone: 'Asia/Tokyo',
      },
      operationKey,
    );
  });

  it('reuses an existing link and returns the fixed safe message', async () => {
    const deps = dependencies();
    deps.scheduleLinkStore.getByBotEventId = vi.fn().mockResolvedValue(link());
    const result = await executeCalendarCreateFlow(
      text,
      userId,
      operationKey,
      deps,
    );
    expect(result).toEqual({
      outcome: 'success',
      pushText: CALENDAR_CREATE_SUCCESS_MESSAGE,
    });
    expect(deps.googleCalendarClient.createEvent).not.toHaveBeenCalled();
    if (result.outcome !== 'success') throw new Error('unexpected outcome');
    expect(result.pushText).not.toContain('private-body');
    expect(result.pushText).not.toContain('http');
  });

  it.each([
    [
      'connection unavailable',
      { getByUserId: vi.fn().mockResolvedValue(null) },
      'connection_unavailable',
    ],
    [
      'Google API failure',
      {
        createEvent: vi
          .fn()
          .mockRejectedValue(new Error('secret-token-or-url')),
      },
      'google_api_failure',
    ],
  ])('classifies %s safely', async (_, override, outcome) => {
    const deps = dependencies(
      'getByUserId' in override
        ? { connectionReader: override }
        : { googleCalendarClient: override },
    );
    await expect(
      executeCalendarCreateFlow(text, userId, operationKey, deps),
    ).resolves.toEqual({ outcome });
  });

  it('classifies reconciliation failure without exposing details', async () => {
    const deps = dependencies({
      scheduleLinkStore: {
        getByBotEventId: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockRejectedValue(new Error('private database detail')),
      },
    });
    await expect(
      executeCalendarCreateFlow(text, userId, operationKey, deps),
    ).resolves.toEqual({ outcome: 'reconciliation_required' });
  });
});
