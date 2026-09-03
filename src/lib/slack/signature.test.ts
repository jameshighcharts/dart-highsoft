import { describe, expect, it } from 'vitest';

import { verifySlackRequest } from './signature';

async function sign(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`v0:${timestamp}:${body}`),
  );
  return `v0=${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')}`;
}

describe('verifySlackRequest', () => {
  it('accepts a current request with a valid signature', async () => {
    const body = 'command=%2Fdart&text=14%3A00';
    const timestamp = '1788343200';
    const signature = await sign('signing-secret', timestamp, body);

    await expect(
      verifySlackRequest({
        body,
        signature,
        timestamp,
        signingSecret: 'signing-secret',
        now: new Date('2026-09-02T10:00:00.000Z'),
      }),
    ).resolves.toBe(true);
  });

  it('rejects tampering and replayed requests', async () => {
    const timestamp = '1788343200';
    const signature = await sign('signing-secret', timestamp, 'original');

    await expect(
      verifySlackRequest({
        body: 'changed',
        signature,
        timestamp,
        signingSecret: 'signing-secret',
        now: new Date('2026-09-02T10:00:00.000Z'),
      }),
    ).resolves.toBe(false);
    await expect(
      verifySlackRequest({
        body: 'original',
        signature,
        timestamp,
        signingSecret: 'signing-secret',
        now: new Date('2026-09-02T10:10:01.000Z'),
      }),
    ).resolves.toBe(false);
  });
});
