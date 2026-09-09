'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CommentaryQuickToggle } from './CommentaryQuickToggle';
import { formatBullDistance, liveBullOffOrder, type BullOffState } from '@/lib/match/bullOff';
import type { Player } from '@/lib/match/types';
import type { RealtimeCommentaryStatus } from '@/services/realtimeCommentaryService';

export function BullOffRound({ matchId, state, players, spectator, hardware, reload, commentaryEnabled, commentaryStatus, toggleCommentary, commentary, toggleSpectator }: {
  matchId: string; state: BullOffState; players: Player[]; spectator: boolean; hardware: boolean;
  reload: () => Promise<void>; commentaryEnabled: boolean; commentaryStatus: RealtimeCommentaryStatus;
  toggleCommentary: () => void; commentary: string; toggleSpectator?: () => void;
}) {
  const [distance, setDistance] = useState('');
  const [unit, setUnit] = useState<'in' | 'mm'>('in');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rankedIds = liveBullOffOrder(state);
  const latestByPlayer = new Map(state.shots.map(shot => [shot.playerId, shot]));
  const cardNodes = useRef(new Map<string, HTMLElement>());
  const positions = useRef(new Map<string, { left: number; top: number }>());
  useLayoutEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, { left: number; top: number }>();
    for (const [id, node] of cardNodes.current) {
      const rect = node.getBoundingClientRect();
      const previous = positions.current.get(id);
      next.set(id, { left: rect.left, top: rect.top });
      if (previous && !reduceMotion && typeof node.animate === 'function') {
        const x = previous.left - rect.left; const y = previous.top - rect.top;
        if (x || y) node.animate([{ transform: `translate(${x}px, ${y}px) scale(.96)` }, { transform: 'translate(0, 0) scale(1.035)', offset: .78 }, { transform: 'translate(0, 0) scale(1)' }], { duration: 650, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    }
    positions.current = next;
  }, [state.revision]);
  const maxDistance = Math.max(170, ...state.shots.map(shot => shot.distanceMm ?? 0));
  const current = players.find(player => player.id === state.pending[0]);
  async function submit(action: 'throw' | 'takeout', miss = false) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await fetch(`/api/matches/${matchId}/bull-off`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, revision: state.revision, playerId: current?.id, distanceMm: miss ? null : Number(distance) * (unit === 'in' ? 25.4 : 1) }) });
      const body = await result.json();
      if (!result.ok) throw new Error(body.error ?? 'Could not save distance');
      setDistance(''); await reload();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save distance'); }
    finally { setBusy(false); }
  }
  return <div className={spectator ? 'fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-background' : undefined}><section className={`mx-auto w-full shrink-0 space-y-6 p-4 md:p-8 ${spectator ? 'my-auto max-w-[2000px] xl:px-10 2xl:px-14' : 'max-w-7xl'}`}>
    <header className="relative isolate flex items-center justify-center px-14 py-3 md:py-5">
      <span aria-hidden="true" className="pointer-events-none absolute inset-x-1/4 top-1/2 -z-10 h-20 -translate-y-1/2 rounded-full bg-gradient-to-r from-cyan-400/15 to-lime-400/15 blur-3xl" />
      <div className="text-center">
        <h1 className="bg-gradient-to-r from-cyan-300 via-white to-lime-300 bg-clip-text text-4xl font-black uppercase leading-none tracking-[-0.06em] text-transparent sm:text-6xl lg:text-8xl">Bull-off</h1>
        <div aria-hidden="true" className="mx-auto mt-4 h-1 w-20 rounded-full bg-gradient-to-r from-cyan-400 to-lime-400 shadow-[0_0_18px_#22d3ee66]" />
        {state.round > 1 && <p className="mt-3 text-xs font-bold uppercase tracking-[.25em] text-cyan-300">Tie rethrow</p>}
        {!spectator && <p className="mt-3 text-sm text-slate-400">One dart each. Closest starts. Tied positions rethrow.</p>}
      </div>
      <div className="absolute right-0 top-1/2 -translate-y-1/2"><CommentaryQuickToggle enabled={commentaryEnabled} status={commentaryStatus} onToggle={toggleCommentary} /></div>
    </header>
    <div role="status" className="sr-only">
      {state.phase === 'complete' ? 'Bull-off complete — player order locked' : state.awaitingTakeout ? `${current?.display_name ?? 'Player'} — remove your dart` : `${current?.display_name ?? 'Player'} — one dart at the bull`}
      
    </div>
    <div className="grid items-stretch gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
      {rankedIds.map((id, rank) => {
        const player = players.find(candidate => candidate.id === id);
        if (!player) return null;
        const shot = latestByPlayer.get(id);
        const awaitingRethrow = state.round > 1 && state.round > (shot?.round ?? 0) && state.pending.includes(id);
        const measured = Boolean(shot) && !awaitingRethrow;
        const leader = rank === 0 && measured;
        const onThrow = id === current?.id && state.phase !== 'complete';
        return <article ref={node => { if (node) cardNodes.current.set(id, node); else cardNodes.current.delete(id); }} key={id}
          aria-label={`${player.display_name}: ${measured ? `provisional position ${rank + 1}` : awaitingRethrow ? 'pending rethrow' : 'pending'}`}
          aria-current={onThrow ? 'step' : undefined}
          className={`relative overflow-hidden rounded-2xl border transition-colors duration-500 ${onThrow ? 'bull-current border-cyan-300 bg-cyan-400/15 ring-2 ring-cyan-300/70' : measured ? leader ? 'border-lime-400/70 bg-lime-400/10 shadow-lg shadow-lime-400/10' : 'border-cyan-400/40 bg-slate-900' : 'border-dashed border-white/15 bg-slate-950/60'}`}>
          <div key={`${id}-${shot?.round ?? 0}`} className={`relative flex flex-col items-center justify-center px-3 pb-4 pt-12 sm:px-5 ${spectator ? 'min-h-56 md:min-h-[clamp(16rem,27vh,24rem)]' : 'min-h-56 sm:min-h-64'} ${shot ? 'bull-landed' : ''}`}>
            {shot && <span aria-hidden="true" className="bull-flash pointer-events-none absolute inset-0 bg-gradient-to-br from-cyan-300/35 via-lime-300/15 to-transparent" />}
            <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-xs font-bold ${measured ? leader ? 'bg-lime-400 text-slate-950' : 'bg-cyan-400/15 text-cyan-200' : 'bg-white/5 text-slate-500'}`}>{measured ? `#${rank + 1}${leader ? ' · closest' : ' · landed'}` : awaitingRethrow ? '↻ Rethrow' : 'Pending'}</span>
            <PlayerAvatar player={player} size="xl" className={`${spectator ? 'md:h-24 md:w-24 2xl:h-32 2xl:w-32' : ''} ${measured || onThrow ? '' : 'opacity-45 grayscale'}`} />
            <h2 className={`mt-3 text-xl font-bold ${spectator ? 'md:text-2xl' : ''} ${measured || onThrow ? 'text-white' : 'text-slate-400'}`}>{player.display_name}</h2>
            <div title={shot?.distanceMm != null ? `${shot.distanceMm.toFixed(1)} mm from bull` : undefined} className={`mt-3 whitespace-nowrap text-2xl font-black tabular-nums ${spectator ? 'md:text-5xl 2xl:text-6xl' : 'sm:text-4xl'} ${measured ? 'bull-number text-white' : 'text-slate-600'}`}>{shot ? formatBullDistance(shot.distanceMm) : '—'}</div>
            {onThrow ? <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-cyan-300 px-3 py-1.5 text-xs font-black uppercase tracking-wide text-slate-950 sm:text-sm"><span aria-hidden="true" className="size-2 rounded-full bg-slate-950" />{state.awaitingTakeout ? 'Remove dart' : 'Your throw'}</div> : (!spectator || !measured || shot?.distanceMm === null) && <p className="mt-2 text-sm text-slate-400">{awaitingRethrow ? 'Tied · waiting for another dart' : shot?.distanceMm != null ? `${shot.distanceMm.toFixed(1)} mm from bull` : shot ? 'Miss / no measured landing' : id === current?.id ? 'On the oche · one dart' : 'Pending'}</p>}
          </div>
        </article>;
      })}
    </div>
    <section aria-label="Bull-off distance comparison" className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-950 p-4 md:p-6">
      <div className="mb-5 flex items-baseline justify-between gap-3"><h2 className="text-lg font-bold">How close?</h2></div>
      <div className="ml-24 mr-20 flex justify-between text-xs text-slate-500"><span className="font-bold text-lime-300">◎ BULL</span><span>{formatBullDistance(maxDistance)}</span></div>
      <div className="relative mt-3 flex-1" style={{ minHeight: rankedIds.length * 56 }}>
        {players.map(player => {
          const rank = rankedIds.indexOf(player.id);
          if (rank < 0) return null;
          const shot = latestByPlayer.get(player.id);
          const percent = shot?.distanceMm == null ? 100 : shot.distanceMm / maxDistance * 100;
          return <div key={player.id} className="bull-lane absolute left-0 right-0 flex h-14 items-center gap-3" style={{ top: `${rank / rankedIds.length * 100}%` }}>
            <span className="w-20 shrink-0 truncate text-sm font-semibold">{player.display_name}</span>
            <div className="relative h-9 flex-1 border-l-2 border-lime-400/60 bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(25%_-_1px),#ffffff0d_calc(25%_-_1px),#ffffff0d_25%)]">
              <span className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
              {shot?.distanceMm != null && <><span className="bull-length absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-gradient-to-r from-lime-400/60 to-cyan-400/60" style={{ width: `${percent}%` }} /><span className="bull-marker absolute top-1/2 z-10" style={{ left: `${percent}%` }}><span key={shot.round} className="bull-dot block size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-cyan-400 shadow-[0_0_16px_#22d3eeaa]" /></span></>}
            </div>
            <span className="w-16 shrink-0 text-right text-xs tabular-nums text-slate-400">{shot ? formatBullDistance(shot.distanceMm) : 'Pending'}</span>
          </div>;
        })}
      </div>
    </section>
    </div>
    {!spectator && !hardware && state.phase === 'throwing' && <div className="rounded-xl border border-white/10 bg-slate-900 p-5">
      {state.awaitingTakeout ? <Button disabled={busy} onClick={() => void submit('takeout')}>Dart removed — continue</Button> :
        <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void submit('throw'); }}>
          <label className="space-y-2"><span className="block text-sm">Distance from centre of bull</span><Input aria-label="Distance from bull" type="number" min="0" max={unit === 'in' ? 1000 / 25.4 : 1000} step="any" required value={distance} onChange={event => setDistance(event.target.value)} /></label>
          <select aria-label="Distance unit" className="rounded-md border border-white/20 bg-slate-900 p-2" value={unit} onChange={event => setUnit(event.target.value as 'in' | 'mm')}><option value="in">Inches</option><option value="mm">Millimetres</option></select>
          <Button type="submit" disabled={busy || distance.trim() === ''}>Record distance</Button><Button type="button" variant="outline" disabled={busy} onClick={() => void submit('throw', true)}>Miss / bounce-out</Button>
        </form>}
      {error && <p role="alert" className="mt-3 text-red-400">{error}</p>}
    </div>}
    {commentaryEnabled && commentary && <p className="text-lg italic text-slate-300">{commentary}</p>}
    <style jsx>{`
      .bull-current { animation: bull-current-pulse 2s ease-in-out infinite; }
      @keyframes bull-current-pulse { 0%, 100% { box-shadow: 0 0 16px #22d3ee20; } 50% { box-shadow: 0 0 36px #22d3ee60; } }
      .bull-lane { transition: top 650ms cubic-bezier(.2,.8,.2,1); }
      .bull-length { transition: width 700ms cubic-bezier(.16,1,.3,1); }
      .bull-marker { transition: left 700ms cubic-bezier(.16,1,.3,1); }
      .bull-landed { animation: bull-pop 680ms cubic-bezier(.16,1,.3,1) both; }
      .bull-number { animation: bull-reveal 600ms cubic-bezier(.16,1,.3,1) both; }
      .bull-flash { animation: bull-flash 850ms ease-out both; }
      .bull-dot { animation: bull-impact 650ms cubic-bezier(.16,1,.3,1) both; }
      @keyframes bull-pop { 0% { transform: scale(.82); filter: brightness(2); } 55% { transform: scale(1.08); } 78% { transform: scale(.98); } 100% { transform: scale(1); filter: brightness(1); } }
      @keyframes bull-reveal { 0% { opacity: 0; transform: translateY(18px) scale(.65); } 60% { opacity: 1; transform: translateY(-3px) scale(1.12); } 100% { transform: translateY(0) scale(1); } }
      @keyframes bull-flash { 0% { opacity: 1; } 100% { opacity: 0; } }
      @keyframes bull-impact { 0% { scale: 2.8; opacity: .2; } 60% { scale: .8; opacity: 1; } 100% { scale: 1; } }
      @media (prefers-reduced-motion: reduce) { .bull-lane, .bull-length, .bull-marker { transition: none; } .bull-current, .bull-landed, .bull-number, .bull-flash, .bull-dot { animation: none; } .bull-flash { opacity: 0; } }
    `}</style>
    {toggleSpectator && <Button variant="ghost" onClick={toggleSpectator}>{spectator ? 'Open scoring controls' : 'Spectator view'}</Button>}
  </section></div>;
}
