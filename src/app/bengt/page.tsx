import { getAuthenticatedSession } from '@/auth';
import { HighdartsDashboard } from '@/components/highdarts/Dashboard';
import { loadHighdarts } from '@/lib/highdarts/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
export const dynamic = 'force-dynamic';
export default async function BengtPage() {
  const [session, snapshot] = await Promise.all([
    getAuthenticatedSession(),
    loadHighdarts(getSupabaseServerClient()).catch((error) => {
      console.error('Highdarts unavailable:', error);
      return null;
    }),
  ]);
  return (
    <HighdartsDashboard
      initial={snapshot}
      isAdmin={session?.user.isAdmin === true}
    />
  );
}
