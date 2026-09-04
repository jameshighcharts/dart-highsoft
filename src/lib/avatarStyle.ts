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

export function avatarHue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return HUES[hash % HUES.length];
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
  if (player.avatar_url && isSafeImageUrl(player.avatar_url)) {
    return `<img src="${escapeHtml(player.avatar_url)}" alt="" width="${px}" height="${px}" loading="lazy" decoding="async" style="${common}object-fit:cover;background:rgba(127,127,127,.2)" />`;
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
