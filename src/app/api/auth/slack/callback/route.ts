import { NextRequest, NextResponse } from 'next/server';

// Alias kept in step with the Compass app so a Slack app configured with
// /api/auth/slack/callback as its redirect URL also works here.
export function GET(request: NextRequest) {
  const callbackUrl = new URL('/api/auth/callback/slack', request.url);
  callbackUrl.search = request.nextUrl.search;
  return NextResponse.redirect(callbackUrl);
}
