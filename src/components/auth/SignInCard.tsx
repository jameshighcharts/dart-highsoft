import Image from 'next/image';
import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';

import { isSlackAuthConfigured, signIn } from '@/auth';

export type SearchParamValue = string | string[] | undefined;

export function firstValue(value: SearchParamValue) {
  return Array.isArray(value) ? value[0] : value;
}

export function getAuthErrorMessage(errorType?: string) {
  switch (errorType) {
    case undefined:
    case '':
      return null;
    case 'OAuthSignin':
      return 'Slack rejected the sign-in request.';
    case 'CallbackRouteError':
    case 'OAuthCallbackError':
      return 'Slack returned, but the callback could not complete.';
    case 'Configuration':
      return 'Slack sign-in is not configured yet.';
    case 'SlackWorkspaceRestricted':
      return 'Use the Highsoft Slack workspace to sign in.';
    case 'SlackEmailDomainRestricted':
      return 'Use your Highsoft work account to sign in.';
    case 'SlackEmailNotVerified':
      return 'Your Slack email is not verified.';
    case 'SlackProfileIncomplete':
      return 'Slack did not share your user id. Try again.';
    case 'AccessDenied':
      return 'You do not have access.';
    default:
      return 'Authentication failed. Try again.';
  }
}

/** Only same-origin paths are accepted; anything else falls back to `fallback`. */
export function resolveRedirectTarget(value: SearchParamValue, fallback: string) {
  const resolved = firstValue(value);
  if (!resolved || !resolved.startsWith('/') || resolved.startsWith('//')) return fallback;
  return resolved;
}

function SlackGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="10.2" y="1.5" width="3.6" height="8" rx="1.8" fill="#36C5F0" />
      <rect x="14.5" y="10.2" width="8" height="3.6" rx="1.8" fill="#36C5F0" />
      <rect x="14.5" y="1.5" width="3.6" height="8" rx="1.8" fill="#2EB67D" />
      <rect x="10.2" y="5.8" width="8" height="3.6" rx="1.8" fill="#2EB67D" />
      <rect x="10.2" y="14.5" width="3.6" height="8" rx="1.8" fill="#ECB22E" />
      <rect x="1.5" y="10.2" width="8" height="3.6" rx="1.8" fill="#ECB22E" />
      <rect x="5.8" y="14.5" width="3.6" height="8" rx="1.8" fill="#E01E5A" />
      <rect x="1.5" y="14.5" width="8" height="3.6" rx="1.8" fill="#E01E5A" />
    </svg>
  );
}

type SignInCardProps = {
  title: string;
  subtitle: string;
  callbackUrl: string;
  /** Page to return to with `?error=` when Slack fails. */
  errorReturnPath: '/login' | '/signin';
  errorMessage: string | null;
};

export function SignInCard({ title, subtitle, callbackUrl, errorReturnPath, errorMessage }: SignInCardProps) {
  return (
    <main className="theme-light flex min-h-svh w-full items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div className="flex flex-col items-center gap-3 text-center">
          <Image src="/icon-192x192.png" alt="" width={56} height={56} className="size-14 object-contain" priority />
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>

        <div className="mt-8">
          {isSlackAuthConfigured ? (
            <form
              action={async () => {
                'use server';
                try {
                  await signIn('slack', { redirectTo: callbackUrl });
                } catch (error) {
                  if (error instanceof AuthError) redirect(`${errorReturnPath}?error=${encodeURIComponent(error.type)}`);
                  throw error;
                }
              }}
            >
              <button
                type="submit"
                className="flex h-12 w-full items-center justify-center gap-3 rounded-lg border border-border bg-background text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <SlackGlyph />
                Login with Slack
              </button>
            </form>
          ) : (
            <p className="rounded-lg border border-border bg-muted px-4 py-3 text-center text-sm text-muted-foreground">
              Sign-in is not configured.
            </p>
          )}
        </div>

        {errorMessage ? (
          <p role="alert" className="mt-4 text-center text-sm text-red-600">
            {errorMessage}
          </p>
        ) : null}
      </div>
    </main>
  );
}
