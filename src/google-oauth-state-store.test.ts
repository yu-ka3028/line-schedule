import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import { hashGoogleOAuthState } from './google-oauth-state.js';
import { SupabaseGoogleOAuthStateStore } from './google-oauth-state-store.js';

function createClientMock(rpcResults: unknown[]) {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const rpc = vi.fn();
  for (const result of rpcResults) rpc.mockResolvedValueOnce(result);
  const client = {
    from: vi.fn(() => ({ insert })),
    rpc,
  } as unknown as SupabaseClient;
  return { client, insert, rpc };
}

describe('SupabaseGoogleOAuthStateStore', () => {
  it('persists only the state digest and expiry', async () => {
    const { client, insert } = createClientMock([]);
    const store = new SupabaseGoogleOAuthStateStore(client);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await store.create({
      hash: hashGoogleOAuthState('state-fixture'),
      userId: 'user-id',
      expiresAt,
    });

    expect(insert).toHaveBeenCalledWith({
      state_hash: hashGoogleOAuthState('state-fixture'),
      user_id: 'user-id',
      expires_at: expiresAt.toISOString(),
    });
  });

  it('returns null for an expired state and for a second consume', async () => {
    const { client, rpc } = createClientMock([
      { data: [], error: null },
      { data: [], error: null },
    ]);
    const store = new SupabaseGoogleOAuthStateStore(client);
    const hash = hashGoogleOAuthState('state-fixture');
    const now = new Date();

    await expect(store.consume(hash, now)).resolves.toBeNull();
    await expect(store.consume(hash, now)).resolves.toBeNull();
    expect(rpc).toHaveBeenNthCalledWith(1, 'consume_google_oauth_state', {
      p_state_hash: hash,
      p_now: now.toISOString(),
    });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('returns the user id only when the atomic consume updates a row', async () => {
    const { client } = createClientMock([
      { data: [{ user_id: 'user-id' }], error: null },
    ]);
    const store = new SupabaseGoogleOAuthStateStore(client);

    await expect(
      store.consume(hashGoogleOAuthState('state-fixture'), new Date()),
    ).resolves.toEqual({ userId: 'user-id' });
  });
});
