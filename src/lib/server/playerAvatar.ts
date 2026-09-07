import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { AVATAR_BUCKET, avatarStoragePathFromUrl } from '@/lib/avatars';

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Sniff the real type from magic bytes; never trust the declared MIME type. */
export function detectImageType(bytes: Uint8Array): keyof typeof EXTENSIONS | null {
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

export class AvatarError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

/** Validates the multipart upload and returns the bytes + detected type. */
export async function readAvatarUpload(request: Request): Promise<{ bytes: Uint8Array; contentType: string }> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new AvatarError('Expected multipart form data', 400);
  }
  const file = form.get('file');
  if (!(file instanceof File)) throw new AvatarError('file is required', 400);
  if (file.size === 0) throw new AvatarError('File is empty', 400);
  if (file.size > AVATAR_MAX_BYTES) throw new AvatarError('Image must be 2 MB or smaller', 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = detectImageType(bytes);
  if (!contentType) throw new AvatarError('Only PNG, JPEG or WebP images are allowed', 415);
  return { bytes, contentType };
}

/** Stores the picture as players/<id>.<ext>, updates players.avatar_url, returns the new URL. */
export async function setPlayerAvatar(
  supabase: SupabaseClient,
  playerId: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string> {
  const player = await supabase.from('players').select('id, avatar_url').eq('id', playerId).maybeSingle();
  if (player.error) throw new Error(player.error.message);
  if (!player.data) throw new AvatarError('Player not found', 404);

  const path = `players/${playerId}.${EXTENSIONS[contentType]}`;
  const upload = await supabase.storage.from(AVATAR_BUCKET).upload(path, bytes, { contentType, upsert: true, cacheControl: '3600' });
  if (upload.error) throw new Error(upload.error.message);

  const previousPath = avatarStoragePathFromUrl(player.data.avatar_url as string | null);
  if (previousPath && previousPath !== path) await supabase.storage.from(AVATAR_BUCKET).remove([previousPath]);

  const { data: publicUrl } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  const avatarUrl = `${publicUrl.publicUrl}?v=${Date.now()}`; // cache-bust replaced pictures

  const updated = await supabase.from('players').update({ avatar_url: avatarUrl }).eq('id', playerId);
  if (updated.error) throw new Error(updated.error.message);
  return avatarUrl;
}

export async function clearPlayerAvatar(supabase: SupabaseClient, playerId: string): Promise<void> {
  const player = await supabase.from('players').select('id, avatar_url').eq('id', playerId).maybeSingle();
  if (player.error) throw new Error(player.error.message);
  if (!player.data) throw new AvatarError('Player not found', 404);

  const path = avatarStoragePathFromUrl(player.data.avatar_url as string | null);
  if (path) {
    const removed = await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    if (removed.error) throw new Error(removed.error.message);
  }
  const updated = await supabase.from('players').update({ avatar_url: null }).eq('id', playerId);
  if (updated.error) throw new Error(updated.error.message);
}
