import { createSupabaseAdminClient } from './supabase-admin.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLAIM_OUTCOMES = new Set([
  'claimed',
  'terminal',
  'not_found',
  'inactive',
  'busy',
  'not_due',
  'expired',
]);
const FINISH_OUTCOMES = new Set([
  'succeeded',
  'requeued',
  'failed',
  'token_mismatch',
  'not_found',
]);

export type ClaimResult = {
  outcome:
    | 'claimed'
    | 'terminal'
    | 'not_found'
    | 'inactive'
    | 'busy'
    | 'not_due'
    | 'expired';
  token?: string;
  jobType?: string;
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
  const row = Array.isArray(data) ? data[0] : data;
  if (typeof row !== 'object' || row === null || Array.isArray(row))
    throw new Error('invalid processing job RPC response');
  return row as Record<string, unknown>;
}

function assertUuid(value: string, name: string): void {
  if (!UUID.test(value)) throw new Error(`invalid ${name}`);
}

function claimOutcome(value: unknown): ClaimResult['outcome'] {
  if (typeof value !== 'string' || !CLAIM_OUTCOMES.has(value))
    throw new Error('invalid processing job claim outcome');
  return value as ClaimResult['outcome'];
}

function finishOutcome(value: unknown): FinishResult {
  if (typeof value !== 'string' || !FINISH_OUTCOMES.has(value))
    throw new Error('invalid processing job finish outcome');
  return value as FinishResult;
}

export function createSupabaseProcessingJobStore(
  client: RpcClient = createSupabaseAdminClient(),
): ProcessingJobStore {
  return {
    async claim(jobId) {
      assertUuid(jobId, 'job id');
      const { data, error } = await client.rpc('claim_processing_job', {
        p_job_id: jobId,
      });
      if (error) throw error;
      const row = one(data);
      const outcome = claimOutcome(row.outcome);
      const token = row.processing_token;
      const jobType = row.job_type;
      if (outcome === 'claimed') {
        if (typeof token !== 'string')
          throw new Error('claimed job has no processing token');
        assertUuid(token, 'processing token');
      }
      return {
        outcome,
        token: typeof token === 'string' ? token : undefined,
        jobType: typeof jobType === 'string' ? jobType : undefined,
      };
    },
    async succeed(jobId, token) {
      assertUuid(jobId, 'job id');
      assertUuid(token, 'processing token');
      const { data, error } = await client.rpc('succeed_processing_job', {
        p_job_id: jobId,
        p_processing_token: token,
      });
      if (error) throw error;
      return finishOutcome(one(data).outcome);
    },
    async failOrRequeue(jobId, token, errorCode) {
      assertUuid(jobId, 'job id');
      assertUuid(token, 'processing token');
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(errorCode))
        throw new Error('invalid processing job error code');
      const { data, error } = await client.rpc(
        'fail_or_requeue_processing_job',
        { p_job_id: jobId, p_processing_token: token, p_error: errorCode },
      );
      if (error) throw error;
      return finishOutcome(one(data).outcome);
    },
  };
}
