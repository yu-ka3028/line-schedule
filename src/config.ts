export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new ConfigurationError(`${name} is not configured`);
  return value;
}

export function readWebhookEncryptionKey(): Buffer {
  const encoded = requiredEnvironment('WEBHOOK_PAYLOAD_ENCRYPTION_KEY');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1)
    throw new ConfigurationError(
      'WEBHOOK_PAYLOAD_ENCRYPTION_KEY must be base64 encoded',
    );
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32)
    throw new ConfigurationError(
      'WEBHOOK_PAYLOAD_ENCRYPTION_KEY must decode to exactly 32 bytes',
    );
  return key;
}

function validateFixedHttpsUrl(
  value: string,
  name: string,
  path: string,
): string {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== path
    )
      throw new Error();
    return value;
  } catch {
    throw new ConfigurationError(`${name} must be a valid URL`);
  }
}

export function validateReceiverUrl(value: string, name: string): string {
  return validateFixedHttpsUrl(value, name, '/webhooks/qstash/jobs');
}

export function validateQstashUrl(value: string, name: string): string {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      (parsed.pathname !== '' && parsed.pathname !== '/') ||
      parsed.search ||
      parsed.hash
    )
      throw new Error();
    return value;
  } catch {
    throw new ConfigurationError(`${name} must be a valid URL`);
  }
}

export function validateDispatcherUrl(value: string, name: string): string {
  return validateFixedHttpsUrl(value, name, '/webhooks/qstash/outbox-dispatch');
}

export function readSupabaseConfig(): { url: string; serviceRoleKey: string } {
  const url = requiredEnvironment('SUPABASE_URL');
  try {
    const parsed = new URL(url);
    const isSupabaseCloud = /^[^.]+\.supabase\.co$/.test(parsed.hostname);
    const isLocalhost = parsed.hostname === 'localhost';
    if (
      (!['https:'].includes(parsed.protocol) &&
        !(parsed.protocol === 'http:' && isLocalhost)) ||
      (!isSupabaseCloud && !isLocalhost) ||
      parsed.username ||
      parsed.password
    )
      throw new Error();
  } catch {
    throw new ConfigurationError('SUPABASE_URL must be a valid URL');
  }
  return {
    url,
    serviceRoleKey: requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
  };
}

export type QstashConfig = {
  currentSigningKey: string;
  nextSigningKey: string;
  receiverUrl: string;
  dispatcherUrl?: string;
};

export function isLineAsyncProcessingEnabled(): boolean {
  return process.env.LINE_ASYNC_PROCESSING_ENABLED === 'true';
}

export function isGoogleOAuthEnabled(): boolean {
  return process.env.GOOGLE_OAUTH_ENABLED === 'true';
}

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function readGoogleOAuthConfig(): GoogleOAuthConfig {
  const redirectUri = requiredEnvironment('GOOGLE_REDIRECT_URI');
  try {
    const parsed = new URL(redirectUri);
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
    throw new ConfigurationError('GOOGLE_REDIRECT_URI must be a valid URL');
  }
  return {
    clientId: requiredEnvironment('GOOGLE_CLIENT_ID'),
    clientSecret: requiredEnvironment('GOOGLE_CLIENT_SECRET'),
    redirectUri,
  };
}

export function readQstashConfig(): QstashConfig {
  return {
    currentSigningKey: requiredEnvironment('QSTASH_CURRENT_SIGNING_KEY'),
    nextSigningKey: requiredEnvironment('QSTASH_NEXT_SIGNING_KEY'),
    receiverUrl: validateReceiverUrl(
      requiredEnvironment('QSTASH_JOB_RECEIVER_URL'),
      'QSTASH_JOB_RECEIVER_URL',
    ),
    dispatcherUrl: validateDispatcherUrl(
      requiredEnvironment('QSTASH_OUTBOX_DISPATCHER_URL'),
      'QSTASH_OUTBOX_DISPATCHER_URL',
    ),
  };
}
