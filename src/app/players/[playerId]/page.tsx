import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthenticatedSession } from "@/auth";
import { PlayerAvatar } from "@/components/PlayerAvatar";
import { PlayerEloStats } from "@/components/PlayerEloStats";
import { PlayerMultiEloStats } from "@/components/PlayerMultiEloStats";
import { ProfileFixtures } from "@/components/highdarts/Fixtures";
import { ProfileSummaryCard } from "@/components/profile/ProfileSummaryCard";
import { isUuid } from "@/lib/highdarts/server";
import { PLAYER_COLUMNS, type MyPlayer } from "@/lib/server/myPlayer";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await params;
  if (!isUuid(playerId)) notFound();
  const session = await getAuthenticatedSession();
  if (!session)
    redirect(
      `/login?callbackUrl=${encodeURIComponent(`/players/${playerId}`)}`,
    );
  const supabase = getSupabaseServerClient();
  const { data: player, error } = await supabase
    .from("players")
    .select(PLAYER_COLUMNS)
    .eq("id", playerId)
    .returns<MyPlayer[]>()
    .maybeSingle();
  if (error) throw new Error("Could not load player profile");
  if (!player || player.is_test) notFound();
  const teamId = session.user.slackTeamId;
  const link = teamId
    ? await supabase
        .from("slack_player_links")
        .select("slack_user_id")
        .eq("player_id", playerId)
        .eq("team_id", teamId)
        .maybeSingle()
    : null;
  if (link?.error) throw new Error("Could not load Slack identity");
  const slackUserId = link?.data?.slack_user_id;
  const slackUrl =
    typeof slackUserId === "string" && teamId
      ? `slack://user?team=${encodeURIComponent(teamId)}&id=${encodeURIComponent(slackUserId)}`
      : null;
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 pb-24">
      <Link href="/bengt" className="text-sm text-cyan-300">
        Back to Bengt
      </Link>
      <header className="flex items-center gap-4 rounded-2xl border border-white/10 bg-card p-5">
        <PlayerAvatar player={player} size="xl" />
        <div className="min-w-0 space-y-2">
          <h1 className="text-2xl font-semibold">{player.display_name}</h1>
          <p className="text-sm capitalize text-muted-foreground">
            {player.location ?? "No location"}
          </p>
          {slackUrl ? (
            <a
              href={slackUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-sm text-cyan-300"
            >
              Open in Slack
            </a>
          ) : (
            <p className="text-xs text-muted-foreground">
              Slack account not linked in this workspace.
            </p>
          )}
        </div>
      </header>
      <ProfileFixtures playerId={player.id} title="Highdarts 2026 schedule" />
      <ProfileSummaryCard playerId={player.id} />
      <div className="grid gap-6 md:grid-cols-2">
        <PlayerEloStats player={player} showHistory />
        <PlayerMultiEloStats player={player} showHistory />
      </div>
    </main>
  );
}
