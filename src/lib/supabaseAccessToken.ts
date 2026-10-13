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

/** How long to wait before asking again while tokens aren't configured (503) or after signing out. */
const RETRY_AFTER_MS = 5 * 60_000;

/** After a network or server error: 2s, 4s, 8s… up to a minute. */
const ERROR_RETRY_MS = 2_000;
const MAX_ERROR_RETRY_MS = 60_000;

type Token = { token: string; expiresAt: number };

let current: Token | null = null;
let pending: Promise<Token | null> | null = null;
let retryAt = 0;
let consecutiveErrors = 0;
/** The token route's answer to this page's last request: 401 means the visitor isn't signed in. */
let lastStatus: number | null = null;

/** Dispatched on window when the token route says the session is gone (SignInGate listens). */
export const SIGNED_OUT_EVENT = 'supabase-signed-out';

function isToken(value: unknown): value is Token {
  return typeof value === 'object' && value !== null
    && typeof (value as Token).token === 'string' && typeof (value as Token).expiresAt === 'number';
}

/** The route's answer, with the expiry moved onto this browser's clock (it may be off). */
function receivedToken(body: unknown): Token | null {
  if (!isToken(body)) return null;
  const expiresIn = (body as { expiresIn?: unknown }).expiresIn;
  return typeof expiresIn === 'number' ? { token: body.token, expiresAt: Date.now() + expiresIn * 1000 } : body;
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
    if (response.ok) return receivedToken(await response.json());
  } catch {
    // Offline or unreachable: treated like no token.
    lastStatus = null;
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
    consecutiveErrors = 0;
    store(fresh);
    return fresh.token;
  }
  const failedAt = Date.now();
  // Signed out: the token must not outlive the session, so it goes at once.
  if (lastStatus === 401 || !unexpired(current, failedAt)) forgetSupabaseAccessToken();
  if (lastStatus === 401) window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  // Not configured, or signed out: nothing will change soon. Anything else (offline, a server
  // error) is retried within seconds, and never later than the token we still have expires.
  const wait = lastStatus === 503 || lastStatus === 401
    ? RETRY_AFTER_MS
    : Math.min(ERROR_RETRY_MS * 2 ** consecutiveErrors++, MAX_ERROR_RETRY_MS);
  retryAt = Math.min(failedAt + wait, current?.expiresAt ?? Infinity);
  return unexpired(current, failedAt);
}

// Back online, or back to the tab (a laptop waking): ask again at once rather than after a wait.
if (typeof window !== 'undefined') {
  const retryNow = () => {
    retryAt = 0;
  };
  window.addEventListener('online', retryNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') retryNow();
  });
}

/** Drops this tab's token (on signing out, and on the sign-in pages). */
export function forgetSupabaseAccessToken() {
  current = null;
  store(null);
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
  forgetSupabaseAccessToken();
  pending = null;
  retryAt = 0;
  consecutiveErrors = 0;
  lastStatus = null;
}
