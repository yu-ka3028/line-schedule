import type { SupabaseClient } from '@supabase/supabase-js';

import { createSupabaseAdminClient } from './supabase-admin.js';

export type EncryptedGoogleConnection = {
  userId: string;
  googleAccountId: string;
  accessTokenCiphertext: string | null;
  refreshTokenCiphertext: string | null;
  tokenExpiresAt: Date | null;
  scopes: string[];
};

export interface GoogleConnectionStore {
  upsert(connection: EncryptedGoogleConnection): Promise<void>;
}

export class SupabaseGoogleConnectionStore implements GoogleConnectionStore {
  constructor(private readonly client: SupabaseClient) {}

  async upsert(connection: EncryptedGoogleConnection): Promise<void> {
    if (!connection.userId || !connection.googleAccountId)
      throw new Error('Google connection identity is required');
    if (
      connection.accessTokenCiphertext === '' ||
      connection.refreshTokenCiphertext === ''
    )
      throw new Error('Google connection ciphertext must not be empty');
    if (connection.scopes.some((scope) => !scope))
      throw new Error('Google connection scopes must not be empty');

    const { error } = await this.client.from('google_connections').upsert(
      {
        user_id: connection.userId,
        google_account_id: connection.googleAccountId,
        access_token_ciphertext: connection.accessTokenCiphertext,
        refresh_token_ciphertext: connection.refreshTokenCiphertext,
        token_expires_at: connection.tokenExpiresAt?.toISOString() ?? null,
        scopes: connection.scopes,
      },
      { onConflict: 'user_id' },
    );
    if (error) throw error;
  }
}

export function createSupabaseGoogleConnectionStore(): GoogleConnectionStore {
  return new SupabaseGoogleConnectionStore(createSupabaseAdminClient());
}
