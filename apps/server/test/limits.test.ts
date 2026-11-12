import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './helpers.js';

/** Sends a body with no Content-Length header (chunked), the case a declared-size check cannot catch. */
function chunked(bytes: Uint8Array, headers: Record<string, string>): RequestInit {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 1024) controller.enqueue(bytes.subarray(i, i + 1024));
      controller.close();
    },
  });
  return { method: 'POST', headers, body, duplex: 'half' } as RequestInit;
}

describe('request body limits without Content-Length', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startHarness({ maxFormBytes: 2048, maxTotalBytes: 4096, maxFileBytes: 2048 });
  });
  afterAll(async () => {
    await h.close();
  });

  it('cuts off a chunked panel form that exceeds the form limit', async () => {
    const big = new TextEncoder().encode('username=owner&password=' + 'x'.repeat(4000));
    const response = await fetch(`${h.base}/admin/login`, chunked(big, { 'content-type': 'application/x-www-form-urlencoded' }));
    expect(response.status).toBe(413);
  });

  it('cuts off a chunked estimate that exceeds the total limit, with a JSON reason', async () => {
    const big = new TextEncoder().encode('x'.repeat(8000));
    const response = await fetch(`${h.base}/api/estimate`, chunked(big, { 'content-type': 'multipart/form-data; boundary=zz' }));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ status: 'invalid', issues: [{ code: 'total_too_large' }] });
  });

  it('still accepts a small chunked form inside the limit', async () => {
    const small = new TextEncoder().encode('username=owner&password=wrong');
    const response = await fetch(`${h.base}/admin/login`, chunked(small, { 'content-type': 'application/x-www-form-urlencoded' }));
    // Parsed and checked: a wrong password gets the generic refusal, not a size error.
    expect(response.status).toBe(401);
  });
});
