import { GET as getAvailableBoards } from '@/app/api/scolia/boards/available/route';
import { NextResponse } from 'next/server';
import { loadHighdarts } from '@/lib/highdarts/server';
import { getSupabaseServerClient } from '@/lib/supabaseServer';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const [snapshot, response] = await Promise.all([loadHighdarts(getSupabaseServerClient()), getAvailableBoards()]);
    if (!response.ok) throw new Error('Board availability could not load');
    const { boards } = await response.json();
    return NextResponse.json({ ...snapshot, boards }, {
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
