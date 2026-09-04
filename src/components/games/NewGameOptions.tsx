"use client";

import { useState, type ComponentType } from "react";
import { Info } from "lucide-react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GAME_MODE_INFO, GAME_MODE_ORDER, type ConfigField } from "@/lib/games/labels";
import { isGameMode, type GameMode } from "@/lib/games/types";

export type GameType = "x01" | GameMode;

export const GAME_TYPE_STORAGE_KEY = "new-match-game-type";

export function isGameType(value: unknown): value is GameType {
  return value === "x01" || isGameMode(value);
}

export function loadStoredGameType(): GameType {
  if (typeof window === "undefined") return "x01";
  try {
    const stored = localStorage.getItem(GAME_TYPE_STORAGE_KEY);
    if (isGameType(stored)) return stored;
  } catch {
    /* ignore */
  }
  return "x01";
}

export function storeGameType(type: GameType) {
  try {
    localStorage.setItem(GAME_TYPE_STORAGE_KEY, type);
  } catch {
    /* ignore */
  }
}

export function gameTypeName(type: GameType): string {
  return type === "x01" ? "X01" : GAME_MODE_INFO[type].name;
}

const X01_DESCRIPTION =
  "Everyone starts on the same score and takes turns throwing three darts. Subtract what you hit and be the first to reach exactly zero. Going below zero, or landing on 1 with double out, is a bust and the turn does not count.";

export function gameTypeDescription(type: GameType): string {
  return type === "x01" ? X01_DESCRIPTION : GAME_MODE_INFO[type].description;
}

/** Fresh config for a mode, cloned from the schema defaults. */
export function defaultConfigFor(mode: GameMode): Record<string, unknown> {
  const defaults = GAME_MODE_INFO[mode].defaults;
  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(defaults)) {
    config[key] =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? { ...(value as Record<string, unknown>) }
        : value;
  }
  return config;
}

// ---- Game type picker -------------------------------------------------------

type GameTypeCard = {
  type: GameType;
  name: string;
  tagline: string;
  icon: ComponentType<{ className?: string }>;
};

/** Rendered 3D artwork for each game, keyed from the icon sheet in public/game-icons. */
function makeGameArtIcon(type: GameType): ComponentType<{ className?: string }> {
  const src = `/game-icons/${type}.png`;
  function GameArtIcon({ className }: { className?: string }) {
    return (
      <Image
        src={src}
        alt=""
        width={192}
        height={192}
        className={`object-contain ${className ?? ""}`}
      />
    );
  }
  GameArtIcon.displayName = `GameArtIcon(${type})`;
  return GameArtIcon;
}

const GAME_ART_ICONS: Record<GameType, ComponentType<{ className?: string }>> = {
  x01: makeGameArtIcon("x01"),
  cricket: makeGameArtIcon("cricket"),
  killer: makeGameArtIcon("killer"),
  shanghai: makeGameArtIcon("shanghai"),
  around_the_clock: makeGameArtIcon("around_the_clock"),
};

/** Display names on the picker cards where they differ from the game's formal name. */
const CARD_NAMES: Partial<Record<GameType, string>> = {
  around_the_clock: "Around 🌍",
};

/** Name shown on the picker and selected-game cards. */
export function gameCardName(type: GameType): string {
  return CARD_NAMES[type] ?? gameTypeName(type);
}

/** Short one-liners shown under each game name. */
const CARD_TAGLINES: Record<GameType, string> = {
  x01: "Count down from 501, 301 or 201.",
  cricket: "Close 15 to 20 and Bull.",
  killer: "Last one standing wins.",
  shanghai: "One target per round.",
  around_the_clock: "Race 1 to 20, finish on Bull.",
};

const GAME_TYPE_CARDS: GameTypeCard[] = [
  { type: "x01", name: "X01", tagline: CARD_TAGLINES.x01, icon: GAME_ART_ICONS.x01 },
  ...GAME_MODE_ORDER.map((mode) => ({
    type: mode,
    name: CARD_NAMES[mode] ?? GAME_MODE_INFO[mode].name,
    tagline: CARD_TAGLINES[mode],
    icon: GAME_ART_ICONS[mode],
  })),
];

/** Modal explaining how a game is played. */
export function HowToPlayDialog({
  type,
  open,
  onOpenChange,
}: {
  type: GameType | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const Icon = type ? GAME_ART_ICONS[type] : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] rounded-2xl p-0 sm:max-w-md">
        {type && Icon && (
          <>
            <div className="flex flex-col items-center gap-2 px-6 pt-8">
              <Icon className="size-28" />
              <DialogHeader className="items-center text-center">
                <DialogTitle className="text-xl">{gameCardName(type)}</DialogTitle>
                <DialogDescription className="text-sm">{CARD_TAGLINES[type]}</DialogDescription>
              </DialogHeader>
            </div>
            <div className="px-6 pb-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                How to play
              </div>
              <p className="mt-1 text-sm leading-relaxed">{gameTypeDescription(type)}</p>
            </div>
            <div className="px-6 pb-6">
              <Button type="button" className="w-full" onClick={() => onOpenChange(false)}>
                Got it
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Stacked full-width rows: artwork on the left, name and tagline, plus a "How to play" popup. */
export function GameTypePicker({
  value,
  onChange,
}: {
  value: GameType;
  onChange: (type: GameType) => void;
}) {
  const [infoType, setInfoType] = useState<GameType | null>(null);
  return (
    <>
      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Game type">
        {GAME_TYPE_CARDS.map((card) => {
          const Icon = card.icon;
          const selected = card.type === value;
          return (
            <div
              key={card.type}
              className={`flex items-center gap-3 rounded-xl border p-2 pr-3 transition-colors ${
                selected
                  ? "border-accent bg-accent/30"
                  : "border-border hover:border-accent/60 hover:bg-accent/15"
              }`}
            >
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange(card.type)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex size-16 shrink-0 items-center justify-center">
                  <Icon className="size-16" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-bold leading-tight">{card.name}</span>
                  <span className="block text-xs leading-snug text-muted-foreground">{card.tagline}</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setInfoType(card.type)}
                aria-label={`How to play ${card.name}`}
                className="flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Info className="size-3.5" />
                <span className="hidden sm:inline">How to play</span>
              </button>
            </div>
          );
        })}
      </div>
      <HowToPlayDialog
        type={infoType}
        open={infoType !== null}
        onOpenChange={(open) => {
          if (!open) setInfoType(null);
        }}
      />
    </>
  );
}

// ---- Per-mode config controls ----------------------------------------------

export type GamePlayerOption = { id: string; name: string };

/** Converts a select string back to the type of the schema default (e.g. Shanghai rounds "7" → 7). */
function coerceSelectValue(mode: GameMode, key: string, value: string): unknown {
  const defaultValue = GAME_MODE_INFO[mode].defaults[key];
  if (typeof defaultValue === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}

function StepperField({
  field,
  value,
  onChange,
}: {
  field: Extract<ConfigField, { kind: "stepper" }>;
  value: unknown;
  onChange: (value: number | null) => void;
}) {
  const step = field.step ?? 1;
  const numeric = typeof value === "number" ? value : null;
  const isNull = numeric === null;
  const clamp = (n: number) => Math.min(field.max, Math.max(field.min, n));

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="font-medium">{field.label}</div>
        {field.nullable && (
          <Button
            type="button"
            size="sm"
            variant={isNull ? "default" : "outline"}
            className="h-7 px-2 text-xs"
            aria-pressed={isNull}
            onClick={() => onChange(isNull ? field.min : null)}
          >
            {field.nullLabel ?? "Unlimited"}
          </Button>
        )}
      </div>
      <div className="flex items-stretch gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={isNull || numeric <= field.min}
          onClick={() => onChange(clamp((numeric ?? field.min) - step))}
          aria-label={`Decrease ${field.label}`}
        >
          −
        </Button>
        <Input
          readOnly
          className="text-center select-none"
          value={isNull ? field.nullLabel ?? "Unlimited" : String(numeric)}
          aria-label={field.label}
        />
        <Button
          type="button"
          variant="outline"
          disabled={isNull || numeric >= field.max}
          onClick={() => onChange(clamp((numeric ?? field.min) + step))}
          aria-label={`Increase ${field.label}`}
        >
          +
        </Button>
      </div>
      {field.help && <p className="mt-1 text-xs text-muted-foreground">{field.help}</p>}
    </div>
  );
}

const KILLER_NUMBERS = Array.from({ length: 20 }, (_, i) => i + 1);

function KillerNumberAssignment({
  players,
  assigned,
  onChange,
}: {
  players: GamePlayerOption[];
  assigned: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
}) {
  const taken = new Map<number, string>();
  for (const [playerId, num] of Object.entries(assigned)) taken.set(num, playerId);
  const missing = players.filter((p) => typeof assigned[p.id] !== "number");

  return (
    <div className="col-span-2 space-y-3">
      <div>
        <div className="font-medium">Pick a number for each player</div>
        <p className="text-xs text-muted-foreground">Numbers must be unique.</p>
      </div>
      {players.length === 0 ? (
        <p className="text-sm text-muted-foreground">Select players above to assign numbers.</p>
      ) : (
        players.map((player) => {
          const own = assigned[player.id];
          return (
            <div key={player.id} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{player.name}</span>
                <span className="text-muted-foreground">
                  {typeof own === "number" ? `Number ${own}` : "No number yet"}
                </span>
              </div>
              <div className="grid grid-cols-10 gap-1" role="group" aria-label={`Number for ${player.name}`}>
                {KILLER_NUMBERS.map((num) => {
                  const owner = taken.get(num);
                  const isOwn = owner === player.id;
                  const disabled = owner !== undefined && !isOwn;
                  return (
                    <button
                      key={num}
                      type="button"
                      disabled={disabled}
                      aria-pressed={isOwn}
                      onClick={() => {
                        const next = { ...assigned };
                        if (isOwn) delete next[player.id];
                        else next[player.id] = num;
                        onChange(next);
                      }}
                      className={`h-8 rounded border text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        isOwn ? "border-accent bg-accent/30" : "hover:bg-accent/20"
                      }`}
                    >
                      {num}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
      {missing.length > 0 && players.length > 0 && (
        <p className="text-xs text-amber-500">
          {missing.length === 1
            ? `${missing[0].name} still needs a number.`
            : `${missing.length} players still need a number.`}
        </p>
      )}
    </div>
  );
}

export function GameConfigFields({
  mode,
  config,
  onChange,
  players,
}: {
  mode: GameMode;
  config: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Currently selected players, used for Killer's "players choose" assignment. */
  players: GamePlayerOption[];
}) {
  const info = GAME_MODE_INFO[mode];
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  const showKillerAssignment = mode === "killer" && config.assignment === "choose";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {info.fields.map((field) => {
          if (field.kind === "select") {
            const raw = config[field.key];
            const value = raw === undefined || raw === null ? "" : String(raw);
            return (
              <div key={field.key}>
                <div className="font-medium mb-1">{field.label}</div>
                <Select value={value} onValueChange={(v) => set(field.key, coerceSelectValue(mode, field.key, v))}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={field.label} />
                  </SelectTrigger>
                  <SelectContent>
                    {field.options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {field.help && <p className="mt-1 text-xs text-muted-foreground">{field.help}</p>}
              </div>
            );
          }
          if (field.kind === "stepper") {
            return (
              <StepperField
                key={field.key}
                field={field}
                value={config[field.key]}
                onChange={(v) => set(field.key, v)}
              />
            );
          }
          const id = `game-field-${mode}-${field.key}`;
          return (
            <div key={field.key} className="col-span-2 flex items-center justify-between gap-4 rounded border p-3">
              <label htmlFor={id} className="text-sm font-medium">
                {field.label}
                {field.help && <span className="block text-xs font-normal text-muted-foreground">{field.help}</span>}
              </label>
              <Switch id={id} checked={config[field.key] === true} onCheckedChange={(checked) => set(field.key, checked)} />
            </div>
          );
        })}
        {showKillerAssignment && (
          <KillerNumberAssignment
            players={players}
            assigned={(config.assignedNumbers as Record<string, number> | undefined) ?? {}}
            onChange={(next) => set("assignedNumbers", next)}
          />
        )}
      </div>
    </div>
  );
}

/** Returns the validation problem for the current selection, or null when the game can start. */
export function validateGameSelection(
  mode: GameMode,
  config: Record<string, unknown>,
  playerIds: string[],
): string | null {
  const info = GAME_MODE_INFO[mode];
  if (playerIds.length < info.minPlayers) {
    return `${info.name} needs at least ${info.minPlayers} ${info.minPlayers === 1 ? "player" : "players"}.`;
  }
  if (playerIds.length > info.maxPlayers) {
    return `${info.name} supports at most ${info.maxPlayers} players.`;
  }
  if (mode === "killer" && config.assignment === "choose") {
    const assigned = (config.assignedNumbers as Record<string, number> | undefined) ?? {};
    const missing = playerIds.filter((id) => typeof assigned[id] !== "number");
    if (missing.length > 0) return "Every player needs a number before Killer can start.";
    const numbers = playerIds.map((id) => assigned[id]);
    if (new Set(numbers).size !== numbers.length) return "Killer numbers must be unique.";
  }
  return null;
}
