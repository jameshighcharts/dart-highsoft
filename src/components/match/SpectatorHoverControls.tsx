'use client';

import { ArrowLeft, Loader2, Undo2, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export const SPECTATOR_CONTROLS_IDLE_MS = 2500;

type Props = {
  onExit: () => void;
  /** Extra actions rendered next to the exit button. */
  children?: ReactNode;
};

/**
 * Controls that stay out of the way on a TV: revealed by pointer activity or
 * keyboard focus, hidden again after a short idle period.
 */
export function SpectatorHoverControls({ onExit, children }: Props) {
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Hovered or focused controls stay visible until the pointer/focus leaves.
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const reveal = useCallback(() => {
    setVisible(true);
    clearHideTimer();
    if (hoveredRef.current || focusedRef.current) return;
    hideTimerRef.current = setTimeout(() => setVisible(false), SPECTATOR_CONTROLS_IDLE_MS);
  }, [clearHideTimer]);

  const setHovered = useCallback((hovered: boolean) => {
    hoveredRef.current = hovered;
    reveal();
  }, [reveal]);

  const setFocused = useCallback((focused: boolean) => {
    focusedRef.current = focused;
    reveal();
  }, [reveal]);

  useEffect(() => {
    window.addEventListener('pointermove', reveal);
    window.addEventListener('pointerdown', reveal);
    return () => {
      window.removeEventListener('pointermove', reveal);
      window.removeEventListener('pointerdown', reveal);
      clearHideTimer();
    };
  }, [reveal, clearHideTimer]);

  return (
    <div
      data-testid="spectator-hover-controls"
      data-visible={visible}
      className={`pointer-events-none fixed inset-x-0 top-0 z-50 transition-opacity duration-300 ease-out motion-reduce:transition-none ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      {/* Soft scrim so the controls stay legible over busy scoreboards. */}
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-background/90 via-background/50 to-transparent lg:h-56" />
      <div
        role="toolbar"
        aria-label="Spectator controls"
        className={`relative m-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-900/70 p-2 shadow-2xl shadow-black/50 ring-1 ring-inset ring-white/5 backdrop-blur-xl transition-transform duration-300 ease-out motion-reduce:transition-none md:m-6 lg:m-8 lg:gap-3 lg:p-2.5 ${visible ? 'pointer-events-auto translate-y-0' : '-translate-y-4'}`}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={(event) => {
          // Mouse clicks also focus buttons; only keyboard focus should pin the controls.
          if (event.target.matches(':focus-visible')) setFocused(true);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
        }}
      >
        <SpectatorControlButton icon={ArrowLeft} label="Exit spectator" ariaLabel="Exit spectator mode" onClick={onExit} />
        {children}
      </div>
    </div>
  );
}

const TONES = {
  cyan: {
    button: 'hover:bg-cyan-400/15 hover:text-cyan-100 focus-visible:ring-cyan-400/60 active:bg-cyan-400/25',
    icon: 'bg-cyan-400/15 text-cyan-300',
    iconHover: 'group-hover:bg-cyan-400 group-hover:text-slate-950',
  },
  amber: {
    button: 'hover:bg-amber-400/15 hover:text-amber-100 focus-visible:ring-amber-400/60 active:bg-amber-400/25',
    icon: 'bg-amber-400/15 text-amber-300',
    iconHover: 'group-hover:bg-amber-400 group-hover:text-slate-950',
  },
} as const;

type ControlButtonProps = {
  icon: LucideIcon;
  label: string;
  busyLabel?: string;
  /** Screen-reader name when it should say more than the visible label. */
  ariaLabel?: string;
  onClick: () => void;
  tone?: keyof typeof TONES;
  disabled?: boolean;
  busy?: boolean;
};

/** A TV-sized pill button for the spectator controls toolbar. */
export function SpectatorControlButton({ icon: Icon, label, busyLabel, ariaLabel, onClick, tone = 'cyan', disabled = false, busy = false }: ControlButtonProps) {
  const colors = TONES[tone];
  const interactive = !disabled && !busy;
  const ShownIcon = busy ? Loader2 : Icon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-label={ariaLabel ?? label}
      aria-busy={busy || undefined}
      className={`group inline-flex h-16 items-center gap-3 rounded-full bg-white/[0.06] pl-3 pr-6 text-lg font-semibold tracking-tight text-slate-100 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed lg:h-20 lg:gap-4 lg:pl-4 lg:pr-8 lg:text-2xl 2xl:h-24 2xl:text-3xl ${interactive ? colors.button : ''} ${disabled ? 'opacity-40' : ''}`}
    >
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-full transition-all duration-200 group-active:scale-95 lg:size-14 2xl:size-16 ${colors.icon} ${interactive ? colors.iconHover : ''}`}>
        <ShownIcon
          className={`size-6 transition-transform duration-200 motion-reduce:transition-none lg:size-8 2xl:size-9 ${busy ? 'animate-spin motion-reduce:animate-none' : interactive ? 'group-hover:-translate-x-0.5' : ''}`}
          strokeWidth={2.5}
          aria-hidden="true"
        />
      </span>
      <span aria-hidden="true">{busy && busyLabel ? busyLabel : label}</span>
    </button>
  );
}

/** Undo the latest dart; ignores repeat presses while the previous undo is still running. */
export function SpectatorUndoDartButton({ onUndo, disabled = false }: { onUndo: () => Promise<void>; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const undo = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await onUndo();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [onUndo]);
  return <SpectatorControlButton icon={Undo2} label="Undo dart" busyLabel="Undoing…" tone="amber" onClick={() => void undo()} disabled={disabled} busy={busy} />;
}
