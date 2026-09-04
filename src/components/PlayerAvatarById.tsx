'use client';

import { PlayerAvatar, type AvatarSize } from '@/components/PlayerAvatar';
import { usePlayerAvatarUrl } from '@/hooks/usePlayerAvatars';

/** <PlayerAvatar> for rows that only know the player id and name. */
export function PlayerAvatarById({
  playerId,
  name,
  size = 'md',
  className,
}: {
  playerId: string | null | undefined;
  name: string | null | undefined;
  size?: AvatarSize;
  className?: string;
}) {
  const avatarUrl = usePlayerAvatarUrl(playerId);
  return <PlayerAvatar player={{ id: playerId, display_name: name, avatar_url: avatarUrl }} size={size} className={className} />;
}
