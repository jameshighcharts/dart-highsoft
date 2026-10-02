import { NextResponse } from 'next/server';
import { loadHighdarts } from '@/lib/highdarts/server';
import { buildSheetExport } from '@/lib/highdarts/sheetExport';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const snapshot = await loadHighdarts(getSupabaseServerClient());
    const groups = snapshot.fixtures.filter((f) => f.stage === 'group');
    const expected = { bergen: 30, vik: 33, sogndal: groups.length === 80 ? 17 : 13 };
    if ((groups.length !== 76 && groups.length !== 80) || Object.entries(expected).some(([office, count]) => {
      const numbers = groups.filter((f) => f.office === office).map((f) => f.fixture_no).sort((a, b) => a - b);
      return numbers.length !== count || numbers.some((n, i) => n !== i + 1);
    })) {
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
