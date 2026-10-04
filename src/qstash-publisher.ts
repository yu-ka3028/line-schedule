import { Client } from '@upstash/qstash';

import {
  ConfigurationError,
  validateQstashUrl,
  validateReceiverUrl,
  type QstashConfig,
} from './config.js';

export type QstashPublisher = {
  publish(jobId: string): Promise<{ messageId: string }>;
};

type QstashClient = {
  publishJSON(request: Record<string, unknown>): Promise<unknown>;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createQstashPublisher(
  config: Pick<QstashConfig, 'receiverUrl'> & {
    token: string;
    qstashUrl: string;
  },
  client?: QstashClient,
  timeoutMs = 500,
): QstashPublisher {
  const qstashUrl = validateQstashUrl(config.qstashUrl, 'QSTASH_URL');
  const receiverUrl = validateReceiverUrl(
    config.receiverUrl,
    'QSTASH_JOB_RECEIVER_URL',
  );
  const publisherClient =
    client ??
    new Client({
      token: config.token,
      baseUrl: qstashUrl,
      retry: { retries: 0 },
    });
  return {
    async publish(jobId) {
      if (!UUID.test(jobId)) throw new Error('invalid job id');
      const result = await Promise.race([
        publisherClient.publishJSON({
          url: receiverUrl,
          body: { jobId },
          label: 'line-event-process',
          deduplicationId: `line-event-process:${jobId}`,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('qstash_publish_timeout')),
            timeoutMs,
          ),
        ),
      ]);
      if (
        typeof result !== 'object' ||
        result === null ||
        typeof (result as { messageId?: unknown }).messageId !== 'string' ||
        !(result as { messageId: string }).messageId
      )
        throw new Error('qstash_publish_unknown_result');
      return { messageId: (result as { messageId: string }).messageId };
    },
  };
}

export function readQstashPublisherConfig(): {
  token: string;
  qstashUrl: string;
  receiverUrl: string;
} {
  const token = process.env.QSTASH_TOKEN;
  if (!token) throw new ConfigurationError('QSTASH_TOKEN is not configured');
  const qstashUrl = process.env.QSTASH_URL;
  if (!qstashUrl) throw new ConfigurationError('QSTASH_URL is not configured');
  const receiverUrl = process.env.QSTASH_JOB_RECEIVER_URL;
  if (!receiverUrl)
    throw new ConfigurationError('QSTASH_JOB_RECEIVER_URL is not configured');
  return {
    token,
    qstashUrl: validateQstashUrl(qstashUrl, 'QSTASH_URL'),
    receiverUrl: validateReceiverUrl(receiverUrl, 'QSTASH_JOB_RECEIVER_URL'),
  };
}
