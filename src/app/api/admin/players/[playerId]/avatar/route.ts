import { NextResponse } from 'next/server';

import { isGuardResponse, requireAdmin } from '@/lib/auth/requireAdmin';
import { AVATAR_BUCKET, avatarStoragePathFromUrl } from '@/lib/avatars';
import { getSupabaseServerClient } from '@/lib/supabaseServer';

const MAX_BYTES = 2 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Sniff the real type from magic bytes; never trust the declared MIME type. */
function detectImageType(bytes: Uint8Array): keyof typeof EXTENSIONS | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/** Upload (or replace) a player's profile picture. multipart/form-data with field `file`. */
export async function POST(request: Request, { params }: { params: Promise<{ playerId: string }> }) {
  const guard = await requireAdmin();
  if (isGuardResponse(guard)) return guard;

  try {
    const { playerId } = await params;
    if (!UUID_PATTERN.test(playerId)) return NextResponse.json({ error: 'Invalid player id' }, { status: 400 });

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 });
    }
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });
    if (file.size === 0) return NextResponse.json({ error: 'File is empty' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Image must be 2 MB or smaller' }, { status: 413 });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const contentType = detectImageType(bytes);
    if (!contentType) return NextResponse.json({ error: 'Only PNG, JPEG or WebP images are allowed' }, { status: 415 });

    const supabase = getSupabaseServerClient();
    const player = await supabase.from('players').select('id, avatar_url').eq('id', playerId).maybeSingle();
    if (player.error) throw new Error(player.error.message);
    if (!player.data) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

    const path = `players/${playerId}.${EXTENSIONS[contentType]}`;
    const upload = await supabase.storage.from(AVATAR_BUCKET).upload(path, bytes, { contentType, upsert: true, cacheControl: '3600' });
    if (upload.error) throw new Error(upload.error.message);

    // Remove a previous file with another extension so the bucket stays tidy.
    const previousPath = avatarStoragePathFromUrl(player.data.avatar_url as string | null);
    if (previousPath && previousPath !== path) await supabase.storage.from(AVATAR_BUCKET).remove([previousPath]);

    const { data: publicUrl } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
    const avatarUrl = `${publicUrl.publicUrl}?v=${Date.now()}`; // cache-bust replaced pictures

    const updated = await supabase
      .from('players')
      .update({ avatar_url: avatarUrl })
      .eq('id', playerId)
      .select('id, avatar_url')
      .single();
    if (updated.error) throw new Error(updated.error.message);

    return NextResponse.json({ playerId, avatarUrl });
  } catch (error) {
    console.error('POST /api/admin/players/[playerId]/avatar error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to upload avatar' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ playerId: string }> }) {
  const guard = await requireAdmin();
  if (isGuardResponse(guard)) return guard;

  try {
    const { playerId } = await params;
    if (!UUID_PATTERN.test(playerId)) return NextResponse.json({ error: 'Invalid player id' }, { status: 400 });

    const supabase = getSupabaseServerClient();
    const player = await supabase.from('players').select('id, avatar_url').eq('id', playerId).maybeSingle();
    if (player.error) throw new Error(player.error.message);
    if (!player.data) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

    const path = avatarStoragePathFromUrl(player.data.avatar_url as string | null);
    if (path) {
      const removed = await supabase.storage.from(AVATAR_BUCKET).remove([path]);
      if (removed.error) throw new Error(removed.error.message);
    }
    const updated = await supabase.from('players').update({ avatar_url: null }).eq('id', playerId);
    if (updated.error) throw new Error(updated.error.message);

    return NextResponse.json({ playerId, avatarUrl: null });
  } catch (error) {
    console.error('DELETE /api/admin/players/[playerId]/avatar error:', error);
    return NextResponse.json({ error: 'Failed to remove avatar' }, { status: 500 });
  }
}
