import { describe, expect, it, vi } from 'vitest';

import { createLinePushExecutor } from './line-push-executor.js';

const job = { jobId: '00000000-0000-4000-8000-000000000001' };
const token = '00000000-0000-4000-8000-000000000002';

describe('LINE push executor opt-in outcomes', () => {
  it('does not call LINE when the claim is blocked', async () => {
    const push = vi.fn();
    const store = {
      claim: vi.fn().mockResolvedValue({ outcome: 'blocked' as const }),
      sent: vi.fn(),
      fail: vi.fn(),
    };

    const result = await createLinePushExecutor(store, { push })(job, token);

    expect(result).toEqual({ outcome: 'blocked' });
    expect(push).not.toHaveBeenCalled();
    expect(store.sent).not.toHaveBeenCalled();
  });

  it('keeps an already terminal delivery from calling LINE', async () => {
    const push = vi.fn();
    const store = {
      claim: vi.fn().mockResolvedValue({ outcome: 'sent' as const }),
      sent: vi.fn(),
      fail: vi.fn(),
    };

    await expect(
      createLinePushExecutor(store, { push })(job, token),
    ).resolves.toEqual({
      outcome: 'already_sent',
    });
    expect(push).not.toHaveBeenCalled();
  });
});
