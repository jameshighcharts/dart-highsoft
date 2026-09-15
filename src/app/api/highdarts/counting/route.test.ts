import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { PUT } from "./route";

const { guard, rpc } = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/auth/requireAdmin", () => ({
  requireUser: guard,
  isGuardResponse: (v: unknown) => v instanceof NextResponse,
}));
vi.mock("@/lib/supabaseServer", () => ({
  getSupabaseServerClient: () => ({ rpc }),
}));
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const body = {
  eventId: id(1),
  playerId: id(2),
  excludedFixtureId: id(3),
  expectedExcludedFixtureId: null,
};
const request = (value: unknown = body) =>
  new Request("http://localhost", {
    method: "PUT",
    body: JSON.stringify(value),
  });
beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue({
    user: { slackTeamId: "team", slackUserId: "owner", isAdmin: false },
  });
  rpc.mockResolvedValue({ error: null });
});
it("requires a signed-in Slack identity before database access", async () => {
  guard.mockResolvedValue(
    NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  );
  expect((await PUT(request())).status).toBe(401);
  expect(rpc).not.toHaveBeenCalled();
});
it("validates player, event, new and expected choice at the boundary", async () => {
  for (const invalid of [
    null,
    JSON.stringify(body),
    {},
    { ...body, playerId: "gjertrud" },
    { ...body, excludedFixtureId: "bad" },
    { ...body, expectedExcludedFixtureId: undefined },
  ]) {
    expect((await PUT(request(invalid))).status).toBe(400);
  }
  expect(rpc).not.toHaveBeenCalled();
});
it("passes trusted session identity and ignores spoofed admin permissions", async () => {
  expect(
    (
      await PUT(
        request({ ...body, isAdmin: true, slackUserId: "someone-else" }),
      )
    ).status,
  ).toBe(200);
  expect(rpc).toHaveBeenCalledWith("set_highdarts_counting_atomic", {
    p_event_id: id(1),
    p_player_id: id(2),
    p_excluded_fixture_id: id(3),
    p_expected_excluded_fixture_id: null,
    p_team_id: "team",
    p_slack_user_id: "owner",
    p_is_admin: false,
  });
});
it("supports clearing the choice and reports ownership and stale/locked conflicts", async () => {
  expect(
    (
      await PUT(
        request({
          ...body,
          excludedFixtureId: null,
          expectedExcludedFixtureId: id(3),
        }),
      )
    ).status,
  ).toBe(200);
  for (const [code, status] of [
    ["42501", 403],
    ["55000", 409],
    ["22023", 400],
  ] as const) {
    rpc.mockResolvedValue({ error: { code, message: "Rejected" } });
    expect((await PUT(request())).status).toBe(status);
  }
});
