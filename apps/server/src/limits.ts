/**
 * Byte limit on a request body, counted while it streams in. It does not trust Content-Length:
 * chunked uploads without that header are cut off at the same limit.
 */
export class BodyTooLarge extends Error {
  constructor() {
    super('body_too_large');
    this.name = 'BodyTooLarge';
  }
}

export function limitBody(request: Request, maxBytes: number): Request {
  if (!request.body) return request;
  let seen = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBytes) {
        controller.error(new BodyTooLarge());
        return;
      }
      controller.enqueue(chunk);
    },
  });
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body.pipeThrough(counter),
    duplex: 'half',
  } as RequestInit);
}
