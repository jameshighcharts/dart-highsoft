import { afterEach, expect, it, vi } from 'vitest';
const { create } = vi.hoisted(() => ({ create: vi.fn(() => ({ channel: vi.fn() })) }));
vi.mock('@supabase/supabase-js', () => ({ createClient: create }));
afterEach(() => vi.unstubAllEnvs());
it('shares one client across concurrent first-mount callers', async () => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-key');
  const { getSupabaseClient } = await import('./supabaseClient');
  const clients = await Promise.all([getSupabaseClient(), getSupabaseClient(), getSupabaseClient()]);
  expect(create).toHaveBeenCalledTimes(1);
  expect(clients[0]).toBe(clients[1]);
  expect(clients[1]).toBe(clients[2]);
});
