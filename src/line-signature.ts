import { createHmac, timingSafeEqual } from 'node:crypto';

export const MAX_LINE_BODY_BYTES = 1024 * 1024;

export function verifyLineSignature(
  rawBody: string | Uint8Array,
  signature: string,
  channelSecret: string,
): boolean {
  const expectedSignature = createHmac('sha256', channelSecret)
    .update(rawBody)
    .digest('base64');
  const expected = Buffer.from(expectedSignature, 'utf8');
  const provided = Buffer.from(signature, 'utf8');

  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
}

export async function readBodyWithLimit(
  request: Request,
  maxBytes = MAX_LINE_BODY_BYTES,
): Promise<Uint8Array | null> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const parsedContentLength = Number(contentLength);
    if (
      Number.isFinite(parsedContentLength) &&
      parsedContentLength > maxBytes
    ) {
      return null;
    }
  }

  if (!request.body) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}
