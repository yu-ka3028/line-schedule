import { Hono } from 'hono';

import { ConfigurationError } from './config.js';
import {
  createSupabaseLineEventStore,
  type LineEventStore,
} from './line-event-store.js';
import {
  LineEventValidationError,
  parseLineWebhookPayload,
} from './line-events.js';
import { readBodyWithLimit, verifyLineSignature } from './line-signature.js';

export function createApp(store?: LineEventStore): Hono {
  const app = new Hono();

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

    const contentType = c.req
      .header('content-type')
      ?.split(';', 1)[0]
      .trim()
      .toLowerCase();
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

    let payload;
    try {
      payload = parseLineWebhookPayload(rawBody);
    } catch (error) {
      if (error instanceof LineEventValidationError) {
        return c.json({ error: 'invalid_payload' }, 400);
      }
      throw error;
    }

    if (payload.events.length === 0) return c.json({ ok: true }, 200);

    const eventStore =
      store ??
      (() => {
        try {
          return createSupabaseLineEventStore();
        } catch (error) {
          if (error instanceof ConfigurationError) return null;
          throw error;
        }
      })();
    if (!eventStore) return c.json({ error: 'configuration_unavailable' }, 503);

    try {
      await eventStore.save(payload);
    } catch {
      // Do not expose persistence details or event contents to the caller.
      return c.json({ error: 'persistence_unavailable' }, 500);
    }

    return c.json({ ok: true }, 200);
  });

  return app;
}

export const app = createApp();
export default app;
