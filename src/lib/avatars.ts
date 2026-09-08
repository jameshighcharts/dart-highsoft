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

// Default profile pictures: 40 goblin icons in public/avatars/default, keyed
// goblin-01..goblin-40 (row-major order of the source sheet). A player without
// an uploaded picture gets one picked deterministically from their id, so the
// same player always shows the same goblin everywhere.

export const DEFAULT_AVATAR_COUNT = 40;

export const DEFAULT_AVATAR_KEYS: readonly string[] = Array.from({ length: DEFAULT_AVATAR_COUNT }, (_, i) => `goblin-${String(i + 1).padStart(2, '0')}`);

export function defaultAvatarKey(seed: string): string {
  return DEFAULT_AVATAR_KEYS[hashSeed(seed) % DEFAULT_AVATAR_KEYS.length];
}

export function defaultAvatarUrl(seed: string): string {
  return `/avatars/default/${defaultAvatarKey(seed)}.png`;
}

/** Picture to show for a player: their upload, or their assigned default goblin. */
export function resolveAvatarUrl(player: { id?: string | null; display_name?: string | null; avatar_url?: string | null }): string {
  return player.avatar_url || defaultAvatarUrl(player.id || player.display_name || '');
}

// Shared look for player avatars: one set of circle sizes, deterministic
// fallback colour per player, and initials. Used by the React component and by
// the HTML-string renderer for the Highcharts Grid leaderboard.

export const AVATAR_SIZES = {
  xs: 'size-5 text-[9px]',
  sm: 'size-6 text-[10px]',
  md: 'size-8 text-xs',
  lg: 'size-12 text-base',
  xl: 'size-20 text-2xl',
} as const;

export type AvatarSize = keyof typeof AVATAR_SIZES;

export const AVATAR_PX: Record<AvatarSize, number> = { xs: 20, sm: 24, md: 32, lg: 48, xl: 80 };

const HUES = [210, 260, 300, 340, 20, 45, 90, 150, 180];

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash;
}

export function avatarHue(seed: string): number {
  return HUES[hashSeed(seed) % HUES.length];
}

export function avatarFallbackColor(seed: string): string {
  return `hsl(${avatarHue(seed)} 45% 60%)`;
}

export function playerInitials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeImageUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || url.startsWith('/');
}

/** HTML-string twin of <PlayerAvatar>, for grid cell formatters. */
export function renderPlayerAvatarHtml(
  player: { id?: string | null; display_name?: string | null; avatar_url?: string | null },
  size: AvatarSize = 'sm',
): string {
  const px = AVATAR_PX[size];
  const name = player.display_name ?? '';
  const common = `display:inline-flex;flex:none;width:${px}px;height:${px}px;border-radius:9999px;overflow:hidden;vertical-align:middle;`;
  const url = player.avatar_url && isSafeImageUrl(player.avatar_url) ? player.avatar_url : defaultAvatarUrl(player.id || name);
  if (url) {
    return `<img src="${escapeHtml(url)}" alt="" width="${px}" height="${px}" loading="lazy" decoding="async" style="${common}object-fit:cover;background:rgba(127,127,127,.2)" />`;
  }
  const fontSize = Math.max(9, Math.round(px * 0.38));
  return `<span aria-hidden="true" style="${common}align-items:center;justify-content:center;font-weight:600;line-height:1;color:#fff;font-size:${fontSize}px;background:${avatarFallbackColor(player.id ?? name)};box-shadow:inset 0 0 0 1px rgba(0,0,0,.1)">${escapeHtml(playerInitials(name))}</span>`;
}

/** Avatar followed by the (escaped) name, for grid cells. */
export function renderPlayerCellHtml(
  player: { id?: string | null; display_name?: string | null; avatar_url?: string | null },
  size: AvatarSize = 'sm',
): string {
  return `<span style="display:inline-flex;align-items:center;gap:8px;min-width:0">${renderPlayerAvatarHtml(player, size)}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(player.display_name ?? '')}</span></span>`;
}
