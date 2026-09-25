import { describe, expect, it } from "vitest";
import { boardForLocation, boardValueForLocation, buildBoardItems } from "./BoardPicker";
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
    expect(boardValueForLocation(boards, "bergen")).toBe("bergen");
  });

  it("does not default to a board at another location", () => {
    expect(boardForLocation(boards, "sogndal")).toBeUndefined();
    expect(boardValueForLocation(boards, "sogndal")).toBe("slot:sogndal");
  });

  it("keeps an offline board available in the dropdown with its status", () => {
    expect(buildBoardItems(boards, false)).toContainEqual(expect.objectContaining({
      value: "bergen", status: "Offline", disabled: false,
    }));
    expect(buildBoardItems([{ ...board("office", "Scolia Bergen", false), workerConnectionStatus: "connected", boardStatus: "Offline" }], false))
      .toContainEqual(expect.objectContaining({ value: "office", status: "Offline", disabled: false }));
  });
});
