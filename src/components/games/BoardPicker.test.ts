import { describe, expect, it } from "vitest";
import { boardForLocation } from "./BoardPicker";
import type { ScoliaBoardOption } from "@/lib/scolia/types";

const board = (id: string, name: string, selectable: boolean): ScoliaBoardOption => ({
  id,
  name,
  isHomeSbc: false,
  workerConnectionStatus: selectable ? "connected" : "disconnected",
  boardStatus: selectable ? "READY" : null,
  workerHeartbeatAt: null,
  activeMatchId: null,
  activeGameSessionId: null,
  selectable,
});

describe("boardForLocation", () => {
  const boards = [
    board("bergen", "Highsoft Bergen office", false),
    board("vik", "Highsoft Vik office", true),
  ];

  it("finds the creator's board even when it is offline", () => {
    expect(boardForLocation(boards, "bergen")?.id).toBe("bergen");
  });

  it("does not default to a board at another location", () => {
    expect(boardForLocation(boards, "sogndal")).toBeUndefined();
  });
});
