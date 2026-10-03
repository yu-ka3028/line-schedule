import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseAdminClient } from './supabase-admin.js';

export type DeliveryClaim =
  | { outcome: 'claimed'; recipientId: string; retryKey: string }
  | {
      outcome:
        | 'sent'
        | 'busy'
        | 'not_due'
        | 'blocked'
        | 'not_found'
        | 'expired'
        | 'failed';
    };

export interface LinePushStore {
  claim(jobId: string, processingToken: string): Promise<DeliveryClaim>;
  sent(
    jobId: string,
    processingToken: string,
    retryKey: string,
  ): Promise<'sent' | 'token_mismatch' | 'not_found'>;
  fail(
    jobId: string,
    processingToken: string,
    retryKey: string,
    errorCode: 'retryable' | 'blocked',
  ): Promise<'requeued' | 'failed' | 'token_mismatch' | 'not_found'>;
}

type RpcClient = Pick<SupabaseClient, 'rpc'>;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(value: string, name: string): void {
  if (!UUID.test(value)) throw new Error(`invalid ${name}`);
}
function row(data: unknown): Record<string, unknown> {
  const value = Array.isArray(data) ? data[0] : data;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid line push RPC response');
  return value as Record<string, unknown>;
}

export class SupabaseLinePushStore implements LinePushStore {
  constructor(private readonly client: RpcClient) {}

  async claim(jobId: string, processingToken: string): Promise<DeliveryClaim> {
    uuid(jobId, 'job id');
    uuid(processingToken, 'processing token');
    const { data, error } = await this.client.rpc('claim_line_push_delivery', {
      p_job_id: jobId,
      p_processing_token: processingToken,
    });
    if (error) throw error;
    const result = row(data);
    const outcome = result.outcome;
    if (outcome === 'claimed') {
      if (
        typeof result.recipient_id !== 'string' ||
        typeof result.retry_key !== 'string'
      )
        throw new Error('invalid line push claim');
      return {
        outcome,
        recipientId: result.recipient_id,
        retryKey: result.retry_key,
      };
    }
    if (
      typeof outcome !== 'string' ||
      ![
        'sent',
        'busy',
        'not_due',
        'blocked',
        'not_found',
        'expired',
        'failed',
      ].includes(outcome)
    )
      throw new Error('invalid line push outcome');
    return {
      outcome: outcome as Exclude<
        DeliveryClaim,
        { outcome: 'claimed' }
      >['outcome'],
    };
  }

  async sent(jobId: string, processingToken: string, retryKey: string) {
    return this.finish(
      'complete_line_push_delivery',
      jobId,
      processingToken,
      retryKey,
    );
  }

  async fail(
    jobId: string,
    processingToken: string,
    retryKey: string,
    errorCode: 'retryable' | 'blocked',
  ) {
    uuid(jobId, 'job id');
    uuid(processingToken, 'processing token');
    uuid(retryKey, 'retry key');
    const { data, error } = await this.client.rpc('fail_line_push_delivery', {
      p_job_id: jobId,
      p_processing_token: processingToken,
      p_retry_key: retryKey,
      p_error: errorCode,
    });
    if (error) throw error;
    const outcome = row(data).outcome;
    if (
      typeof outcome !== 'string' ||
      !['requeued', 'failed', 'token_mismatch', 'not_found'].includes(outcome)
    )
      throw new Error('invalid line push finish outcome');
    return outcome as 'requeued' | 'failed' | 'token_mismatch' | 'not_found';
  }

  private async finish(
    name: string,
    jobId: string,
    processingToken: string,
    retryKey: string,
  ) {
    uuid(jobId, 'job id');
    uuid(processingToken, 'processing token');
    uuid(retryKey, 'retry key');
    const { data, error } = await this.client.rpc(name, {
      p_job_id: jobId,
      p_processing_token: processingToken,
      p_retry_key: retryKey,
    });
    if (error) throw error;
    const outcome = row(data).outcome;
    if (
      outcome !== 'sent' &&
      outcome !== 'token_mismatch' &&
      outcome !== 'not_found'
    )
      throw new Error('invalid line push finish outcome');
    return outcome as 'sent' | 'token_mismatch' | 'not_found';
  }
}

export function createSupabaseLinePushStore(): LinePushStore {
  return new SupabaseLinePushStore(createSupabaseAdminClient());
}
