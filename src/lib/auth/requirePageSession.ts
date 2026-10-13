import { redirect } from 'next/navigation';
import type { Session } from 'next-auth';

import { getAuthenticatedSession } from '@/auth';

/**
 * The signed-in member, for a server-rendered page that reads data on the server. No proxy guards
 * pages (they are shells served to anyone, see SignInGate), so such a page checks for itself and
 * sends anyone else to sign in, coming back to `path` afterwards. serverPages.test.ts enforces it.
 */
export async function requirePageSession(path: string): Promise<Session> {
  const session = await getAuthenticatedSession();
  if (!session) redirect(`/login?callbackUrl=${encodeURIComponent(path)}`);
  return session;
}
