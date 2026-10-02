import type { SupabaseClient } from '@supabase/supabase-js';

import { readWebhookEncryptionKey } from './config.js';
import { encryptWebhookPayload } from './crypto.js';
import type { LineEvent, LineWebhookPayload } from './line-events.js';
import { createSupabaseAdminClient } from './supabase-admin.js';

export interface LineEventStore {
  save(payload: LineWebhookPayload): Promise<void>;
}

function messageType(event: LineEvent): string {
  if (event.type === 'message') {
    return `message_${(event.message as { type: string }).type}`;
  }
  return event.type;
}

export class SupabaseLineEventStore implements LineEventStore {
  constructor(
    private readonly client: SupabaseClient,
    private readonly encryptionKey: Buffer,
  ) {}

  async save(payload: LineWebhookPayload): Promise<void> {
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

      const eventResult = await this.client.from('inbound_events').upsert(
        {
          user_id: userResult.data.id,
          line_event_id: event.webhookEventId,
          message_type: messageType(event),
          payload_ciphertext: encryptWebhookPayload(
            JSON.stringify(event),
            this.encryptionKey,
          ),
        },
        { onConflict: 'line_event_id', ignoreDuplicates: true },
      );
      // ignoreDuplicates applies specifically to the line_event_id conflict
      // target; all other persistence errors remain failures.
      if (eventResult.error) throw eventResult.error;
    }
  }
}

export function createSupabaseLineEventStore(): SupabaseLineEventStore {
  return new SupabaseLineEventStore(
    createSupabaseAdminClient(),
    readWebhookEncryptionKey(),
  );
}
