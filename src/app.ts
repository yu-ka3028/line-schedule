import { Hono } from 'hono';

import {
  LineEventValidationError,
  parseLineWebhookPayload,
} from './line-events.js';
import { readBodyWithLimit, verifyLineSignature } from './line-signature.js';

export const app = new Hono();

app.get('/healthz', (c) => c.json({ ok: true }));

app.post('/webhooks/line', async (c) => {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  if (!channelSecret) {
    return c.json({ error: 'configuration_unavailable' }, 503);
  }

  const signature = c.req.header('x-line-signature');
  if (!signature) {
    return c.json({ error: 'invalid_signature' }, 401);
  }

  const contentType = c.req.header('content-type')?.split(';', 1)[0].trim();
  if (contentType !== 'application/json') {
    return c.json({ error: 'unsupported_media_type' }, 415);
  }

  const rawBody = await readBodyWithLimit(c.req.raw);
  if (rawBody === null) {
    return c.json({ error: 'request_entity_too_large' }, 413);
  }

  if (!verifyLineSignature(rawBody, signature, channelSecret)) {
    return c.json({ error: 'invalid_signature' }, 401);
  }

  try {
    parseLineWebhookPayload(rawBody);
  } catch (error) {
    if (error instanceof LineEventValidationError) {
      return c.json({ error: 'invalid_payload' }, 400);
    }
    throw error;
  }

  return c.json(
    {
      error: 'not_implemented',
      message: 'LINE webhook event processing is not implemented.',
    },
    501,
  );
});

export default app;
