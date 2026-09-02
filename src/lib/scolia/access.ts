import 'server-only';

import { NextResponse } from 'next/server';

export function requireScoliaBoardManagementAccess(): NextResponse | null {
  if (process.env.NODE_ENV !== 'production') return null;
  return NextResponse.json(
    { error: 'Scolia board management requires admin authentication in production' },
    { status: 403 }
  );
}

