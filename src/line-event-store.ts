import type { SupabaseClient } from '@supabase/supabase-js';

import { readWebhookEncryptionKey } from './config.js';
import { encryptWebhookPayload } from './crypto.js';
import type { LineEvent, LineWebhookPayload } from './line-events.js';
import { createSupabaseAdminClient } from './supabase-admin.js';

export type LineEventSaveResult = { inserted: boolean };

export interface LineEventStore {
  save(payload: LineWebhookPayload): Promise<LineEventSaveResult>;
}

function messageType(event: LineEvent): string {
  if (event.type === 'message') {
    return `message_${(event.message as { type: string }).type}`;
  }
  return event.type;
}

function persistenceEvent(event: LineEvent): LineEvent {
  if (
    event.type === 'message' &&
    (event.message as { type?: string }).type === 'text'
  ) {
    const safeEvent = { ...event } as LineEvent & { replyToken?: string };
    delete safeEvent.replyToken;
    return safeEvent;
  }
  return event;
}

function isLineEventDuplicate(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const result = error as {
    code?: unknown;
    constraint?: unknown;
    message?: unknown;
    details?: unknown;
  };
  if (result.code !== '23505') return false;

  const constraint =
    typeof result.constraint === 'string' ? result.constraint : '';
  if (constraint.toLowerCase().includes('line_event_id')) return true;

  // Some PostgREST responses omit constraint but include the column in the
  // diagnostic text. Do not treat an unrelated unique violation as a duplicate.
  return [result.message, result.details].some(
    (value) =>
      typeof value === 'string' &&
      value.toLowerCase().includes('line_event_id'),
  );
}

export class SupabaseLineEventStore implements LineEventStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly encryptionKey: Buffer,
  ) {}

  async save(payload: LineWebhookPayload): Promise<LineEventSaveResult> {
    let inserted = false;
    // Each event is encrypted independently. This intentionally does not persist
    // the raw webhook body, which may contain unrelated users or group/room data.
    for (const event of payload.events) {
      if (event.source.type !== 'user') continue;

      const userResult = await this.client
        .from('users')
        .upsert(
          { line_user_id: event.source.userId },
          { onConflict: 'line_user_id' },
        )
        .select('id')
        .single();
      if (userResult.error) throw userResult.error;

      try {
        const eventResult = await this.client
          .from('inbound_events')
          .insert({
            user_id: userResult.data.id,
            line_event_id: event.webhookEventId,
            message_type: messageType(event),
            payload_ciphertext: encryptWebhookPayload(
              JSON.stringify(persistenceEvent(event)),
              this.encryptionKey,
            ),
          })
          .select('id')
          .single();
        if (eventResult.error) throw eventResult.error;
        inserted = true;
      } catch (error) {
        if (!isLineEventDuplicate(error)) throw error;
      }
    }
    return { inserted };
  }
}

export function createSupabaseLineEventStore(): SupabaseLineEventStore {
  return new SupabaseLineEventStore(
    createSupabaseAdminClient(),
    readWebhookEncryptionKey(),
  );
}
