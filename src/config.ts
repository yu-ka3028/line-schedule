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

function validateUrl(value: string, name: string, path?: string): string {
  try {
    const parsed = new URL(value);
    const localhost = parsed.hostname === 'localhost';
    if (
      (parsed.protocol !== 'https:' &&
        !(localhost && parsed.protocol === 'http:')) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (path !== undefined && parsed.pathname !== path)
    )
      throw new Error();
    return value;
  } catch {
    throw new ConfigurationError(`${name} must be a valid URL`);
  }
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
};

export function readQstashConfig(): QstashConfig {
  return {
    currentSigningKey: requiredEnvironment('QSTASH_CURRENT_SIGNING_KEY'),
    nextSigningKey: requiredEnvironment('QSTASH_NEXT_SIGNING_KEY'),
    receiverUrl: validateUrl(
      requiredEnvironment('QSTASH_JOB_RECEIVER_URL'),
      'QSTASH_JOB_RECEIVER_URL',
      '/webhooks/qstash/jobs',
    ),
  };
}
