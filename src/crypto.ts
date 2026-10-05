import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function encode(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function decode(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function isBase64Url(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

export function isEncryptedPayload(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;
  const [version, ivEncoded, tagEncoded, ciphertextEncoded] = parts;
  if (
    version !== VERSION ||
    !ivEncoded ||
    !tagEncoded ||
    !ciphertextEncoded ||
    !isBase64Url(ivEncoded) ||
    !isBase64Url(tagEncoded) ||
    !isBase64Url(ciphertextEncoded)
  )
    return false;

  const iv = decode(ivEncoded);
  const tag = decode(tagEncoded);
  return iv.length === IV_LENGTH && tag.length === TAG_LENGTH;
}

export function encryptWebhookPayload(
  payload: string | Uint8Array,
  key: Buffer,
): string {
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(
      payload instanceof Uint8Array ? payload : Buffer.from(payload),
    ),
    cipher.final(),
  ]);
  return [
    VERSION,
    encode(iv),
    encode(cipher.getAuthTag()),
    encode(ciphertext),
  ].join('.');
}

export function decryptWebhookPayload(encoded: string, key: Buffer): string {
  if (!isEncryptedPayload(encoded)) {
    throw new Error('Invalid encrypted payload format');
  }
  const [, ivEncoded, tagEncoded, ciphertextEncoded] = encoded.split('.');
  const iv = decode(ivEncoded);
  const tag = decode(tagEncoded);
  if (key.length !== 32) {
    throw new Error('Invalid encrypted payload');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(decode(ciphertextEncoded)),
    decipher.final(),
  ]).toString('utf8');
}
