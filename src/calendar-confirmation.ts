import {
  parseCalendarCommand,
  parseCalendarTextCommand,
  type CalendarCreateCommand,
} from './calendar-command.js';
import type {
  PendingCalendarConfirmation,
  PendingCalendarConfirmationStore,
} from './pending-calendar-confirmation-store.js';

export const CALENDAR_CONFIRMATION_TEXT =
  '予定を登録します。確認する場合は「確認」と送信してください。';
export const CALENDAR_CANCELLED_TEXT = '予定登録をキャンセルしました。';
export const CALENDAR_CONFIRMATION_TTL_MS = 5 * 60 * 1000;

export type CalendarConfirmationAction = 'confirm' | 'cancel';
export function parseCalendarConfirmationCommand(
  value: unknown,
): CalendarConfirmationAction | null {
  if (value === '確認') return 'confirm';
  if (value === 'キャンセル') return 'cancel';
  return null;
}

export async function saveCalendarCreateForConfirmation(
  text: unknown,
  userId: string,
  operationKey: string,
  store: PendingCalendarConfirmationStore,
  now = new Date(),
): Promise<{
  text: typeof CALENDAR_CONFIRMATION_TEXT;
  pending: PendingCalendarConfirmation;
}> {
  const command = parseCalendarTextCommand(text);
  const pending = await store.create({
    userId,
    operationKey,
    command,
    expiresAt: new Date(now.getTime() + CALENDAR_CONFIRMATION_TTL_MS),
  });
  return { text: CALENDAR_CONFIRMATION_TEXT, pending };
}

export async function saveValidatedCalendarCreateForConfirmation(
  command: CalendarCreateCommand,
  userId: string,
  operationKey: string,
  store: PendingCalendarConfirmationStore,
  now = new Date(),
): Promise<{
  text: typeof CALENDAR_CONFIRMATION_TEXT;
  pending: PendingCalendarConfirmation;
}> {
  const validatedCommand = parseCalendarCommand(command);
  const pending = await store.create({
    userId,
    operationKey,
    command: validatedCommand,
    expiresAt: new Date(now.getTime() + CALENDAR_CONFIRMATION_TTL_MS),
  });
  return { text: CALENDAR_CONFIRMATION_TEXT, pending };
}

export async function transitionCalendarConfirmation(
  actionText: unknown,
  userId: string,
  operationKey: string,
  store: PendingCalendarConfirmationStore,
  now = new Date(),
): Promise<PendingCalendarConfirmation | null> {
  const action = parseCalendarConfirmationCommand(actionText);
  if (!action) return null;
  return action === 'confirm'
    ? store.confirm(userId, operationKey, now)
    : store.cancel(userId, operationKey, now);
}
