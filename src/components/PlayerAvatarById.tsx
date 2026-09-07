'use client';

import { useQuery } from '@tanstack/react-query';

import { PlayerAvatar, type AvatarSize } from '@/components/PlayerAvatar';
import { getSupabaseClient } from '@/lib/supabaseClient';

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
  const { data } = useQuery({
    queryKey: ['player-avatars'],
    queryFn: fetchPlayerAvatars,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const avatarUrl = playerId ? data?.[playerId] ?? null : null;
  return <PlayerAvatar player={{ id: playerId, display_name: name, avatar_url: avatarUrl }} size={size} className={className} />;
}

async function fetchPlayerAvatars(): Promise<Record<string, string | null>> {
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.from('players').select('id, avatar_url');
  if (error) throw new Error(error.message);
  const map: Record<string, string | null> = {};
  for (const row of data ?? []) map[row.id as string] = (row.avatar_url as string | null) ?? null;
  return map;
}
