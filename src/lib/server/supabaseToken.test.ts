// @vitest-environment node
import { exportJWK, generateKeyPair, jwtVerify, type JWK } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let privateJwk: JWK;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  privateJwk = { ...(await exportJWK(pair.privateKey)), kid: 'test-kid' };
  publicKey = pair.publicKey;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// Each test loads the module fresh: it keeps the imported key and the server's token.
async function load(key: string | undefined) {
  vi.resetModules();
  vi.stubEnv('SUPABASE_JWT_SIGNING_KEY', key ?? '');
  return import('./supabaseToken');
}

describe('signSupabaseToken', () => {
  it('signs a one-hour ES256 token for the authenticated role that the public key verifies', async () => {
    const { signSupabaseToken } = await load(JSON.stringify(privateJwk));
    const now = Date.UTC(2026, 9, 13, 12, 0, 0);
    const signed = await signSupabaseToken(now);
    expect(signed?.expiresAt).toBe(now + 60 * 60 * 1000);

    const { payload, protectedHeader } = await jwtVerify(signed!.token, publicKey, {
      audience: 'authenticated',
      currentDate: new Date(now + 1000),
    });
    expect(protectedHeader).toEqual({ alg: 'ES256', kid: 'test-kid', typ: 'JWT' });
    expect(payload).toEqual({ role: 'authenticated', aud: 'authenticated', iat: now / 1000, exp: now / 1000 + 3600 });
  });

  it('signs with a key as `supabase gen signing-key` writes it', async () => {
    // The CLI's JWK claims both uses, which WebCrypto refuses for a private key.
    const cliKey = { ...privateJwk, use: 'sig', key_ops: ['sign', 'verify'], alg: 'ES256', ext: true };
    const { signSupabaseToken } = await load(JSON.stringify(cliKey));
    const signed = await signSupabaseToken();
    const { protectedHeader } = await jwtVerify(signed!.token, publicKey, { audience: 'authenticated' });
    expect(protectedHeader.kid).toBe('test-kid');
  });

  it('signs nothing without a key, so the app keeps using the anon key', async () => {
    const { signSupabaseToken, isSupabaseTokenConfigured } = await load(undefined);
    expect(isSupabaseTokenConfigured()).toBe(false);
    await expect(signSupabaseToken()).resolves.toBeNull();
  });

  it('signs with a local stack\'s HS256 secret off Vercel only', async () => {
    const secret = new TextEncoder().encode('local-supabase-jwt-secret-at-least-32-chars');
    const oct = JSON.stringify({ kty: 'oct', k: Buffer.from(secret).toString('base64url') });
    const { signSupabaseToken } = await load(oct);
    const signed = await signSupabaseToken();
    const { payload, protectedHeader } = await jwtVerify(signed!.token, secret, { audience: 'authenticated' });
    expect(protectedHeader).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(payload.role).toBe('authenticated');

    vi.resetModules();
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('SUPABASE_JWT_SIGNING_KEY', oct);
    const onVercel = await import('./supabaseToken');
    await expect(onVercel.signSupabaseToken()).rejects.toThrow();
  });

  it('rejects a key that is not an ES256 private key with a kid', async () => {
    const malformed = [
      JSON.stringify({ ...privateJwk, kid: undefined }),
      JSON.stringify({ ...privateJwk, d: undefined }),
      JSON.stringify({ kty: 'RSA', n: 'abc', e: 'AQAB', kid: 'k' }),
      '{not json',
    ];
    for (const key of malformed) {
      const { signSupabaseToken } = await load(key);
      await expect(signSupabaseToken(), key).rejects.toThrow();
    }
  });
});

describe('serverSupabaseAccessToken', () => {
  it('reuses its token until shortly before it expires', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.UTC(2026, 9, 13, 12, 0, 0));
      const { serverSupabaseAccessToken } = await load(JSON.stringify(privateJwk));
      const first = await serverSupabaseAccessToken();
      vi.setSystemTime(Date.UTC(2026, 9, 13, 12, 50, 0));
      expect(await serverSupabaseAccessToken()).toBe(first);
      vi.setSystemTime(Date.UTC(2026, 9, 13, 12, 56, 0));
      expect(await serverSupabaseAccessToken()).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });
});
