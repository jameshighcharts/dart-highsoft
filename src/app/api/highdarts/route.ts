import { NextResponse } from 'next/server';
import { loadHighdarts } from '@/lib/highdarts/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    return NextResponse.json(await loadHighdarts(getSupabaseServerClient()), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Highdarts load failed:', error);
    return NextResponse.json(
      { error: 'Highdarts is unavailable. Please try again.' },
      { status: 503 },
    );
  }
}
