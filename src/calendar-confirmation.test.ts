import { describe, expect, it } from 'vitest';

import {
  CALENDAR_CONFIRMATION_TTL_MS,
  CALENDAR_CONFIRMATION_TEXT,
  parseCalendarConfirmationCommand,
  saveValidatedCalendarCreateForConfirmation,
  transitionCalendarConfirmation,
} from './calendar-confirmation.js';
import type {
  PendingCalendarConfirmation,
  PendingCalendarConfirmationStore,
} from './pending-calendar-confirmation-store.js';

const command = {
  type: 'calendar_create' as const,
  title: 'Planning',
  start: '2026-10-10T10:00:00+09:00',
  end: '2026-10-10T11:00:00+09:00',
  timezone: 'Asia/Tokyo',
};
const userId = '123e4567-e89b-12d3-a456-426614174000';

function store(): PendingCalendarConfirmationStore & {
  row: PendingCalendarConfirmation | null;
} {
  const value = { row: null as PendingCalendarConfirmation | null };
  return {
    ...value,
    async create(input) {
      value.row = {
        userId: input.userId,
        operationKey: input.operationKey,
        command: input.command,
        expiresAt: input.expiresAt,
        status: 'pending',
        createdAt: new Date(0),
        updatedAt: new Date(0),
      };
      return value.row;
    },
    async get() {
      return value.row;
    },
    async confirm() {
      if (!value.row || value.row.status !== 'pending') return null;
      value.row = { ...value.row, status: 'confirmed' };
      return value.row;
    },
    async cancel() {
      if (!value.row || value.row.status !== 'pending') return null;
      value.row = { ...value.row, status: 'cancelled' };
      return value.row;
    },
  };
}

describe('calendar confirmation', () => {
  it('stores a validated command with a short TTL and fixed text', async () => {
    const pendingStore = store();
    const now = new Date('2026-01-01T00:00:00Z');
    const result = await saveValidatedCalendarCreateForConfirmation(
      command,
      userId,
      'operation-1',
      pendingStore,
      now,
    );
    expect(result.text).toBe(CALENDAR_CONFIRMATION_TEXT);
    expect(result.pending.expiresAt.getTime()).toBe(
      now.getTime() + CALENDAR_CONFIRMATION_TTL_MS,
    );
  });

  it('accepts only exact confirmation commands and transitions once', async () => {
    expect(parseCalendarConfirmationCommand('確認')).toBe('confirm');
    expect(parseCalendarConfirmationCommand(' 確認')).toBeNull();
    expect(parseCalendarConfirmationCommand('確認。')).toBeNull();
    expect(parseCalendarConfirmationCommand('キャンセル')).toBe('cancel');

    const pendingStore = store();
    await saveValidatedCalendarCreateForConfirmation(
      command,
      userId,
      'operation-1',
      pendingStore,
    );
    expect(
      await transitionCalendarConfirmation(
        '確認',
        userId,
        'operation-1',
        pendingStore,
      ),
    ).toMatchObject({ status: 'confirmed' });
    expect(
      await transitionCalendarConfirmation(
        '確認',
        userId,
        'operation-1',
        pendingStore,
      ),
    ).toBeNull();
  });
});
