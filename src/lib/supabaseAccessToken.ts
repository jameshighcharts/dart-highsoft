/**
 * The browser's Supabase token, from /api/supabase-token (see src/lib/server/supabaseToken). The
 * Supabase client asks for it on every request and every Realtime heartbeat, so it is kept in
 * memory and in sessionStorage (a reload reuses it), renewed shortly before it expires, and
 * fetched once however many ask at the same time.
 *
 * Null means "use the anon key", as before tokens: while no signing key is configured, or for a
 * visitor who isn't signed in. Asking again then waits a while instead of fetching every heartbeat.
 */
const STORAGE_KEY = 'supabase-access-token';

/** Renewed this long before it expires (matches SUPABASE_TOKEN_RENEW_BEFORE_MS on the server). */
const RENEW_BEFORE_MS = 5 * 60_000;

/** How long to wait before asking again after no token could be had. */
const RETRY_AFTER_MS = 5 * 60_000;

type Token = { token: string; expiresAt: number };

let current: Token | null = null;
let pending: Promise<Token | null> | null = null;
let retryAt = 0;
/** The token route's answer to this page's last request: 401 means the visitor isn't signed in. */
let lastStatus: number | null = null;

function isToken(value: unknown): value is Token {
  return typeof value === 'object' && value !== null
    && typeof (value as Token).token === 'string' && typeof (value as Token).expiresAt === 'number';
}

function readStored(): Token | null {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    return isToken(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function store(token: Token | null) {
  try {
    if (token) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(token));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Without storage the token is only kept in memory.
  }
}

async function requestToken(): Promise<Token | null> {
  try {
    const response = await fetch('/api/supabase-token', { credentials: 'same-origin' });
    lastStatus = response.status;
    if (response.ok) {
      const body: unknown = await response.json();
      if (isToken(body)) return body;
    }
  } catch {
    // Offline or unreachable: treated like no token.
  }
  return null;
}

/** A still-valid token, even one due for renewal, or null. */
function unexpired(token: Token | null, now: number): string | null {
  return token && token.expiresAt > now ? token.token : null;
}

export async function browserSupabaseAccessToken(): Promise<string | null> {
  const now = Date.now();
  current ??= readStored();
  if (current && current.expiresAt - now > RENEW_BEFORE_MS) return current.token;
  if (now < retryAt) return unexpired(current, now);

  pending ??= requestToken().finally(() => {
    pending = null;
  });
  const fresh = await pending;
  if (fresh) {
    current = fresh;
    store(fresh);
    return fresh.token;
  }
  retryAt = Date.now() + RETRY_AFTER_MS;
  if (!unexpired(current, Date.now())) {
    current = null;
    store(null);
  }
  return unexpired(current, Date.now());
}

/**
 * Whether the visitor isn't signed in, as the token route answered. Uses the same request as the
 * Supabase client (none at all while this tab holds a valid token), so it costs nothing extra.
 */
export async function isSignedOut(): Promise<boolean> {
  await browserSupabaseAccessToken();
  return lastStatus === 401;
}

/** Test hook: forget the token and any wait. */
export function resetSupabaseAccessTokenForTests() {
  current = null;
  pending = null;
  retryAt = 0;
  lastStatus = null;
  store(null);
}
