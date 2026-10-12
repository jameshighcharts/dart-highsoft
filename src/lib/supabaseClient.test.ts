import { afterEach, expect, it, vi } from 'vitest';
const { create, onHeartbeat } = vi.hoisted(() => {
  const onHeartbeat = vi.fn();
  return {
    onHeartbeat,
    create: vi.fn(() => ({ channel: vi.fn(), realtime: { onHeartbeat, sendHeartbeat: vi.fn(), isConnected: () => true } })),
  };
});
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
it('detects dead realtime sockets quickly: short heartbeat plus one wake probe per browser', async () => {
  vi.resetModules();
  create.mockClear();
  onHeartbeat.mockClear();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-key');
  const { getSupabaseClient, REALTIME_HEARTBEAT_INTERVAL_MS } = await import('./supabaseClient');
  await Promise.all([getSupabaseClient(), getSupabaseClient()]);
  expect(create).toHaveBeenCalledWith('https://example.supabase.co', 'test-key',
    expect.objectContaining({ realtime: { heartbeatIntervalMs: REALTIME_HEARTBEAT_INTERVAL_MS } }));
  expect(onHeartbeat).toHaveBeenCalledTimes(1);
});
