import { describe, expect, it, vi } from 'vitest';

import {
  ScheduleLinkCreateConflictError,
  SupabaseScheduleLinkStore,
} from './schedule-link-store.js';

const link = {
  userId: '00000000-0000-4000-8000-000000000001',
  googleCalendarId: 'primary',
  googleEventId: 'google-event',
  botEventId: 'bot-event',
};

const row = {
  id: '00000000-0000-4000-8000-000000000002',
  user_id: link.userId,
  google_calendar_id: link.googleCalendarId,
  google_event_id: link.googleEventId,
  bot_event_id: link.botEventId,
  source: 'bot',
  status: 'active',
};

describe('SupabaseScheduleLinkStore', () => {
  it('classifies a PostgREST unique race and rereads the winner', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: {
                code: '23505',
                message:
                  'duplicate key value violates unique constraint "schedule_links_user_bot_event_unique"',
                details:
                  'Key (user_id, bot_event_id)=(redacted) already exists.',
                hint: null,
              },
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: row, error: null }),
            }),
          }),
        }),
      });
    const store = new SupabaseScheduleLinkStore({ from } as never);

    const error = await store.create(link).catch((value) => value);

    expect(error).toBeInstanceOf(ScheduleLinkCreateConflictError);
    expect(error).toMatchObject({
      name: 'ScheduleLinkCreateConflictError',
      existingLink: expect.objectContaining({ botEventId: link.botEventId }),
    });
    expect(error).not.toHaveProperty('cause');
  });

  it('returns a conflict without exposing a failed reread error', async () => {
    const from = vi
      .fn()
      .mockReturnValueOnce({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: {
                code: '23505',
                message:
                  'duplicate key value violates unique constraint "schedule_links_user_bot_event_unique"',
                details:
                  'Key (user_id, bot_event_id)=(redacted) already exists.',
                hint: null,
              },
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: null,
                error: {
                  code: 'PGRST116',
                  message: 'single JSON object requested',
                  details: 'redacted reread detail',
                  hint: null,
                },
              }),
            }),
          }),
        }),
      });
    const store = new SupabaseScheduleLinkStore({ from } as never);

    await expect(store.create(link)).rejects.toMatchObject({
      name: 'ScheduleLinkCreateConflictError',
      existingLink: null,
    });
  });
});
