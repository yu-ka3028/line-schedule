import { ConfigurationError } from './config.js';

export const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
export const LINE_PUSH_TEXT =
  '受け付けました。現在、予定処理機能を準備中です。';
export const LINE_PUSH_MAX_TEXT_LENGTH = 2000;

export type LinePushResult = 'sent' | 'retryable' | 'blocked';
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface LinePushClient {
  push(recipientId: string, retryKey: string): Promise<LinePushResult>;
  pushText?(
    recipientId: string,
    retryKey: string,
    text: string,
  ): Promise<LinePushResult>;
}

export class FetchLinePushClient implements LinePushClient {
  private readonly token: string;
  private readonly fetcher: FetchLike;

  constructor(token = process.env.LINE_CHANNEL_ACCESS_TOKEN, fetcher = fetch) {
    if (!token)
      throw new ConfigurationError(
        'LINE_CHANNEL_ACCESS_TOKEN is not configured',
      );
    this.token = token;
    this.fetcher = fetcher;
  }

  async push(recipientId: string, retryKey: string): Promise<LinePushResult> {
    return this.pushText(recipientId, retryKey, LINE_PUSH_TEXT);
  }

  async pushText(
    recipientId: string,
    retryKey: string,
    text: string,
  ): Promise<LinePushResult> {
    if (!text || text.length > LINE_PUSH_MAX_TEXT_LENGTH) return 'blocked';
    const response = await this.fetcher(LINE_PUSH_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        'x-line-retry-key': retryKey,
      },
      body: JSON.stringify({
        to: recipientId,
        messages: [{ type: 'text', text }],
      }),
    }).catch(() => null);
    if (!response) return 'retryable';
    if (response.ok) return 'sent';
    if (response.status === 429 || response.status >= 500) return 'retryable';
    if (response.status >= 400 && response.status < 500) return 'blocked';
    return 'retryable';
  }
}

export function createLinePushClient(): LinePushClient {
  return new FetchLinePushClient();
}
