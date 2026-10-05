import { describe, expect, it } from 'vitest';

import {
  CalendarCommandValidationError,
  parseCalendarCommand,
} from './calendar-command.js';

describe('calendar command validation', () => {
  const valid = {
    type: 'calendar_create',
    title: 'Planning',
    start: '2025-05-01T10:00:00+09:00',
    end: '2025-05-01T11:00:00+09:00',
    timezone: 'Asia/Tokyo',
  };

  it('accepts a strict calendar_create command', () => {
    expect(parseCalendarCommand(valid)).toEqual(valid);
  });

  it.each([
    ['wrong type', { ...valid, type: 'calendar_update' }],
    ['missing title', { ...valid, title: undefined }],
    ['date only', { ...valid, start: '2025-05-01' }],
    ['invalid date', { ...valid, start: '2025-02-30T10:00:00Z' }],
    ['end before start', { ...valid, end: '2025-05-01T09:00:00+09:00' }],
    ['invalid timezone', { ...valid, timezone: 'Not/A_Timezone' }],
    ['extra field', { ...valid, calendarId: 'primary' }],
  ])('rejects %s', (_, command) => {
    expect(() => parseCalendarCommand(command)).toThrow(
      CalendarCommandValidationError,
    );
  });
});
