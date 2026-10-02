import { createSupabaseAdminClient } from './supabase-admin.js';

export type ClaimResult = {
  outcome:
    'claimed' | 'terminal' | 'not_found' | 'inactive' | 'busy' | 'not_due';
  token?: string;
};
export type FinishResult =
  'succeeded' | 'requeued' | 'failed' | 'token_mismatch' | 'not_found';
export interface ProcessingJobStore {
  claim(jobId: string): Promise<ClaimResult>;
  succeed(jobId: string, token: string): Promise<FinishResult>;
  failOrRequeue(
    jobId: string,
    token: string,
    errorCode: string,
  ): Promise<FinishResult>;
}

type RpcClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
};
function one(data: unknown): Record<string, unknown> {
  return (
    ((Array.isArray(data) ? data[0] : data) as Record<string, unknown>) ?? {}
  );
}

export function createSupabaseProcessingJobStore(
  client: RpcClient = createSupabaseAdminClient(),
): ProcessingJobStore {
  return {
    async claim(jobId) {
      const { data, error } = await client.rpc('claim_processing_job', {
        p_job_id: jobId,
      });
      if (error) throw error;
      const row = one(data);
      return {
        outcome: row.outcome as ClaimResult['outcome'],
        token:
          typeof row.processing_token === 'string'
            ? row.processing_token
            : undefined,
      };
    },
    async succeed(jobId, token) {
      const { data, error } = await client.rpc('succeed_processing_job', {
        p_job_id: jobId,
        p_processing_token: token,
      });
      if (error) throw error;
      return one(data).outcome as FinishResult;
    },
    async failOrRequeue(jobId, token, errorCode) {
      const { data, error } = await client.rpc(
        'fail_or_requeue_processing_job',
        { p_job_id: jobId, p_processing_token: token, p_error: errorCode },
      );
      if (error) throw error;
      return one(data).outcome as FinishResult;
    },
  };
}
