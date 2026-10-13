import type { SupabaseClient } from '@supabase/supabase-js';
import { installRealtimeWakeProbe } from '@/lib/realtimeWakeProbe';
import { browserSupabaseAccessToken } from '@/lib/supabaseAccessToken';

export const REALTIME_HEARTBEAT_INTERVAL_MS = 10_000;

let cachedClient: SupabaseClient | null = null;

/**
 * The token requests run with: a signed-in member's `authenticated` token, or null for the anon
 * key. The server signs its own; the browser gets one from /api/supabase-token.
 */
async function accessToken(): Promise<string | null> {
  if (typeof window === 'undefined') {
    const { serverSupabaseAccessToken } = await import('@/lib/server/supabaseToken');
    return serverSupabaseAccessToken();
  }
  return browserSupabaseAccessToken();
}

export async function getSupabaseClient(): Promise<SupabaseClient> {
  if (cachedClient) return cachedClient;
  const { createClient } = await import('@supabase/supabase-js');
  // Several hooks may await the import together on first mount. Recheck after
  // that boundary so they share one client/socket instead of racing to create it.
  if (cachedClient) return cachedClient;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase environment variables are missing');
  }
  cachedClient = createClient(supabaseUrl, supabaseAnonKey, {
    // The anon key stays the `apikey` header Supabase requires; the token, when there is one,
    // is the bearer that decides the database role. Realtime asks for it on every heartbeat.
    // (Sign-in is NextAuth's, so supabase.auth is unused, and this option disables it.)
    accessToken,
    // A dead socket is only noticed when a heartbeat goes unanswered; the 25s default means up
    // to 50s of silently missed darts before realtime-js reconnects and the views reconcile.
    realtime: { heartbeatIntervalMs: REALTIME_HEARTBEAT_INTERVAL_MS },
  });
  if (typeof window !== 'undefined') installRealtimeWakeProbe(cachedClient.realtime, window, REALTIME_HEARTBEAT_INTERVAL_MS);
  return cachedClient;
}
