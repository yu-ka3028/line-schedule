import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseAdminClient } from './supabase-admin.js';

export type SyncUsageMetadata = {
  schema_version: 1;
  outcome: string;
  operation?: 'line_push';
  total_ms?: number;
  persistence_ms?: number;
  reply_ms?: number;
  publish_status?: 'published' | 'retry_due' | 'skipped';
};

export interface UsageLogStore {
  record(metadata: SyncUsageMetadata): Promise<void>;
}

export class SupabaseUsageLogStore implements UsageLogStore {
  constructor(private readonly client: SupabaseClient) {}

  async record(metadata: SyncUsageMetadata): Promise<void> {
    const result = await this.client.from('usage_logs').insert({
      operation: metadata.operation
        ? metadata.operation
        : metadata.publish_status
          ? 'line_outbox_publish'
          : 'sync_text_webhook',
      quantity: 1,
      estimated_cost_yen: 0,
      metadata,
    });
    if (result.error) throw result.error;
  }
}

export function createSupabaseUsageLogStore(): UsageLogStore {
  return new SupabaseUsageLogStore(createSupabaseAdminClient());
}
