import { NextResponse, type NextRequest } from 'next/server';

import { auth, isAuthConfigured } from '@/auth';
import { renewSessionCookie } from '@/lib/auth/renewSessionCookie';
import { withSession } from '@/lib/auth/withSession';
import { signSupabaseToken } from '@/lib/server/supabaseToken';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

/**
 * A token for the signed-in member's browser to use Supabase with (see src/lib/server/supabaseToken).
 * 503 while no signing key is configured: the browser then keeps using the anon key.
 *
 * Every tab asks for one when it opens and again every hour, so this is also where the sign-in
 * cookie is renewed (30 days from now), keeping members signed in for as long as they use the app.
 */
async function getHandler(request: NextRequest) {
  let response: NextResponse;
  try {
    const token = await signSupabaseToken();
    response = token
      ? NextResponse.json(token, { headers: NO_STORE })
      : NextResponse.json({ error: 'Supabase tokens are not configured' }, { status: 503, headers: NO_STORE });
  } catch (error) {
    console.error('Could not sign a Supabase token:', error);
    response = NextResponse.json({ error: 'Could not sign a Supabase token' }, { status: 500, headers: NO_STORE });
  }
  if (isAuthConfigured) {
    try {
      await renewSessionCookie(auth, request, response);
    } catch (error) {
      console.error('Could not renew the sign-in cookie:', error);
    }
  }
  return response;
}

export const GET = withSession(getHandler);
