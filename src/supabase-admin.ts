import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { readSupabaseConfig } from './config.js';

export function createSupabaseAdminClient(): SupabaseClient {
  const { url, serviceRoleKey } = readSupabaseConfig();
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
