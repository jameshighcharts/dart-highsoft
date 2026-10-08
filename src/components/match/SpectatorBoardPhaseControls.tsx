'use client';

import { RotateCcw } from 'lucide-react';
import { SpectatorControlButton } from '@/components/match/SpectatorHoverControls';
import { useScoliaPhaseReset } from '@/components/match/ScoliaPhaseRecovery';

type Props = {
  matchId: string;
  /** Latest known board phase; undefined while it has not loaded. */
  phase: string | null | undefined;
  onPhase: (phase: string) => void;
  disabled?: boolean;
};

/** Shows the Scolia board's phase in the spectator toolbar and offers a reset when it is not Throw. */
export function SpectatorBoardPhaseControls({ matchId, phase, onPhase, disabled = false }: Props) {
  const { busy, accepted, error, reset } = useScoliaPhaseReset(matchId, onPhase, { manual: true });
  const throwing = phase === 'Throw';
  const dot = throwing ? 'bg-emerald-400' : phase ? 'bg-amber-400' : 'bg-slate-500';
  return (
    <>
      <span
        role="status"
        aria-label={`Board phase: ${phase ?? 'unknown'}`}
        className="inline-flex h-16 items-center gap-3 rounded-full bg-white/[0.06] px-6 text-lg font-semibold tracking-tight text-slate-100 lg:h-20 lg:gap-4 lg:px-8 lg:text-2xl 2xl:h-24 2xl:text-3xl"
      >
        <span aria-hidden="true" className={`size-3 shrink-0 rounded-full lg:size-4 ${dot}`} />
        <span aria-hidden="true" className="text-slate-400">Phase</span>
        <span aria-hidden="true">{phase ?? 'Unknown'}</span>
      </span>
      {phase !== undefined && (!throwing || busy) && (
        <SpectatorControlButton
          icon={RotateCcw}
          label="Reset phase"
          busyLabel={accepted ? 'Checking board…' : 'Resetting…'}
          ariaLabel="Reset board phase"
          tone="amber"
          onClick={() => void reset()}
          disabled={disabled}
          busy={busy}
        />
      )}
      {error && (
        <span role="alert" className="max-w-md px-2 text-base font-semibold text-red-300 lg:text-lg">{error}</span>
      )}
    </>
  );
}
