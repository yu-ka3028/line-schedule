import { createSupabaseAdminClient } from './supabase-admin.js';
import type { QstashPublisher } from './qstash-publisher.js';

export type PublishLease = {
  outcome: 'claimed' | 'published' | 'busy' | 'not_due' | 'not_found';
  token?: string;
};
export interface LineOutboxStore {
  claim(jobId: string): Promise<PublishLease>;
  finish(
    jobId: string,
    token: string,
    result: { messageId?: string; error?: string },
  ): Promise<string>;
}

type RpcClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
};
function row(data: unknown): Record<string, unknown> {
  const value = Array.isArray(data) ? data[0] : data;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid outbox RPC response');
  return value as Record<string, unknown>;
}

export function createSupabaseLineOutboxStore(
  client: RpcClient = createSupabaseAdminClient(),
): LineOutboxStore {
  return {
    async claim(jobId) {
      const result = await client.rpc('claim_line_event_publish', {
        p_job_id: jobId,
      });
      if (result.error) throw result.error;
      const value = row(result.data);
      const outcome = value.outcome;
      if (
        typeof outcome !== 'string' ||
        !['claimed', 'published', 'busy', 'not_due', 'not_found'].includes(
          outcome,
        )
      )
        throw new Error('invalid outbox outcome');
      if (outcome === 'claimed' && typeof value.lease_token !== 'string')
        throw new Error('missing outbox lease');
      return {
        outcome: outcome as PublishLease['outcome'],
        token:
          typeof value.lease_token === 'string' ? value.lease_token : undefined,
      };
    },
    async finish(jobId, token, result) {
      const response = await client.rpc('finish_line_event_publish', {
        p_job_id: jobId,
        p_lease_token: token,
        p_success: result.messageId !== undefined,
        p_message_id: result.messageId ?? null,
        p_error: result.error ?? null,
      });
      if (response.error) throw response.error;
      const outcome = row(response.data).outcome;
      if (typeof outcome !== 'string')
        throw new Error('invalid outbox finish response');
      return outcome;
    },
  };
}

export async function dispatchLineEventPublish(
  jobId: string,
  store: LineOutboxStore,
  publisher: QstashPublisher,
): Promise<'published' | 'retry_due' | 'skipped'> {
  const lease = await store.claim(jobId);
  if (lease.outcome !== 'claimed' || !lease.token) return 'skipped';
  try {
    const result = await publisher.publish(jobId);
    const outcome = await store.finish(jobId, lease.token, result);
    return outcome === 'published' ? 'published' : 'retry_due';
  } catch {
    await store.finish(jobId, lease.token, { error: 'publish_failed' });
    return 'retry_due';
  }
}
