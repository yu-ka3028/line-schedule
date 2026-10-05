import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type GoogleOAuthState = {
  value: string;
  hash: string;
  userId: string;
  expiresAt: Date;
};

export type GoogleOAuthStateRecord = {
  hash: string;
  userId: string;
  expiresAt: Date;
};

export interface GoogleOAuthStateStore {
  create(state: GoogleOAuthStateRecord): Promise<void>;
  consume(hash: string, now: Date): Promise<{ userId: string } | null>;
}

const STATE_BYTES = 32;
const HASH_HEX_LENGTH = 64;

export function hashGoogleOAuthState(value: string): string {
  if (!value) throw new Error('OAuth state must not be empty');
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function compareGoogleOAuthState(
  value: string,
  expectedHash: string,
): boolean {
  const actual = Buffer.from(hashGoogleOAuthState(value), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

export function createGoogleOAuthState(
  userId: string,
  now: Date = new Date(),
  ttlMs = 10 * 60 * 1000,
): GoogleOAuthState {
  if (!userId) throw new Error('OAuth state user id must not be empty');
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0)
    throw new Error('OAuth state TTL must be positive');
  const value = randomBytes(STATE_BYTES).toString('base64url');
  return {
    value,
    hash: hashGoogleOAuthState(value),
    userId,
    expiresAt: new Date(now.getTime() + ttlMs),
  };
}

export function validateGoogleOAuthStateRecord(
  record: GoogleOAuthStateRecord,
): void {
  if (!record.userId) throw new Error('OAuth state user id must not be empty');
  if (!/^[0-9a-f]{64}$/.test(record.hash))
    throw new Error('OAuth state hash must be a SHA-256 hex digest');
  if (record.expiresAt.getTime() <= Date.now())
    throw new Error('OAuth state must not already be expired');
}

export function isGoogleOAuthStateHash(value: string): boolean {
  return value.length === HASH_HEX_LENGTH && /^[0-9a-f]+$/.test(value);
}
