import { NextResponse } from 'next/server';
import { loadHighdarts } from '@/lib/highdarts/server';
import { buildSheetExport } from '@/lib/highdarts/sheetExport';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const snapshot = await loadHighdarts(getSupabaseServerClient());
    if (snapshot.fixtures.filter((f) => f.stage === 'group').length !== 76) {
      throw new Error('Incomplete Highdarts draw');
    }
    return NextResponse.json(buildSheetExport(snapshot), {
      headers: { 'Cache-Control': 'public, s-maxage=60' },
    });
  } catch (error) {
    console.error('Highdarts sheet export failed:', error);
    return NextResponse.json({ error: 'Tournament export unavailable' }, { status: 503 });
  }
}
