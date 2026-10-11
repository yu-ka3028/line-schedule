import type { SupabaseClient } from '@supabase/supabase-js';

import {
  decryptWebhookPayload,
  encryptWebhookPayload,
  isEncryptedPayload,
} from './crypto.js';
import {
  parseCalendarCommand,
  type CalendarCreateCommand,
} from './calendar-command.js';
import { createSupabaseAdminClient } from './supabase-admin.js';

export type PendingCalendarConfirmationStatus =
  | 'pending'
  | 'processing'
  | 'retryable'
  | 'confirmed'
  | 'cancelled'
  | 'expired';

export type PendingCalendarConfirmation = {
  userId: string;
  operationKey: string;
  command: CalendarCreateCommand;
  expiresAt: Date;
  status: PendingCalendarConfirmationStatus;
  createdAt: Date;
  updatedAt: Date;
  leaseUntil?: Date;
  processingToken?: string;
};

export interface PendingCalendarConfirmationStore {
  create(input: {
    userId: string;
    operationKey: string;
    command: CalendarCreateCommand;
    expiresAt: Date;
  }): Promise<PendingCalendarConfirmation>;
  get(
    userId: string,
    operationKey: string,
  ): Promise<PendingCalendarConfirmation | null>;
  confirm(
    userId: string,
    operationKey: string,
    now: Date,
  ): Promise<PendingCalendarConfirmation | null>;
  cancel(
    userId: string,
    operationKey: string,
    now: Date,
  ): Promise<PendingCalendarConfirmation | null>;
  /** Atomically claims the user's current pending/retryable confirmation. */
  claimPending?(
    userId: string,
    now: Date,
  ): Promise<PendingCalendarConfirmation | null>;
  finish?(
    userId: string,
    operationKey: string,
    processingToken: string,
    now: Date,
  ): Promise<boolean>;
  requeue?(
    userId: string,
    operationKey: string,
    processingToken: string,
    now: Date,
  ): Promise<boolean>;
  getPending?(userId: string): Promise<PendingCalendarConfirmation | null>;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPERATION_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/;

function validateIdentity(userId: string, operationKey: string): void {
  if (!UUID.test(userId)) throw new Error('invalid user ID');
  if (!OPERATION_KEY.test(operationKey))
    throw new Error('invalid operation key');
}

function toRecord(
  row: Record<string, unknown>,
  key: Buffer,
): PendingCalendarConfirmation {
  if (
    typeof row.user_id !== 'string' ||
    typeof row.operation_key !== 'string' ||
    typeof row.command_ciphertext !== 'string' ||
    !isEncryptedPayload(row.command_ciphertext) ||
    typeof row.expires_at !== 'string' ||
    typeof row.created_at !== 'string' ||
    typeof row.updated_at !== 'string' ||
    ![
      'pending',
      'processing',
      'retryable',
      'confirmed',
      'cancelled',
      'expired',
    ].includes(String(row.status))
  )
    throw new Error('invalid pending confirmation row');
  const command = parseCalendarCommand(
    JSON.parse(decryptWebhookPayload(row.command_ciphertext, key)),
  );
  return {
    userId: row.user_id,
    operationKey: row.operation_key,
    command,
    expiresAt: new Date(row.expires_at),
    status: row.status as PendingCalendarConfirmationStatus,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    ...(typeof row.lease_until === 'string'
      ? { leaseUntil: new Date(row.lease_until) }
      : {}),
    ...(typeof row.processing_token === 'string'
      ? { processingToken: row.processing_token }
      : {}),
  };
}

export class SupabasePendingCalendarConfirmationStore implements PendingCalendarConfirmationStore {
  constructor(
    private readonly client: Pick<SupabaseClient, 'from' | 'rpc'>,
    private readonly encryptionKey: Buffer,
  ) {}

  async create(input: {
    userId: string;
    operationKey: string;
    command: CalendarCreateCommand;
    expiresAt: Date;
  }): Promise<PendingCalendarConfirmation> {
    validateIdentity(input.userId, input.operationKey);
    const command = parseCalendarCommand(input.command);
    if (
      !(input.expiresAt instanceof Date) ||
      Number.isNaN(input.expiresAt.getTime())
    )
      throw new Error('invalid expiration');
    const ciphertext = encryptWebhookPayload(
      JSON.stringify(command),
      this.encryptionKey,
    );
    const { data, error } = await this.client
      .from('pending_calendar_confirmations')
      .insert({
        user_id: input.userId,
        operation_key: input.operationKey,
        command_ciphertext: ciphertext,
        confirmation_ciphertext: encryptWebhookPayload(
          '確認',
          this.encryptionKey,
        ),
        expires_at: input.expiresAt.toISOString(),
      })
      .select(
        'user_id,operation_key,command_ciphertext,expires_at,status,processing_token,created_at,updated_at',
      )
      .single();
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        const existing = await this.get(input.userId, input.operationKey);
        if (existing) return existing;
      }
      throw error;
    }
    return toRecord(data as Record<string, unknown>, this.encryptionKey);
  }

  async get(
    userId: string,
    operationKey: string,
  ): Promise<PendingCalendarConfirmation | null> {
    validateIdentity(userId, operationKey);
    const { data, error } = await this.client
      .from('pending_calendar_confirmations')
      .select(
        'user_id,operation_key,command_ciphertext,expires_at,status,processing_token,created_at,updated_at,lease_until',
      )
      .eq('user_id', userId)
      .eq('operation_key', operationKey)
      .maybeSingle();
    if (error) throw error;
    return data
      ? toRecord(data as Record<string, unknown>, this.encryptionKey)
      : null;
  }

  private async transition(
    action: 'confirm' | 'cancel',
    userId: string,
    operationKey: string,
    now: Date,
  ): Promise<PendingCalendarConfirmation | null> {
    validateIdentity(userId, operationKey);
    if (!(now instanceof Date) || Number.isNaN(now.getTime()))
      throw new Error('invalid time');
    const { data, error } = await this.client.rpc(
      `${action}_pending_calendar_confirmation`,
      {
        p_user_id: userId,
        p_operation_key: operationKey,
        p_now: now.toISOString(),
      },
    );
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    const existing = await this.get(userId, operationKey);
    if (!existing) throw new Error('pending confirmation disappeared');
    return existing;
  }

  confirm(userId: string, operationKey: string, now: Date) {
    return this.transition('confirm', userId, operationKey, now);
  }
  cancel(userId: string, operationKey: string, now: Date) {
    return this.transition('cancel', userId, operationKey, now);
  }

  async getPending(
    userId: string,
  ): Promise<PendingCalendarConfirmation | null> {
    if (!UUID.test(userId)) throw new Error('invalid user ID');
    const { data, error } = await this.client
      .from('pending_calendar_confirmations')
      .select(
        'user_id,operation_key,command_ciphertext,expires_at,status,processing_token,created_at,updated_at,lease_until',
      )
      .eq('user_id', userId)
      .in('status', ['pending', 'processing', 'retryable', 'confirmed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data
      ? toRecord(data as Record<string, unknown>, this.encryptionKey)
      : null;
  }

  async claimPending(userId: string, now: Date) {
    validateIdentity(userId, 'claim');
    const { data, error } = await this.client.rpc(
      'claim_pending_calendar_confirmation',
      { p_user_id: userId, p_now: now.toISOString() },
    );
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row
      ? toRecord(row as Record<string, unknown>, this.encryptionKey)
      : null;
  }

  async finish(
    userId: string,
    operationKey: string,
    processingToken: string,
    now: Date,
  ) {
    validateIdentity(userId, operationKey);
    if (!UUID.test(processingToken))
      throw new Error('invalid processing token');
    const { data, error } = await this.client.rpc(
      'finish_pending_calendar_confirmation',
      {
        p_user_id: userId,
        p_operation_key: operationKey,
        p_processing_token: processingToken,
        p_now: now.toISOString(),
      },
    );
    if (error) throw error;
    return Boolean(data);
  }

  async requeue(
    userId: string,
    operationKey: string,
    processingToken: string,
    now: Date,
  ) {
    validateIdentity(userId, operationKey);
    if (!UUID.test(processingToken))
      throw new Error('invalid processing token');
    const { data, error } = await this.client.rpc(
      'requeue_pending_calendar_confirmation',
      {
        p_user_id: userId,
        p_operation_key: operationKey,
        p_processing_token: processingToken,
        p_now: now.toISOString(),
      },
    );
    if (error) throw error;
    return Boolean(data);
  }
}

export function createSupabasePendingCalendarConfirmationStore(
  key: Buffer,
): PendingCalendarConfirmationStore {
  return new SupabasePendingCalendarConfirmationStore(
    createSupabaseAdminClient(),
    key,
  );
}
