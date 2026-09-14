import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page from "./page";
import { getAuthenticatedSession } from "@/auth";
import { getSupabaseServerClient } from "@/lib/supabaseServer";
vi.mock("@/auth", () => ({ getAuthenticatedSession: vi.fn() }));
const { eq, single, query } = vi.hoisted(() => {
  const eq = vi.fn();
  const single = vi.fn();
  const query = {
    select: vi.fn().mockReturnThis(),
    eq,
    returns: vi.fn().mockReturnThis(),
    maybeSingle: single,
  };
  return { eq, single, query };
});
vi.mock("@/lib/supabaseServer", () => ({
  getSupabaseServerClient: vi.fn(() => ({ from: () => query })),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
  redirect: () => {
    throw new Error("login");
  },
}));
vi.mock("@/components/highdarts/Fixtures", () => ({
  ProfileFixtures: () => null,
}));
vi.mock("@/components/profile/ProfileSummaryCard", () => ({
  ProfileSummaryCard: () => null,
}));
vi.mock("@/components/PlayerEloStats", () => ({ PlayerEloStats: () => null }));
vi.mock("@/components/PlayerMultiEloStats", () => ({
  PlayerMultiEloStats: () => null,
}));
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAuthenticatedSession).mockResolvedValue({
    user: {
      name: "Viewer",
      email: "viewer@example.com",
      slackTeamId: "TTEAM",
      slackUserId: "UVIEWER",
      isAdmin: false,
    },
    expires: "future",
  });
  eq.mockReturnValue(query);
  query.select.mockReturnThis();
  query.returns.mockReturnThis();
  single.mockResolvedValueOnce({
    data: { id, display_name: "Ada Jones", location: "bergen", is_test: false },
    error: null,
  });
});
afterEach(cleanup);
it("links only the current workspace’s saved Slack identity and has no profile edit controls", async () => {
  single.mockResolvedValueOnce({
    data: { slack_user_id: "UADA" },
    error: null,
  });
  render(await Page({ params: Promise.resolve({ playerId: id }) }));
  expect(eq).toHaveBeenCalledWith("team_id", "TTEAM");
  expect(screen.getByRole("link", { name: "Open in Slack" })).toHaveAttribute(
    "href",
    "slack://user?team=TTEAM&id=UADA",
  );
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
it("does not invent a Slack account for an unlinked player", async () => {
  single.mockResolvedValueOnce({ data: null, error: null });
  render(await Page({ params: Promise.resolve({ playerId: id }) }));
  expect(
    screen.queryByRole("link", { name: "Open in Slack" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText("Slack account not linked in this workspace."),
  ).toBeInTheDocument();
});
it("requires a signed-in session before looking up player details", async () => {
  vi.mocked(getAuthenticatedSession).mockResolvedValue(null);
  await expect(
    Page({ params: Promise.resolve({ playerId: id }) }),
  ).rejects.toThrow("login");
  expect(getSupabaseServerClient).not.toHaveBeenCalled();
});
it("rejects malformed player IDs without querying the database", async () => {
  await expect(
    Page({ params: Promise.resolve({ playerId: "not-an-id" }) }),
  ).rejects.toThrow("not found");
  expect(getSupabaseServerClient).not.toHaveBeenCalled();
});
