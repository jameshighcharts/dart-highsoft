import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & {
      slackUserId: string | null;
      slackTeamId: string | null;
      isAdmin: boolean;
      provider: string | null;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    slackUserId?: string;
    slackTeamId?: string;
    isAdmin?: boolean;
    provider?: string;
  }
}
