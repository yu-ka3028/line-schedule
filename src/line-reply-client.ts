export const SYNC_TEXT_REPLY = '受け付けました。';

export type ReplyOutcome =
  'replied' | 'reply_unavailable' | 'timeout' | 'error';

export interface ReplyClient {
  reply(replyToken: string, deadline: number): Promise<ReplyOutcome>;
}

export function createLineReplyClient(): ReplyClient {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  return {
    async reply(replyToken: string, deadline: number): Promise<ReplyOutcome> {
      if (!token) return 'reply_unavailable';
      if (Date.now() >= deadline) return 'timeout';
      try {
        const remaining = Math.max(1, deadline - Date.now());
        const response = await fetch(
          'https://api.line.me/v2/bot/message/reply',
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              replyToken,
              messages: [{ type: 'text', text: SYNC_TEXT_REPLY }],
            }),
            signal: AbortSignal.timeout(remaining),
          },
        );
        if (Date.now() >= deadline) return 'timeout';
        return response.ok ? 'replied' : 'error';
      } catch (error) {
        if (
          error instanceof DOMException &&
          (error.name === 'TimeoutError' || error.name === 'AbortError')
        )
          return 'timeout';
        return 'error';
      }
    },
  };
}
