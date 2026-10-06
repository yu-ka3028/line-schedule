import { createSupabaseAdminClient } from './supabase-admin.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RpcClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
};

export type LineEventProcessingRecord = {
  userId: string;
  payloadCiphertext: string;
};

export interface LineEventProcessingStore {
  read(
    jobId: string,
    processingToken: string,
  ): Promise<LineEventProcessingRecord | null>;
}

function assertUuid(value: string, name: string): void {
  if (!UUID.test(value)) throw new Error(`invalid ${name}`);
}

export class SupabaseLineEventProcessingStore implements LineEventProcessingStore {
  constructor(private readonly client: RpcClient) {}

  async read(
    jobId: string,
    processingToken: string,
  ): Promise<LineEventProcessingRecord | null> {
    assertUuid(jobId, 'job id');
    assertUuid(processingToken, 'processing token');
    const { data, error } = await this.client.rpc(
      'read_line_event_for_processing_job',
      { p_job_id: jobId, p_processing_token: processingToken },
    );
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (row === null || row === undefined) return null;
    if (typeof row !== 'object' || row === null || Array.isArray(row))
      throw new Error('invalid line event processing RPC response');
    const record = row as {
      user_id?: unknown;
      payload_ciphertext?: unknown;
    };
    if (
      typeof record.user_id !== 'string' ||
      !UUID.test(record.user_id) ||
      typeof record.payload_ciphertext !== 'string' ||
      record.payload_ciphertext.length === 0
    )
      throw new Error('invalid line event processing RPC response');
    return {
      userId: record.user_id,
      payloadCiphertext: record.payload_ciphertext,
    };
  }
}

export function createSupabaseLineEventProcessingStore(): SupabaseLineEventProcessingStore {
  return new SupabaseLineEventProcessingStore(createSupabaseAdminClient());
}
