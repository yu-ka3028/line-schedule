import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createQstashPublisher,
  readQstashPublisherConfig,
} from './qstash-publisher.js';

const config = {
  token: 'test-token',
  qstashUrl: 'https://qstash-us-east-1.upstash.io',
  receiverUrl: 'https://example.test/webhooks/qstash/jobs',
};
const jobId = '00000000-0000-4000-8000-000000000001';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('QStash publisher', () => {
  it('publishes exactly the job id payload with fixed retry policy', async () => {
    const publishJSON = vi.fn().mockResolvedValue({ messageId: 'msg_1' });
    const publisher = createQstashPublisher(config, { publishJSON });
    await expect(publisher.publish(jobId)).resolves.toEqual({
      messageId: 'msg_1',
    });
    expect(publishJSON).toHaveBeenCalledWith({
      url: config.receiverUrl,
      body: { jobId },
      label: 'line-event-process',
      deduplicationId: `line-event-process:${jobId}`,
    });
  });

  it.each([
    'http://example.test/webhooks/qstash/jobs',
    'https://example.test/webhooks/qstash/jobs?token=leak',
    'https://user:pass@example.test/webhooks/qstash/jobs',
    'https://example.test/other',
  ])('rejects an unsafe receiver URL: %s', (receiverUrl) => {
    expect(() =>
      createQstashPublisher(
        { ...config, receiverUrl },
        { publishJSON: vi.fn() },
      ),
    ).toThrow('valid URL');
  });

  it.each([
    'http://qstash-us-east-1.upstash.io',
    'https://qstash-us-east-1.upstash.io/v2',
    'https://user:pass@qstash-us-east-1.upstash.io',
    'https://qstash-us-east-1.upstash.io?token=leak',
  ])('rejects an unsafe QStash URL: %s', (qstashUrl) => {
    expect(() =>
      createQstashPublisher({ ...config, qstashUrl }, { publishJSON: vi.fn() }),
    ).toThrow('valid URL');
  });

  it('reads and validates the regional QStash URL', () => {
    vi.stubEnv('QSTASH_TOKEN', 'test-token');
    vi.stubEnv('QSTASH_URL', config.qstashUrl);
    vi.stubEnv('QSTASH_JOB_RECEIVER_URL', config.receiverUrl);

    expect(readQstashPublisherConfig()).toEqual(config);
  });

  it('rejects an unknown response', async () => {
    const publisher = createQstashPublisher(config, {
      publishJSON: vi.fn().mockResolvedValue({ ok: true }),
    });
    await expect(publisher.publish(jobId)).rejects.toThrow('unknown_result');
  });

  it('turns a timeout into a rejected publish', async () => {
    const publisher = createQstashPublisher(
      config,
      {
        publishJSON: vi.fn(() => new Promise(() => undefined)),
      },
      1,
    );
    await expect(publisher.publish(jobId)).rejects.toThrow('timeout');
  });
});
