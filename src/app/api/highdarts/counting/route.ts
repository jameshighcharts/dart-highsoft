import { NextResponse } from "next/server";
import { isGuardResponse, requireUser } from "@/lib/auth/requireAdmin";
import { highdartsErrorStatus, isUuid } from "@/lib/highdarts/server";
import { getSupabaseServerClient } from "@/lib/supabaseServer";

export async function PUT(request: Request) {
  const guard = await requireUser();
  if (isGuardResponse(guard)) return guard;
  const body: unknown = await request.json().catch(() => null);
  if (
    !body ||
    typeof body !== "object" ||
    !("eventId" in body) ||
    !isUuid(body.eventId) ||
    !("playerId" in body) ||
    !isUuid(body.playerId) ||
    !("excludedFixtureId" in body) ||
    (body.excludedFixtureId !== null && !isUuid(body.excludedFixtureId)) ||
    !("expectedExcludedFixtureId" in body) ||
    (body.expectedExcludedFixtureId !== null &&
      !isUuid(body.expectedExcludedFixtureId))
  ) {
    return NextResponse.json(
      {
        error:
          "A tournament, player and current/new fixture choice are required.",
      },
      { status: 400 },
    );
  }
  try {
    const { error } = await getSupabaseServerClient().rpc(
      "set_highdarts_counting_atomic",
      {
        p_event_id: body.eventId,
        p_player_id: body.playerId,
        p_excluded_fixture_id: body.excludedFixtureId,
        p_expected_excluded_fixture_id: body.expectedExcludedFixtureId,
        p_team_id: guard.user.slackTeamId,
        p_slack_user_id: guard.user.slackUserId,
        p_is_admin: guard.user.isAdmin === true,
      },
    );
    if (error)
      return NextResponse.json(
        { error: error.message },
        { status: highdartsErrorStatus(error.code) },
      );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Could not save the excluded result. Please try again." },
      { status: 500 },
    );
  }
}
