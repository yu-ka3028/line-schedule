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
  'pending' | 'confirmed' | 'cancelled' | 'expired';

export type PendingCalendarConfirmation = {
  userId: string;
  operationKey: string;
  command: CalendarCreateCommand;
  expiresAt: Date;
  status: PendingCalendarConfirmationStatus;
  createdAt: Date;
  updatedAt: Date;
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
    !['pending', 'confirmed', 'cancelled', 'expired'].includes(
      String(row.status),
    )
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
        expires_at: input.expiresAt.toISOString(),
      })
      .select(
        'user_id,operation_key,command_ciphertext,expires_at,status,created_at,updated_at',
      )
      .single();
    if (error) throw error;
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
        'user_id,operation_key,command_ciphertext,expires_at,status,created_at,updated_at',
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
}

export function createSupabasePendingCalendarConfirmationStore(
  key: Buffer,
): PendingCalendarConfirmationStore {
  return new SupabasePendingCalendarConfirmationStore(
    createSupabaseAdminClient(),
    key,
  );
}
