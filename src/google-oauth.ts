const GOOGLE_AUTHORIZATION_ENDPOINT =
  'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_CALENDAR_EVENTS_SCOPE =
  'https://www.googleapis.com/auth/calendar.events';

export type GoogleOAuthUrlOptions = {
  clientId: string;
  redirectUri: string;
  state: string;
  accessType?: 'offline';
  prompt?: 'consent';
};

function validateRedirectUri(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Google OAuth redirect URI must be a valid URL');
  }
  const local =
    parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (
    (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error('Google OAuth redirect URI must use HTTPS');
}

export function buildGoogleOAuthUrl(options: GoogleOAuthUrlOptions): string {
  if (!options.clientId) throw new Error('Google OAuth client ID is required');
  if (!options.state) throw new Error('Google OAuth state is required');
  validateRedirectUri(options.redirectUri);

  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    scope: GOOGLE_CALENDAR_EVENTS_SCOPE,
    state: options.state,
    access_type: options.accessType ?? 'offline',
    prompt: options.prompt ?? 'consent',
  });
  return `${GOOGLE_AUTHORIZATION_ENDPOINT}?${params.toString()}`;
}
