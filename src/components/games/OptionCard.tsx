"use client";

import type { ComponentType, ReactNode } from "react";

/**
 * Selectable card used by the New Game pickers (game type, board).
 * Keeps the two pickers visually consistent: icon + title on one row,
 * a muted description below, and the same selected/disabled treatment.
 */
export function OptionCard({
  selected,
  disabled = false,
  onClick,
  icon: Icon,
  title,
  children,
  ariaLabel,
  align = "start",
  iconSize = "sm",
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  icon: ComponentType<{ className?: string }>;
  title: string;
  children?: ReactNode;
  ariaLabel?: string;
  /** "center" stacks icon, title and description centred (used for artwork cards). */
  align?: "start" | "center";
  /** "lg" gives artwork room; "sm" suits line icons. */
  iconSize?: "sm" | "lg";
}) {
  const centered = align === "center";
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-full min-h-[6rem] w-full flex-col gap-1 rounded-lg border p-3 transition-colors ${
        centered ? "items-center text-center" : "text-left"
      } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        selected
          ? "border-accent bg-accent/30"
          : "border-border hover:border-accent/60 hover:bg-accent/15"
      } ${disabled ? "cursor-not-allowed opacity-50 hover:border-border hover:bg-transparent" : ""}`}
    >
      <span className={`flex items-center justify-center ${iconSize === "lg" ? "h-24 w-24" : "h-8"}`}>
        <Icon className={`shrink-0 ${iconSize === "lg" ? "size-24" : "size-8 [&>svg]:size-5"}`} />
      </span>
      <span className="text-sm font-bold leading-tight">{title}</span>
      {children}
    </button>
  );
}
