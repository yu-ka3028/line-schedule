import { createHash } from 'node:crypto';

/**
 * Google Calendar event IDs accept lowercase letters a-v and digits. Keep the
 * operation key out of the ID itself: it may contain user-controlled or
 * otherwise sensitive data.
 */
export function googleCalendarEventIdFromOperationKey(
  operationKey: string,
): string {
  if (typeof operationKey !== 'string' || operationKey.length === 0)
    throw new Error('invalid operation key');

  return `ls${createHash('sha256').update(operationKey, 'utf8').digest('hex')}`;
}
