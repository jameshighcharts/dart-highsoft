"use client";

import { PencilLine, Wifi } from "lucide-react";
import type { ScoliaBoardOption } from "@/lib/scolia/types";
import { OptionCard } from "./OptionCard";

export const MANUAL_BOARD_VALUE = "manual";
export const BOARD_STORAGE_KEY = "new-match-board";

/** Last board the user picked, or manual when nothing is stored. */
export function loadStoredBoardId(): string {
  if (typeof window === "undefined") return MANUAL_BOARD_VALUE;
  try {
    const stored = localStorage.getItem(BOARD_STORAGE_KEY);
    if (stored && stored.trim()) return stored;
  } catch {
    /* ignore */
  }
  return MANUAL_BOARD_VALUE;
}

export function storeBoardId(boardId: string) {
  try {
    localStorage.setItem(BOARD_STORAGE_KEY, boardId);
  } catch {
    /* ignore */
  }
}

/**
 * Fixed board slots shown on the New Game page. A configured Scolia board is
 * matched to a slot when its name contains the slot keyword (case-insensitive),
 * so "Highsoft Vik office" lands on the Vik card. Slots without a configured
 * board render as "Not set up yet" so upcoming locations are visible.
 */
const BOARD_SLOTS = [
  { key: "bergen", label: "Scolia Bergen", keyword: "bergen" },
  { key: "vik", label: "Scolia Vik", keyword: "vik" },
  { key: "sogndal", label: "Scolia Sogndal", keyword: "sogndal" },
] as const;

type Tone = "ready" | "busy" | "offline" | "none";

const DOT_CLASS: Record<Tone, string> = {
  ready: "bg-emerald-500",
  busy: "bg-amber-500",
  offline: "bg-red-500",
  none: "bg-muted-foreground/50",
};

export function describeBoardStatus(board: ScoliaBoardOption): { tone: Tone; text: string } {
  if (board.activeMatchId || board.activeGameSessionId) {
    return { tone: "busy", text: "In use" };
  }
  switch (board.workerConnectionStatus) {
    case "disconnected":
      return { tone: "offline", text: "Offline" };
    case "connecting":
    case "reconnecting":
      return { tone: "busy", text: "Connecting…" };
    case "connected":
      if (board.selectable) return { tone: "ready", text: "Ready" };
      return {
        tone: "busy",
        text: `Board ${(board.boardStatus ?? "unknown").toLowerCase()}`,
      };
  }
}

function StatusLine({ tone, text }: { tone: Tone; text: string }) {
  return (
    <span className="flex items-start gap-1.5 text-xs leading-snug text-muted-foreground">
      <span
        aria-hidden
        className={`mt-1 inline-block size-2 shrink-0 rounded-full ${DOT_CLASS[tone]}`}
      />
      <span>{text}</span>
    </span>
  );
}

export function BoardPicker({
  boards,
  value,
  onChange,
  loading,
}: {
  boards: ScoliaBoardOption[];
  value: string;
  onChange: (boardId: string) => void;
  loading: boolean;
}) {
  const claimed = new Set<string>();
  const slotCards = BOARD_SLOTS.map((slot) => {
    const board = boards.find(
      (b) => !claimed.has(b.id) && b.name.toLowerCase().includes(slot.keyword),
    );
    if (board) claimed.add(board.id);
    return { slot, board };
  });
  const extraBoards = boards.filter((b) => !claimed.has(b.id));

  return (
    <div
      className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      role="group"
      aria-label="Board"
    >
      {slotCards.map(({ slot, board }) => {
        if (!board) {
          return (
            <OptionCard
              key={slot.key}
              icon={Wifi}
              title={slot.label}
              selected={false}
              disabled
              onClick={() => {}}
            >
              <StatusLine
                tone="none"
                text={loading ? "Checking…" : "Not set up yet"}
              />
            </OptionCard>
          );
        }
        return (
          <BoardCard
            key={slot.key}
            title={slot.label}
            board={board}
            selected={value === board.id}
            onChange={onChange}
          />
        );
      })}
      {extraBoards.map((board) => (
        <BoardCard
          key={board.id}
          title={board.name}
          board={board}
          selected={value === board.id}
          onChange={onChange}
        />
      ))}
      <OptionCard
        icon={PencilLine}
        title="Manual"
        selected={value === MANUAL_BOARD_VALUE}
        onClick={() => onChange(MANUAL_BOARD_VALUE)}
      >
        <span className="text-xs text-muted-foreground">Enter scores by hand</span>
      </OptionCard>
    </div>
  );
}

function BoardCard({
  title,
  board,
  selected,
  onChange,
}: {
  title: string;
  board: ScoliaBoardOption;
  selected: boolean;
  onChange: (boardId: string) => void;
}) {
  const status = describeBoardStatus(board);
  return (
    <OptionCard
      icon={Wifi}
      title={title}
      selected={selected}
      disabled={!board.selectable}
      onClick={() => onChange(board.id)}
      ariaLabel={`${title}, ${status.text}`}
    >
      <StatusLine tone={status.tone} text={status.text} />
    </OptionCard>
  );
}
