import { describe, expect, it, vi } from 'vitest';

import { createQstashPublisher } from './qstash-publisher.js';

const config = {
  token: 'test-token',
  receiverUrl: 'https://example.test/webhooks/qstash/jobs',
};
const jobId = '00000000-0000-4000-8000-000000000001';

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
      retries: 0,
      label: 'line-event-process',
    });
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
