import Image from 'next/image';
import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';

import { isAuthConfigured, isGoogleAuthConfigured, isSlackAuthConfigured, signIn } from '@/auth';

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
    case 'GoogleEmailDomainRestricted':
      return 'Use your Highsoft Google account to sign in.';
    case 'GoogleEmailNotVerified':
      return 'Your Google email is not verified.';
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

function GoogleGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 shrink-0" xmlns="http://www.w3.org/2000/svg">
      <path fill="#4285F4" d="M23.52 12.27c0-.82-.07-1.6-.2-2.36H12v4.46h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.72Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.94-2.91l-3.88-3a7.2 7.2 0 0 1-4.06 1.15 7.14 7.14 0 0 1-6.71-4.94H1.28v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.29 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.28a12 12 0 0 0 0 10.8l4.01-3.1Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.35.6 4.6 1.8l3.43-3.43A11.96 11.96 0 0 0 12 0 12 12 0 0 0 1.28 6.6l4.01 3.1A7.14 7.14 0 0 1 12 4.77Z" />
    </svg>
  );
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

function ProviderForm({
  provider,
  callbackUrl,
  errorReturnPath,
  label,
  children,
}: {
  provider: 'slack' | 'google';
  callbackUrl: string;
  errorReturnPath: '/login' | '/signin';
  label: string;
  children: React.ReactNode;
}) {
  return (
    <form
      action={async () => {
        'use server';
        try {
          await signIn(provider, { redirectTo: callbackUrl });
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
        {children}
        {label}
      </button>
    </form>
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

        <div className="mt-8 flex flex-col gap-3">
          {isAuthConfigured ? (
            <>
              {isSlackAuthConfigured ? (
                <ProviderForm provider="slack" callbackUrl={callbackUrl} errorReturnPath={errorReturnPath} label="Login with Slack">
                  <SlackGlyph />
                </ProviderForm>
              ) : null}
              {isGoogleAuthConfigured ? (
                <ProviderForm provider="google" callbackUrl={callbackUrl} errorReturnPath={errorReturnPath} label="Login with Google">
                  <GoogleGlyph />
                </ProviderForm>
              ) : null}
            </>
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
