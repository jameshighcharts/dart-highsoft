'use client';

import { useCallback, useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useScoliaBoardRealtime } from '@/hooks/useScoliaBoardRealtime';
import { SCOLIA_STUCK_TAKEOUT_MS, takeoutPredatesMatch } from '@/lib/scolia/availability';

type PhaseStatus = { phase: string | null; changedAt: string | null };

/**
 * A board stuck in Takeout cannot detect throws. At the start of a match, before its
 * first dart, offer a reset once a dart removal has lasted far longer than normal.
 */
export function ScoliaTakeoutRecovery({ matchId, boardId, matchCreatedAt, matchStarted = false }: {
  matchId: string;
  boardId: string;
  matchCreatedAt?: string;
  /** Once a dart has registered the board evidently works; mid-match takeouts never prompt. */
  matchStarted?: boolean;
}) {
  const [status, setStatus] = useState<PhaseStatus>({ phase: null, changedAt: null });
  const [stuckKey, setStuckKey] = useState<string | null>(null);
  const load = useCallback(async () => {
    const db = await getSupabaseClient();
    // `*` keeps this working before the phase timestamp column is migrated.
    const result = await db.from('scolia_board_public_status').select('*').eq('board_id', boardId).maybeSingle();
    if (result.data) setStatus({ phase: result.data.board_phase, changedAt: result.data.board_phase_changed_at ?? null });
  }, [boardId]);
  useEffect(() => { void load(); }, [load]);
  useScoliaBoardRealtime({
    onUpsert: next => { if (next.boardId === boardId) setStatus({ phase: next.boardPhase, changedAt: next.boardPhaseChangedAt ?? null }); },
    onRemove: id => { if (id === boardId) setStatus({ phase: null, changedAt: null }); },
    onReconcile: () => { void load(); },
  });

  // Each takeout gets its own clock, measured from when this screen saw it start.
  const takeoutKey = status.phase === 'Takeout' ? status.changedAt ?? 'takeout' : null;
  useEffect(() => {
    if (!takeoutKey) return;
    const timer = setTimeout(() => setStuckKey(takeoutKey), SCOLIA_STUCK_TAKEOUT_MS);
    return () => clearTimeout(timer);
  }, [takeoutKey]);

  const onPhase = useCallback((phase: string) => setStatus(current => ({ ...current, phase })), []);
  // Starting a match on a board still stuck from earlier play is the common failure: say so at once.
  const leftOver = takeoutKey !== null && takeoutPredatesMatch(status.changedAt, matchCreatedAt);
  if (matchStarted) return null;
  return takeoutKey && (leftOver || stuckKey === takeoutKey) ? <ScoliaPhaseRecovery matchId={matchId} onPhase={onPhase} /> : null;
}

/** Requests a board phase reset and polls until the board is back in Throw. */
export function useScoliaPhaseReset(matchId: string, onPhase: (phase: string) => void, { manual = false } = {}) {
  const [busy, setBusy] = useState(false);
  const [commandId, setCommandId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const endpoint = `/api/matches/${matchId}/scolia/reset-phase`;

  useEffect(() => {
    if (!commandId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + 45_000;
    async function poll() {
      try {
        const response = await fetch(`${endpoint}?commandId=${commandId}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        const body = await response.json();
        if (!response.ok || body.status === 'failed' || body.status === 'refused') throw new Error(body.error || 'The board refused the reset.');
        if (body.phase === 'Throw') { setBusy(false); setCommandId(null); onPhase('Throw'); return; }
        setAccepted(body.status === 'acknowledged');
        if (Date.now() >= deadline) throw new Error('The board has not returned to throwing mode. Check the board connection and try again.');
        timer = setTimeout(() => void poll(), 1000);
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(failure instanceof Error ? failure.message : 'Could not reset the board.');
        setBusy(false); setCommandId(null);
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [commandId, endpoint, onPhase]);

  const reset = useCallback(async () => {
    if (busy) return;
    setBusy(true); setError(''); setAccepted(false);
    try {
      const response = await fetch(endpoint, { method: 'POST', signal: AbortSignal.timeout(10_000),
        ...(manual ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manual: true }) } : {}) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not request a reset.');
      setCommandId(body.commandId);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not request a reset.');
      setBusy(false);
    }
  }, [busy, endpoint, manual]);

  return { busy, accepted, error, reset };
}

export function ScoliaPhaseRecovery({ matchId, onPhase }: { matchId: string; onPhase: (phase: string) => void }) {
  const { busy, accepted, error, reset } = useScoliaPhaseReset(matchId, onPhase);

  return <Dialog open>
    <DialogContent onEscapeKeyDown={event => event.preventDefault()} onPointerDownOutside={event => event.preventDefault()}
      className="z-[80] w-[calc(100%-3rem)] max-w-4xl space-y-8 rounded-3xl border-2 border-amber-400/70 bg-slate-900 p-8 text-center shadow-2xl sm:max-w-4xl md:p-14 [&>button]:hidden">
      <DialogTitle className="text-4xl font-black text-amber-300 md:text-6xl">Remove any darts<br />from the board</DialogTitle>
      <DialogDescription className="text-xl text-slate-200 md:text-3xl">The board is stuck in dart-removal mode and can&apos;t see throws.<br />If it is already empty, reset detection.</DialogDescription>
      <div>
      <Button onClick={() => void reset()} disabled={busy} className="h-auto min-h-20 w-full whitespace-normal rounded-2xl bg-amber-300 px-8 py-6 text-2xl font-black text-slate-950 hover:bg-amber-200 md:text-3xl">
        <RotateCcw className={`mr-3 size-8 shrink-0 ${busy ? 'animate-spin motion-reduce:animate-none' : ''}`} />
        {busy ? accepted ? 'Reset accepted — checking board…' : 'Resetting board…' : 'Board is empty — reset'}
      </Button>
      </div>
      {error && <p role="alert" className="text-xl font-semibold text-red-300">{error}</p>}
    </DialogContent>
  </Dialog>;
}
