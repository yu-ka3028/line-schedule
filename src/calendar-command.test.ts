import { describe, expect, it } from 'vitest';

import {
  CalendarCommandValidationError,
  parseCalendarCommand,
  parseCalendarTextCommand,
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

describe('calendar text command parser', () => {
  const text = [
    '予定登録',
    'タイトル: Planning 🗓️',
    '開始: 2026-10-10T10:00:00+09:00',
    '終了: 2026-10-10T11:00:00+09:00',
    'タイムゾーン: Asia/Tokyo',
  ].join('\n');

  it('parses the strict text format', () => {
    expect(parseCalendarTextCommand(text)).toEqual({
      type: 'calendar_create',
      title: 'Planning 🗓️',
      start: '2026-10-10T10:00:00+09:00',
      end: '2026-10-10T11:00:00+09:00',
      timezone: 'Asia/Tokyo',
    });
  });

  it('accepts CRLF and CR line endings without trimming content', () => {
    expect(parseCalendarTextCommand(text.replaceAll('\n', '\r\n'))).toEqual(
      parseCalendarTextCommand(text),
    );
    expect(() => parseCalendarTextCommand(`${text}\n`)).toThrow(
      CalendarCommandValidationError,
    );
  });

  it.each([
    ['missing field', text.replace('終了:', '余分:')],
    ['duplicate field', text.replace('終了:', '開始:')],
    ['extra line', `${text}\n備考: secret`],
    ['invalid datetime', text.replace('10:00:00', 'not-a-date')],
    ['end not after start', text.replace('11:00:00', '09:00:00')],
    ['invalid timezone', text.replace('Asia/Tokyo', 'Not/A_Timezone')],
    ['empty field', text.replace('タイトル: Planning 🗓️', 'タイトル: ')],
  ])('rejects %s', (_, input) => {
    expect(() => parseCalendarTextCommand(input)).toThrow(
      CalendarCommandValidationError,
    );
  });

  it('rejects oversized body and fields', () => {
    expect(() => parseCalendarTextCommand(`${text}x`.repeat(200))).toThrow(
      CalendarCommandValidationError,
    );
    expect(() =>
      parseCalendarTextCommand(text.replace('Planning 🗓️', 'x'.repeat(201))),
    ).toThrow(CalendarCommandValidationError);
    expect(() =>
      parseCalendarTextCommand(text.replace('Asia/Tokyo', 'x'.repeat(65))),
    ).toThrow(CalendarCommandValidationError);
  });

  it('does not interpret natural language and never exposes its body in errors', () => {
    const secret = 'do-not-log-this-secret';
    expect(() => parseCalendarTextCommand(`明日の会議 ${secret}`)).toThrow(
      'Unsupported calendar text command',
    );
    try {
      parseCalendarTextCommand(`明日の会議 ${secret}`);
    } catch (error) {
      expect(error).toBeInstanceOf(CalendarCommandValidationError);
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
