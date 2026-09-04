import { redirect } from 'next/navigation';

import { getAuthenticatedSession } from '@/auth';
import {
  firstValue,
  getAuthErrorMessage,
  resolveRedirectTarget,
  SignInCard,
  type SearchParamValue,
} from '@/components/auth/SignInCard';

type LoginPageProps = { searchParams?: Promise<Record<string, SearchParamValue>> };

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const [session, resolvedSearchParams] = await Promise.all([getAuthenticatedSession(), searchParams]);
  const callbackUrl = resolveRedirectTarget(resolvedSearchParams?.callbackUrl, '/');
  if (session) redirect(callbackUrl);

  return (
    <SignInCard
      title="Highsoft Darts"
      subtitle="Sign in with your Highsoft Slack account."
      callbackUrl={callbackUrl}
      errorReturnPath="/login"
      errorMessage={getAuthErrorMessage(firstValue(resolvedSearchParams?.error))}
    />
  );
}
