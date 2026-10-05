import type { SupabaseClient } from '@supabase/supabase-js';

import {
  isGoogleOAuthStateHash,
  type GoogleOAuthStateRecord,
  type GoogleOAuthStateStore,
  validateGoogleOAuthStateRecord,
} from './google-oauth-state.js';
import { createSupabaseAdminClient } from './supabase-admin.js';

export class SupabaseGoogleOAuthStateStore implements GoogleOAuthStateStore {
  constructor(private readonly client: SupabaseClient) {}

  async create(state: GoogleOAuthStateRecord): Promise<void> {
    validateGoogleOAuthStateRecord(state);
    const { error } = await this.client.from('google_oauth_states').insert({
      state_hash: state.hash,
      user_id: state.userId,
      expires_at: state.expiresAt.toISOString(),
    });
    if (error) throw error;
  }

  async consume(hash: string, now: Date): Promise<{ userId: string } | null> {
    if (!isGoogleOAuthStateHash(hash))
      throw new Error('invalid OAuth state hash');
    const { data, error } = await this.client.rpc(
      'consume_google_oauth_state',
      {
        p_state_hash: hash,
        p_now: now.toISOString(),
      },
    );
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (row === null || row === undefined) return null;
    if (
      typeof row !== 'object' ||
      row === null ||
      Array.isArray(row) ||
      typeof (row as { user_id?: unknown }).user_id !== 'string'
    )
      throw new Error('invalid OAuth state consume response');
    return { userId: (row as { user_id: string }).user_id };
  }
}

export function createSupabaseGoogleOAuthStateStore(): GoogleOAuthStateStore {
  return new SupabaseGoogleOAuthStateStore(createSupabaseAdminClient());
}
