import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { fixture, finish } from "@/test-utils/highdartsFixtures";
import type { Snapshot } from "@/lib/highdarts/standings";
import { ProfileFixtures, FixtureCard } from "./Fixtures";
import { TooltipProvider } from "@/components/ui/tooltip";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const players = [
  { id: "a", display_name: "Ada Jones" },
  { id: "b", display_name: "Ben Smith" },
  { id: "c", display_name: "Ben Taylor" },
];
it("shows the linked player’s group and finals schedule, including history and opponent profiles", async () => {
  const first = fixture("bergen", "a", "b");
  const live = { ...fixture("bergen", "a", "c", 2), match_id: "live" };
  const final = {
    ...fixture("bergen", "a", "c", 80),
    office: null,
    stage: "final" as const,
  };
  const data: Snapshot = {
    players,
    fixtures: [finish(first, "a"), live, final, fixture("vik", "b", "c")],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => data }),
  );
  render(<ProfileFixtures playerId="a" />);
  const region = within(
    await screen.findByRole("region", { name: "Your Highdarts schedule" }),
  );
  await screen.findByText("2 remaining · 1 finished");
  expect(region.getByRole("link", { name: "Watch live" })).toHaveAttribute(
    "href",
    "/match/live",
  );
  expect(region.getAllByRole("link", { name: "Ben T" })[0]).toHaveAttribute(
    "href",
    "/players/c",
  );
  expect(region.queryByText("Vik #1")).not.toBeInTheDocument();
  expect(region.getByText("Final #80")).toBeInTheDocument();
  expect(
    region.getByRole("link", { name: "View match", hidden: true }),
  ).toHaveAttribute("href", `/match/match-${first.id}`);
});
it("shows a busy game instead of offering another start in that office", () => {
  const upcoming = fixture("bergen", "a", "b", 2);
  const data = {
    players,
    fixtures: [upcoming, { ...fixture("bergen", "b", "c"), match_id: "busy" }],
  };
  render(
    <TooltipProvider>
      <FixtureCard fixture={upcoming} snapshot={data} />
    </TooltipProvider>,
  );
  expect(screen.queryByRole("link", { name: /Start/ })).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "View current game" }),
  ).toHaveAttribute("href", "/match/busy");
});
it("retains the last schedule and reports a refresh failure", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ players, fixtures: [fixture("bergen", "a", "b")] }),
    })
    .mockRejectedValue(new Error("offline"));
  vi.stubGlobal("fetch", fetch);
  render(<ProfileFixtures playerId="a" />);
  await screen.findByText("1 remaining · 0 finished");
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(screen.getByRole("status")).toHaveTextContent("could not refresh");
  expect(screen.getByText("1 remaining · 0 finished")).toBeInTheDocument();
});
