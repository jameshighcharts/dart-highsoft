import { importJWK, SignJWT, type CryptoKey, type JWK } from 'jose';

/**
 * Short-lived tokens that let a signed-in member's browser use Supabase's Data API and Realtime as
 * the `authenticated` role, instead of the `anon` key every visitor's JavaScript contains.
 *
 * They are signed with our own ES256 key, imported into the Supabase project as its JWT signing
 * key (Supabase's "mint your own JWTs" setup), so Supabase verifies them. The private key lives
 * only in the server's environment, as a JWK in SUPABASE_JWT_SIGNING_KEY. A local Supabase stack
 * verifies its legacy HS256 secret instead, so for local development the key may be that secret as
 * an `oct` JWK.
 */
export const SUPABASE_TOKEN_LIFETIME_SECONDS = 60 * 60;

/** A token is renewed this long before it expires, so no request carries an expired one. */
export const SUPABASE_TOKEN_RENEW_BEFORE_MS = 5 * 60_000;

export type SupabaseToken = {
  token: string;
  /** Milliseconds since 1970. */
  expiresAt: number;
};

type SigningKey = { key: CryptoKey | Uint8Array; alg: 'ES256' | 'HS256'; kid?: string };

let signingKey: Promise<SigningKey | null> | undefined;

function loadSigningKey(): Promise<SigningKey | null> {
  signingKey ??= (async () => {
    const raw = process.env.SUPABASE_JWT_SIGNING_KEY?.trim();
    if (!raw) return null;
    const jwk = JSON.parse(raw) as JWK;
    if (jwk.kty === 'EC' && jwk.crv === 'P-256' && jwk.d && jwk.kid) {
      return { key: await importJWK(jwk, 'ES256'), alg: 'ES256', kid: jwk.kid };
    }
    // Never on Vercel: a deployment signs with the project's imported ES256 key.
    if (jwk.kty === 'oct' && jwk.k && process.env.VERCEL !== '1') {
      return { key: await importJWK(jwk, 'HS256'), alg: 'HS256' };
    }
    throw new Error('SUPABASE_JWT_SIGNING_KEY must be an ES256 (P-256) private JWK with a kid (or, off Vercel, an oct JWK)');
  })();
  // A malformed key is reported on every call rather than cached as a failure forever.
  signingKey.catch(() => {
    signingKey = undefined;
  });
  return signingKey;
}

/** True when a signing key is configured, so tokens can be issued. */
export function isSupabaseTokenConfigured(): boolean {
  return Boolean(process.env.SUPABASE_JWT_SIGNING_KEY?.trim());
}

/**
 * A new token running as `authenticated`, or null when no signing key is configured (the app then
 * keeps using the anon key). Throws for a malformed key.
 */
export async function signSupabaseToken(now = Date.now()): Promise<SupabaseToken | null> {
  const key = await loadSigningKey();
  if (!key) return null;
  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + SUPABASE_TOKEN_LIFETIME_SECONDS;
  const token = await new SignJWT({ role: 'authenticated' })
    // Supabase finds the public key to verify with by `kid`.
    .setProtectedHeader({ alg: key.alg, typ: 'JWT', ...(key.kid ? { kid: key.kid } : {}) })
    .setAudience('authenticated')
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(key.key);
  return { token, expiresAt: expiresAt * 1000 };
}

let serverToken: SupabaseToken | null = null;

/**
 * The token the server's own anon-key queries use (the shared-cache loaders in src/lib/shared run
 * the same code as the browser), reused until shortly before it expires.
 */
export async function serverSupabaseAccessToken(): Promise<string | null> {
  const now = Date.now();
  if (serverToken && serverToken.expiresAt - now > SUPABASE_TOKEN_RENEW_BEFORE_MS) return serverToken.token;
  serverToken = await signSupabaseToken(now);
  return serverToken?.token ?? null;
}
