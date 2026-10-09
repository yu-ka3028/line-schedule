import { describe, expect, it, vi } from 'vitest';

import {
  CALENDAR_CREATE_SUCCESS_TEXT,
  CalendarCreateFlowError,
  executeCalendarCreateText,
} from './calendar-create-flow.js';

const validText = [
  '予定登録',
  'タイトル: Planning',
  '開始: 2026-10-10T10:00:00+09:00',
  '終了: 2026-10-10T11:00:00+09:00',
  'タイムゾーン: Asia/Tokyo',
].join('\n');

const dependencies = {
  scheduleLinkStore: {} as never,
  connectionReader: {} as never,
  encryptionKey: Buffer.alloc(32),
  googleCalendarClient: {} as never,
};

describe('calendar create text flow', () => {
  it('parses valid text and returns fixed success text', async () => {
    const execute = vi.fn().mockResolvedValue({
      eventId: 'event-id',
      linkId: 'link-id',
    });

    const result = await executeCalendarCreateText(
      validText,
      'user-id',
      'operation-key',
      { ...dependencies, execute },
    );

    expect(execute).toHaveBeenCalledWith(
      'user-id',
      {
        type: 'calendar_create',
        title: 'Planning',
        start: '2026-10-10T10:00:00+09:00',
        end: '2026-10-10T11:00:00+09:00',
        timezone: 'Asia/Tokyo',
      },
      'operation-key',
      expect.objectContaining(dependencies),
    );
    expect(result).toEqual({
      text: CALENDAR_CREATE_SUCCESS_TEXT,
      eventId: 'event-id',
      linkId: 'link-id',
    });
  });

  it('rejects unsupported natural language without executing', async () => {
    const execute = vi.fn();

    await expect(
      executeCalendarCreateText(
        '明日の10時に会議',
        'user-id',
        'operation-key',
        {
          ...dependencies,
          execute,
        },
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not expose input when execution fails', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('provider details'));

    await expect(
      executeCalendarCreateText(validText, 'user-id', 'operation-key', {
        ...dependencies,
        execute,
      }),
    ).rejects.toBeInstanceOf(CalendarCreateFlowError);
    await expect(
      executeCalendarCreateText(validText, 'user-id', 'operation-key', {
        ...dependencies,
        execute,
      }),
    ).rejects.not.toThrow('Planning');
  });
});
