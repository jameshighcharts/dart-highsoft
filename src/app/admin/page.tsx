import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAuthenticatedSession, signOut } from '@/auth';
import { AdminUsersPanel } from '@/components/admin/AdminUsersPanel';
import { isAuthDevBypassEnabled } from '@/lib/auth/devBypass';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await getAuthenticatedSession();
  if (!session?.user.slackUserId) redirect('/signin?callbackUrl=%2Fadmin');

  const viewer = {
    name: session.user.name ?? session.user.email ?? 'You',
    email: session.user.email ?? null,
    slackUserId: session.user.slackUserId,
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 md:px-6 md:py-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Players and their Slack identities for the <code className="rounded bg-muted px-1 py-0.5 text-xs">/dart</code> poll.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/" className="text-muted-foreground hover:text-foreground">
            Back to scoreboard
          </Link>
          <span className="text-muted-foreground" aria-hidden="true">·</span>
          <span className="text-muted-foreground">{viewer.name}</span>
          {isAuthDevBypassEnabled() ? (
            <span className="rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">dev bypass</span>
          ) : (
          <form
            action={async () => {
              'use server';
              await signOut({ redirectTo: '/signin' });
            }}
          >
            <button type="submit" className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted">
              Sign out
            </button>
          </form>
          )}
        </div>
      </header>

      {session.user.isAdmin ? (
        <AdminUsersPanel viewer={viewer} />
      ) : (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Your account is signed in but not on the admin list.
        </p>
      )}
    </div>
  );
}
