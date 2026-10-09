import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseAdminClient } from './supabase-admin.js';

export type ScheduleLink = {
  id: string;
  userId: string;
  googleCalendarId: string;
  googleEventId: string;
  botEventId: string;
  source: 'bot';
  status: 'active' | 'deleted';
};

export type ScheduleLinkCreate = Omit<ScheduleLink, 'id' | 'source' | 'status'>;

export class ScheduleLinkCreateConflictError extends Error {
  constructor(readonly existingLink: ScheduleLink | null) {
    super('schedule link already exists');
    this.name = 'ScheduleLinkCreateConflictError';
  }
}

export interface ScheduleLinkStore {
  getByBotEventId(
    userId: string,
    botEventId: string,
  ): Promise<ScheduleLink | null>;
  create(link: ScheduleLinkCreate): Promise<ScheduleLink>;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function required(value: string, name: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024)
    throw new Error(`invalid ${name}`);
}

function isBotEventUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; constraint?: unknown };
  return (
    value.code === '23505' &&
    value.constraint === 'schedule_links_user_bot_event_unique'
  );
}

function validateLink(link: ScheduleLinkCreate): void {
  if (!UUID.test(link.userId)) throw new Error('invalid user ID');
  required(link.googleCalendarId, 'Google calendar ID');
  required(link.googleEventId, 'Google event ID');
  required(link.botEventId, 'bot event ID');
}

function toScheduleLink(row: Record<string, unknown>): ScheduleLink {
  if (
    typeof row.id !== 'string' ||
    typeof row.user_id !== 'string' ||
    typeof row.google_calendar_id !== 'string' ||
    typeof row.google_event_id !== 'string' ||
    typeof row.bot_event_id !== 'string' ||
    row.source !== 'bot' ||
    (row.status !== 'active' && row.status !== 'deleted')
  )
    throw new Error('invalid schedule link row');
  return {
    id: row.id,
    userId: row.user_id,
    googleCalendarId: row.google_calendar_id,
    googleEventId: row.google_event_id,
    botEventId: row.bot_event_id,
    source: 'bot',
    status: row.status,
  };
}

export class SupabaseScheduleLinkStore implements ScheduleLinkStore {
  constructor(private readonly client: Pick<SupabaseClient, 'from'>) {}

  async getByBotEventId(
    userId: string,
    botEventId: string,
  ): Promise<ScheduleLink | null> {
    if (!UUID.test(userId)) throw new Error('invalid user ID');
    required(botEventId, 'bot event ID');
    const { data, error } = await this.client
      .from('schedule_links')
      .select(
        'id,user_id,google_calendar_id,google_event_id,bot_event_id,source,status',
      )
      .eq('user_id', userId)
      .eq('bot_event_id', botEventId)
      .maybeSingle();
    if (error) throw error;
    return data ? toScheduleLink(data as Record<string, unknown>) : null;
  }

  async create(link: ScheduleLinkCreate): Promise<ScheduleLink> {
    validateLink(link);
    const { data, error } = await this.client
      .from('schedule_links')
      .insert({
        user_id: link.userId,
        google_calendar_id: link.googleCalendarId,
        google_event_id: link.googleEventId,
        bot_event_id: link.botEventId,
        source: 'bot',
        status: 'active',
      })
      .select(
        'id,user_id,google_calendar_id,google_event_id,bot_event_id,source,status',
      )
      .single();
    if (error) {
      if (isBotEventUniqueViolation(error)) {
        let existingLink: ScheduleLink | null = null;
        try {
          existingLink = await this.getByBotEventId(
            link.userId,
            link.botEventId,
          );
        } catch {
          // Keep the database error outside the store interface. The executor
          // can retry its read when the competing transaction is visible.
        }
        throw new ScheduleLinkCreateConflictError(existingLink);
      }
      throw error;
    }
    return toScheduleLink(data as Record<string, unknown>);
  }
}

export function createSupabaseScheduleLinkStore(): ScheduleLinkStore {
  return new SupabaseScheduleLinkStore(createSupabaseAdminClient());
}
