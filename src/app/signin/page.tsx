import { redirect } from 'next/navigation';

import { getAuthenticatedSession } from '@/auth';
import {
  firstValue,
  getAuthErrorMessage,
  resolveRedirectTarget,
  SignInCard,
  type SearchParamValue,
} from '@/components/auth/SignInCard';

type SignInPageProps = { searchParams?: Promise<Record<string, SearchParamValue>> };

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const [session, resolvedSearchParams] = await Promise.all([getAuthenticatedSession(), searchParams]);
  if (session) redirect('/admin');

  return (
    <SignInCard
      title="Dart admin"
      subtitle="Sign in with your Highsoft Slack account."
      callbackUrl={resolveRedirectTarget(resolvedSearchParams?.callbackUrl, '/admin')}
      errorReturnPath="/signin"
      errorMessage={getAuthErrorMessage(firstValue(resolvedSearchParams?.error))}
    />
  );
}
