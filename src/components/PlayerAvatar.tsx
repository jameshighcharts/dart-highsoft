import { cn } from '@/lib/utils';
import { AVATAR_SIZES, resolveAvatarUrl, type AvatarSize } from '@/lib/avatars';

export type { AvatarSize } from '@/lib/avatars';
export { playerInitials } from '@/lib/avatars';

export type AvatarPlayer = {
  id?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
};

/**
 * Circular player picture. Players without an uploaded picture get a default
 * goblin icon assigned deterministically from their id (see lib/avatars). One
 * component, one set of sizes, used everywhere a player is shown so avatars
 * look identical app-wide.
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

  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote Supabase Storage URL or static default icon; no optimizer config needed
    <img src={resolveAvatarUrl(player)} alt="" title={name} className={cn(base, 'bg-muted object-cover')} loading="lazy" decoding="async" />
  );
}
