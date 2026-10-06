import { encryptWebhookPayload } from './crypto.js';
import type { GoogleConnectionStore } from './google-connection-store.js';
import {
  hashGoogleOAuthState,
  type GoogleOAuthStateStore,
} from './google-oauth-state.js';

const MAX_CODE_LENGTH = 4096;
const MAX_STATE_LENGTH = 256;

export type GoogleOAuthTokenSet = {
  googleAccountId: string;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt: Date | null;
  scopes: string[];
};

export interface GoogleOAuthCodeExchanger {
  exchangeCode(code: string): Promise<GoogleOAuthTokenSet>;
}

export type GoogleOAuthCallbackDependencies = {
  stateStore: GoogleOAuthStateStore;
  codeExchanger: GoogleOAuthCodeExchanger;
  connectionStore: GoogleConnectionStore;
  encryptionKey: Buffer;
  now?: () => Date;
};

export class GoogleOAuthCallbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleOAuthCallbackError';
  }
}

function requiredInput(
  value: unknown,
  name: string,
  maxLength: number,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength
  )
    throw new GoogleOAuthCallbackError(`Invalid OAuth ${name}`);
  return value;
}

function validateTokenSet(tokens: GoogleOAuthTokenSet): void {
  requiredInput(tokens.googleAccountId, 'account', 256);
  requiredInput(tokens.accessToken, 'access token', 4096);
  if (tokens.refreshToken !== undefined && tokens.refreshToken !== null)
    requiredInput(tokens.refreshToken, 'refresh token', 4096);
  if (!Array.isArray(tokens.scopes) || tokens.scopes.length === 0)
    throw new GoogleOAuthCallbackError('Google OAuth scopes are required');
  if (
    tokens.scopes.some(
      (scope) =>
        typeof scope !== 'string' || scope.length === 0 || scope.length > 256,
    )
  )
    throw new GoogleOAuthCallbackError('Invalid Google OAuth scopes');
  if (
    (tokens.tokenExpiresAt !== null &&
      !(tokens.tokenExpiresAt instanceof Date)) ||
    (tokens.tokenExpiresAt !== null &&
      Number.isNaN(tokens.tokenExpiresAt.getTime()))
  )
    throw new GoogleOAuthCallbackError('Invalid Google OAuth expiry');
}

export async function handleGoogleOAuthCallback(
  input: { code: string; state: string },
  dependencies: GoogleOAuthCallbackDependencies,
): Promise<void> {
  const code = requiredInput(input.code, 'code', MAX_CODE_LENGTH);
  const state = requiredInput(input.state, 'state', MAX_STATE_LENGTH);
  const now = dependencies.now?.() ?? new Date();

  // Consume before exchanging the code so a failed exchange cannot be replayed.
  const consumed = await dependencies.stateStore.consume(
    hashGoogleOAuthState(state),
    now,
  );
  if (!consumed)
    throw new GoogleOAuthCallbackError('OAuth state is invalid or expired');

  let tokens: GoogleOAuthTokenSet;
  try {
    tokens = await dependencies.codeExchanger.exchangeCode(code);
  } catch {
    throw new GoogleOAuthCallbackError('Google OAuth code exchange failed');
  }
  validateTokenSet(tokens);

  const refreshTokenCiphertext =
    tokens.refreshToken == null
      ? undefined
      : encryptWebhookPayload(tokens.refreshToken, dependencies.encryptionKey);

  await dependencies.connectionStore.upsert({
    userId: consumed.userId,
    googleAccountId: tokens.googleAccountId,
    accessTokenCiphertext: encryptWebhookPayload(
      tokens.accessToken,
      dependencies.encryptionKey,
    ),
    refreshTokenCiphertext,
    tokenExpiresAt: tokens.tokenExpiresAt,
    scopes: [...tokens.scopes],
  });
}
