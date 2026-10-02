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
  const parts = encoded.split('.');
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted payload format');
  }
  const [version, ivEncoded, tagEncoded, ciphertextEncoded] = parts;
  if (version !== VERSION || !ivEncoded || !tagEncoded || !ciphertextEncoded) {
    throw new Error('Invalid encrypted payload format');
  }
  const iv = decode(ivEncoded);
  const tag = decode(tagEncoded);
  if (
    iv.length !== IV_LENGTH ||
    tag.length !== TAG_LENGTH ||
    key.length !== 32
  ) {
    throw new Error('Invalid encrypted payload');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(decode(ciphertextEncoded)),
    decipher.final(),
  ]).toString('utf8');
}
