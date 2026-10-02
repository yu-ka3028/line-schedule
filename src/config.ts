export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ConfigurationError(`${name} is not configured`);
  }
  return value;
}

export function readWebhookEncryptionKey(): Buffer {
  const encoded = requiredEnvironment('WEBHOOK_PAYLOAD_ENCRYPTION_KEY');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw new ConfigurationError(
      'WEBHOOK_PAYLOAD_ENCRYPTION_KEY must be base64 encoded',
    );
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) {
    throw new ConfigurationError(
      'WEBHOOK_PAYLOAD_ENCRYPTION_KEY must decode to exactly 32 bytes',
    );
  }
  return key;
}

export function readSupabaseConfig(): { url: string; serviceRoleKey: string } {
  const url = requiredEnvironment('SUPABASE_URL');
  try {
    const parsed = new URL(url);
    const isLocalHttp =
      parsed.protocol === 'http:' && parsed.hostname === 'localhost';
    if (parsed.protocol !== 'https:' && !isLocalHttp) {
      throw new Error();
    }
  } catch {
    throw new ConfigurationError('SUPABASE_URL must be a valid URL');
  }
  return {
    url,
    serviceRoleKey: requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
  };
}
