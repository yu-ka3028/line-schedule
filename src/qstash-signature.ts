import { Receiver } from '@upstash/qstash';

import type { QstashConfig } from './config.js';

export interface QstashSignatureVerifier {
  verify(body: string, signature: string): Promise<boolean>;
}

export function createQstashSignatureVerifier(
  config: QstashConfig,
  url = config.receiverUrl,
): QstashSignatureVerifier {
  const receiver = new Receiver({
    currentSigningKey: config.currentSigningKey,
    nextSigningKey: config.nextSigningKey,
    devMode: false,
  });
  return {
    verify: (body, signature) =>
      receiver.verify({
        body,
        signature,
        url,
      }),
  };
}
