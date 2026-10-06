import type { GoogleOAuthConfig } from './config.js';
import { buildGoogleOAuthUrl } from './google-oauth.js';
import {
  createGoogleOAuthState,
  type GoogleOAuthStateStore,
} from './google-oauth-state.js';

const MAX_USER_ID_LENGTH = 256;

export type GoogleOAuthStartDependencies = {
  config: GoogleOAuthConfig;
  stateStore: GoogleOAuthStateStore;
  now?: () => Date;
  stateTtlMs?: number;
};

export type GoogleOAuthStartErrorCode =
  'invalid-user-id' | 'invalid-config' | 'state-store-failure';

export class GoogleOAuthStartError extends Error {
  constructor(
    public readonly code: GoogleOAuthStartErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GoogleOAuthStartError';
  }
}

function validateUserId(userId: unknown): asserts userId is string {
  if (
    typeof userId !== 'string' ||
    userId.length === 0 ||
    userId.length > MAX_USER_ID_LENGTH ||
    /\s/.test(userId)
  )
    throw new GoogleOAuthStartError(
      'invalid-user-id',
      'Google OAuth user id is invalid',
    );
}

function validateConfig(config: GoogleOAuthConfig): void {
  if (
    !config ||
    typeof config.clientId !== 'string' ||
    config.clientId.length === 0 ||
    typeof config.clientSecret !== 'string' ||
    config.clientSecret.length === 0 ||
    typeof config.redirectUri !== 'string' ||
    config.redirectUri.length === 0
  )
    throw new GoogleOAuthStartError(
      'invalid-config',
      'Google OAuth configuration is invalid',
    );

  try {
    const parsed = new URL(config.redirectUri);
    const local =
      parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (
      (parsed.protocol !== 'https:' &&
        !(local && parsed.protocol === 'http:')) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== '/oauth/google/callback'
    )
      throw new Error();
  } catch {
    throw new GoogleOAuthStartError(
      'invalid-config',
      'Google OAuth configuration is invalid',
    );
  }
}

export async function createGoogleOAuthStart(
  userId: string,
  dependencies: GoogleOAuthStartDependencies,
): Promise<string> {
  validateUserId(userId);
  validateConfig(dependencies.config);

  const now = dependencies.now?.() ?? new Date();
  let state;
  try {
    state = createGoogleOAuthState(userId, now, dependencies.stateTtlMs);
  } catch {
    throw new GoogleOAuthStartError(
      'invalid-config',
      'Google OAuth configuration is invalid',
    );
  }

  try {
    await dependencies.stateStore.create({
      hash: state.hash,
      userId: state.userId,
      expiresAt: state.expiresAt,
    });
  } catch {
    throw new GoogleOAuthStartError(
      'state-store-failure',
      'Google OAuth state could not be stored',
    );
  }

  try {
    return buildGoogleOAuthUrl({
      clientId: dependencies.config.clientId,
      redirectUri: dependencies.config.redirectUri,
      state: state.value,
    });
  } catch {
    throw new GoogleOAuthStartError(
      'invalid-config',
      'Google OAuth configuration is invalid',
    );
  }
}
