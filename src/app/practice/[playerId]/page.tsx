import PracticeClient from '@/components/PracticeClient';
import { requirePageSession } from '@/lib/auth/requirePageSession';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { notFound } from 'next/navigation';

type Props = {
  params: Promise<{
    playerId: string;
  }>;
};

export default async function PracticePlayerPage({ params }: Props) {
  const { playerId } = await params;
  await requirePageSession(`/practice/${playerId}`);
  const supabase = await getSupabaseClient();
  
  // Get the specific player
  const { data: player, error } = await supabase
    .from('players')
    .select('id, display_name, avatar_url')
    .eq('id', playerId)
    .single();

  if (error || !player) {
    notFound();
  }

  return <PracticeClient player={player} />;
}