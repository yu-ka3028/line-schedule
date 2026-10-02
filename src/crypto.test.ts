import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decryptWebhookPayload, encryptWebhookPayload } from './crypto.js';

describe('webhook payload encryption', () => {
  it('round trips with AES-GCM and does not expose plaintext', () => {
    const key = randomBytes(32);
    const payload = '{"events":[{"type":"follow"}]}';
    const encrypted = encryptWebhookPayload(payload, key);

    expect(encrypted).not.toContain(payload);
    expect(decryptWebhookPayload(encrypted, key)).toBe(payload);
  });

  it('rejects tampering', () => {
    const key = randomBytes(32);
    const encrypted = encryptWebhookPayload('payload', key);
    const parts = encrypted.split('.');
    parts[3] = `${parts[3]}A`;

    expect(() => decryptWebhookPayload(parts.join('.'), key)).toThrow();
  });
});
