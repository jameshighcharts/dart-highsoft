export const AVATAR_BUCKET = 'avatars';

/** Public avatar URL -> storage object path inside the avatars bucket, or null. */
export function avatarStoragePathFromUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
  const index = url.indexOf(marker);
  if (index === -1) return null;
  const path = url.slice(index + marker.length).split('?')[0];
  return path.startsWith('players/') && !path.includes('..') ? path : null;
}
