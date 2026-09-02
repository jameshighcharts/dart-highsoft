"use client";

import type { ComponentType } from "react";
import { Clock, Grid3x3, Skull, Sparkles, Target } from "lucide-react";
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
import { GAME_MODE_INFO, GAME_MODE_ORDER, type ConfigField } from "@/lib/games/labels";
import { isGameMode, type GameMode } from "@/lib/games/types";

/** X01 (the classic match flow) plus the event-sourced party game modes. */
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

const MODE_ICONS: Record<GameMode, ComponentType<{ className?: string }>> = {
  cricket: Grid3x3,
  killer: Skull,
  shanghai: Sparkles,
  around_the_clock: Clock,
};

const GAME_TYPE_CARDS: GameTypeCard[] = [
  {
    type: "x01",
    name: "X01",
    tagline: "Count down from 501, 301 or 201 and check out.",
    icon: Target,
  },
  ...GAME_MODE_ORDER.map((mode) => ({
    type: mode,
    name: GAME_MODE_INFO[mode].name,
    tagline: GAME_MODE_INFO[mode].tagline,
    icon: MODE_ICONS[mode],
  })),
];

export function GameTypePicker({
  value,
  onChange,
}: {
  value: GameType;
  onChange: (type: GameType) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" role="group" aria-label="Game type">
      {GAME_TYPE_CARDS.map((card) => {
        const Icon = card.icon;
        const selected = card.type === value;
        return (
          <button
            key={card.type}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(card.type)}
            className={`flex flex-col items-start gap-1 rounded border p-3 text-left transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              selected ? "border-accent bg-accent/30" : ""
            }`}
          >
            <Icon className="size-5" />
            <span className="font-medium leading-tight">{card.name}</span>
            <span className="text-xs text-muted-foreground leading-snug">{card.tagline}</span>
          </button>
        );
      })}
    </div>
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
      <p className="text-sm text-muted-foreground">{info.description}</p>
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
