const MAX_REQUEST_AGE_SECONDS = 60 * 5;

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function verifySlackRequest(options: {
  body: string;
  signature: string | null;
  timestamp: string | null;
  signingSecret: string;
  now?: Date;
}): Promise<boolean> {
  const { body, signature, timestamp, signingSecret, now = new Date() } = options;
  if (!signature || !timestamp || !/^v0=[0-9a-f]{64}$/i.test(signature)) return false;

  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber)) return false;
  if (Math.abs(Math.floor(now.getTime() / 1000) - timestampNumber) > MAX_REQUEST_AGE_SECONDS) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`v0:${timestamp}:${body}`),
  );
  const expected = `v0=${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')}`;

  return constantTimeEqual(signature.toLowerCase(), expected);
}
