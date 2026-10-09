import type { SupabaseClient } from '@supabase/supabase-js';

import { isEncryptedPayload } from './crypto.js';
import { createSupabaseAdminClient } from './supabase-admin.js';

export type EncryptedGoogleConnection = {
  userId: string;
  googleAccountId: string;
  accessTokenCiphertext: string | null;
  refreshTokenCiphertext?: string | null;
  tokenExpiresAt: Date | null;
  scopes: string[];
};

export interface GoogleConnectionStore {
  upsert(connection: EncryptedGoogleConnection): Promise<void>;
}

export interface GoogleConnectionReader {
  getByUserId(userId: string): Promise<EncryptedGoogleConnection | null>;
}

export type DecryptedGoogleConnection = {
  userId: string;
  googleAccountId: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt: Date | null;
  scopes: string[];
};

export class SupabaseGoogleConnectionStore
  implements GoogleConnectionStore, GoogleConnectionReader
{
  constructor(private readonly client: SupabaseClient) {}

  async getByUserId(userId: string): Promise<EncryptedGoogleConnection | null> {
    if (!userId) throw new Error('Google connection user ID is required');
    const { data, error } = await this.client
      .from('google_connections')
      .select(
        'user_id,google_account_id,access_token_ciphertext,refresh_token_ciphertext,token_expires_at,scopes',
      )
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      userId: data.user_id,
      googleAccountId: data.google_account_id,
      accessTokenCiphertext: data.access_token_ciphertext,
      refreshTokenCiphertext: data.refresh_token_ciphertext,
      tokenExpiresAt: data.token_expires_at
        ? new Date(data.token_expires_at)
        : null,
      scopes: data.scopes,
    };
  }

  async upsert(connection: EncryptedGoogleConnection): Promise<void> {
    if (!connection.userId || !connection.googleAccountId)
      throw new Error('Google connection identity is required');
    if (
      connection.accessTokenCiphertext !== null &&
      !isEncryptedPayload(connection.accessTokenCiphertext)
    )
      throw new Error('Google connection access token must be encrypted');
    if (
      connection.refreshTokenCiphertext != null &&
      !isEncryptedPayload(connection.refreshTokenCiphertext)
    )
      throw new Error('Google connection refresh token must be encrypted');
    if (connection.scopes.some((scope) => !scope))
      throw new Error('Google connection scopes must not be empty');

    const row = {
      user_id: connection.userId,
      google_account_id: connection.googleAccountId,
      access_token_ciphertext: connection.accessTokenCiphertext,
      token_expires_at: connection.tokenExpiresAt?.toISOString() ?? null,
      scopes: connection.scopes,
      ...(connection.refreshTokenCiphertext != null
        ? { refresh_token_ciphertext: connection.refreshTokenCiphertext }
        : {}),
    };
    const { error } = await this.client
      .from('google_connections')
      .upsert(row, { onConflict: 'user_id' });
    if (error) throw error;
  }
}

export function createSupabaseGoogleConnectionStore(): GoogleConnectionStore {
  return new SupabaseGoogleConnectionStore(createSupabaseAdminClient());
}
