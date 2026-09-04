import { redirect } from 'next/navigation';

import { getAuthenticatedSession } from '@/auth';
import { ProfileClient } from '@/components/profile/ProfileClient';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const session = await getAuthenticatedSession();
  if (!session?.user.slackUserId) redirect('/login?callbackUrl=%2Fprofile');
  return <ProfileClient />;
}
