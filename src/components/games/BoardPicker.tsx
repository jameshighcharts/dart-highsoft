"use client";

import { PencilLine, Wifi } from "lucide-react";
import type { ScoliaBoardOption } from "@/lib/scolia/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

function StatusDot({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-2 shrink-0 rounded-full ${DOT_CLASS[tone]}`}
    />
  );
}

type BoardItem = {
  value: string;
  label: string;
  tone: Tone;
  status: string;
  disabled: boolean;
  icon: "board" | "manual";
};

/** Flattens slots, extra boards and Manual into dropdown items. */
export function buildBoardItems(boards: ScoliaBoardOption[], loading: boolean): BoardItem[] {
  const claimed = new Set<string>();
  const items: BoardItem[] = [];
  for (const slot of BOARD_SLOTS) {
    const board = boards.find(
      (b) => !claimed.has(b.id) && b.name.toLowerCase().includes(slot.keyword),
    );
    if (board) {
      claimed.add(board.id);
      const status = describeBoardStatus(board);
      items.push({
        value: board.id,
        label: slot.label,
        tone: status.tone,
        status: status.text,
        disabled: !board.selectable,
        icon: "board",
      });
    } else {
      items.push({
        value: `slot:${slot.key}`,
        label: slot.label,
        tone: "none",
        status: loading ? "Checking…" : "Not set up yet",
        disabled: true,
        icon: "board",
      });
    }
  }
  for (const board of boards) {
    if (claimed.has(board.id)) continue;
    const status = describeBoardStatus(board);
    items.push({
      value: board.id,
      label: board.name,
      tone: status.tone,
      status: status.text,
      disabled: !board.selectable,
      icon: "board",
    });
  }
  items.push({
    value: MANUAL_BOARD_VALUE,
    label: "Manual",
    tone: "none",
    status: "Enter scores by hand",
    disabled: false,
    icon: "manual",
  });
  return items;
}

/** Dropdown for choosing a Scolia board (or manual scoring). */
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
  const items = buildBoardItems(boards, loading);
  const current = items.find((item) => item.value === value) ?? items[items.length - 1];

  return (
    <Select value={current.value} onValueChange={onChange}>
      <SelectTrigger className="h-12 w-full" aria-label="Board">
        <SelectValue>
          <span className="flex items-center gap-2">
            {current.icon === "manual" ? (
              <PencilLine className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <Wifi className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="font-medium">{current.label}</span>
            {current.icon === "board" && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <StatusDot tone={current.tone} />
                {current.status}
              </span>
            )}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value} disabled={item.disabled} className="py-2.5">
            <span className="flex items-center gap-2">
              {item.icon === "manual" ? (
                <PencilLine className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <Wifi className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="font-medium">{item.label}</span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {item.icon === "board" && <StatusDot tone={item.tone} />}
                {item.status}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
