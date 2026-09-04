import { cn } from '@/lib/utils';
import { AVATAR_SIZES, avatarFallbackColor, playerInitials, type AvatarSize } from '@/lib/avatarStyle';

export type { AvatarSize } from '@/lib/avatarStyle';
export { playerInitials } from '@/lib/avatarStyle';

export type AvatarPlayer = {
  id?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
};

/**
 * Circular player picture with an initials fallback. One component, one set of
 * sizes, used everywhere a player is shown so avatars look identical app-wide.
 * When the row only carries a player id (leaderboard views), use
 * <PlayerAvatarById> which looks the picture up from a cached players fetch.
 */
export function PlayerAvatar({
  player,
  size = 'md',
  className,
}: {
  player: AvatarPlayer;
  size?: AvatarSize;
  className?: string;
}) {
  const name = player.display_name ?? '';
  const base = cn(
    'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full align-middle',
    AVATAR_SIZES[size],
    className,
  );

  if (player.avatar_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote Supabase Storage URL; no optimizer config needed
      <img src={player.avatar_url} alt="" title={name} className={cn(base, 'bg-muted object-cover')} loading="lazy" decoding="async" />
    );
  }

  return (
    <span
      aria-hidden="true"
      title={name}
      className={cn(base, 'font-semibold leading-none ring-1 ring-black/10')}
      style={{ backgroundColor: avatarFallbackColor(player.id ?? name), color: 'white' }}
    >
      {playerInitials(name)}
    </span>
  );
}
