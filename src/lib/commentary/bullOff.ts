import { formatBullDistance, liveBullOffOrder, type BullOffState } from '../match/bullOff.ts';

const spokenDistance = (distanceMm: number | null) => formatBullDistance(distanceMm).replace('″', ' inches');

export function bullOffBrief(state: BullOffState, names: Record<string, string>, rules?: { start_score: string; finish: string; legs_to_win: number }): string {
  const name = (id: string) => names[id] ?? 'Player';
  const latest = state.shots.at(-1);
  if (state.phase === 'complete') return [
    'AUTHORITATIVE X01 GAME OPENING · bull-off resolved and spectator game view ready.',
    `Confirmed X01 order: ${state.order.map(name).join(', ')}.`,
    `First to throw: ${name(state.order[0])}. ${rules ? `Every player starts at ${rules.start_score}; ${rules.finish.replaceAll('_', ' ')}; first to ${rules.legs_to_win} legs.` : 'Everyone starts on their full starting score.'}`,
    'Give one short, energetic game-opening hype call. Name the starter and use the actual rules if useful. Continue the SAME commentary session and persona; do not introduce yourself again. A callback to the bull-off is welcome if it fits, but move into the game instead of repeating the last distance.',
    'Winning the bull-off is NOT winning a leg or match. No X01 darts have been scored by this bull-off. No invented player intent, probabilities or results.',
  ].join('\n');

  return [
    'AUTHORITATIVE BULL-OFF · pre-game player ordering, NOT X01 scoring.',
    'Each player throws ONE dart at the bull. Smaller distance is better. Equal distances rethrow only for tied places; misses rank last.',
    `Provisional distance order: ${liveBullOffOrder(state).map(id => { const shot = [...state.shots].reverse().find(candidate => candidate.playerId === id); return `${name(id)}: ${shot ? spokenDistance(shot.distanceMm) : 'pending'}`; }).join('; ')}. Earlier rounds lock non-tied positions.`,
    latest ? `Latest measurement: ${name(latest.playerId)}, ${spokenDistance(latest.distanceMm)}${latest.distanceMm === null ? ' (no measured landing; do not invent a distance)' : ` (${latest.distanceMm.toFixed(1)} mm)`}.` : 'No bull-off darts thrown yet.',
    `Round ${state.round}. ${state.awaitingTakeout ? 'Waiting for physical dart removal; no next-player walk-on yet.' : `Next: ${name(state.pending[0])}.`}`,
    `Still to throw${state.round > 1 ? ' in the tied-position rethrow' : ''}: ${state.pending.map(name).join(', ')}. Order is not final.`,
    'React briefly and naturally to the actual measured distance. Affectionate office-match sass is welcome: “Oh my God, six inches!” only when the supplied inches really round to six. Vary the reaction; do not force that phrase. No invented distances, X01 points, checkout chances, or match wins.',
  ].join('\n');
}
