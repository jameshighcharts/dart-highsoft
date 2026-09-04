import type { DartIQEventPriority } from '@/lib/dartiq/events';

import { broadcastDirectionInstruction, type BroadcastDirection } from './broadcastDirector.ts';
import { priorityInstruction, visitScopeInstruction } from './commentaryPolicy.ts';
import { realtimePersonaResponseInstruction } from './personas.ts';
import { visitTimingInstruction } from './commentaryVisitTiming.ts';
import type { CommentaryPersona, CommentaryPersonaId } from './types';

export function buildRealtimeSessionInstructions(persona: CommentaryPersona) {
  return `${persona.systemPrompt}

# Live Match Context
- Labeled match briefs are authoritative for scores, probabilities, player names, and outcomes.
- The latest commentary epoch is current. Earlier epochs become historical and should not influence new calls.
- The active broadcast story is the editorial focus. Background stories remain context until promoted.
- Every factual claim must trace to a supplied event, memory fact, or promoted story. Invent no aim, intent, miss, record, or history.

# Speaking Behavior
- Context events update memory silently. Generate speech when a response is requested.
- Respond quickly without a preamble or visible reasoning.
- Deliver one commentary line of at most ${persona.style.maxWords} words.
- Accuracy comes before the joke. Use the strongest supplied fact without reciting labels or numbers mechanically.`;
}

export function buildRealtimeOpeningInstructions(personaId?: CommentaryPersonaId) {
  return [
    '# Pre-match Opening',
    '- Use only the authoritative match snapshot already supplied.',
    '- Introduce the matchup and make one playful, specific observation from the supplied history or rematch context.',
    '- Do not predict a record, rivalry, intent, or result that was not supplied.',
    '- Length: 5–14 words. Sound spontaneous; this is the walk-on, not an essay.',
    `- ${realtimePersonaResponseInstruction(personaId)}`,
  ].join('\n');
}

type RealtimeResponseBrief = {
  personaId?: CommentaryPersonaId;
  priority: DartIQEventPriority;
  dartIndex: number;
  turnScore: number;
  checkedOut: boolean;
  busted: boolean;
  visitDarts?: readonly { segment: string; scored: number }[];
  nextPlayerAlreadyThrowing: boolean;
  direction?: BroadcastDirection | null;
  nikitaSpecial?: boolean;
  legResolved?: boolean;
  nextLegAvailable?: boolean;
};

export function realtimeLengthInstruction(input: Pick<
  RealtimeResponseBrief,
  'priority' | 'dartIndex' | 'checkedOut' | 'busted' | 'nikitaSpecial'
>) {
  const midVisit = input.dartIndex < 3 && !input.checkedOut && !input.busted && !input.nikitaSpecial;
  if (midVisit) {
    return 'Length: 1–5 words. Prefer a one-word or spicy micro-reaction when it lands, then stop.';
  }
  if (input.priority === 'marquee' || input.priority === 'terminal') {
    return 'Length: 4–12 words. One punchy payoff; finish immediately.';
  }
  if (input.priority === 'notable') {
    return 'Length: 3–8 words. One compact observation or joke.';
  }
  return 'Length: 1–7 words. A tiny spontaneous reaction, then stop.';
}

export function buildRealtimeResponseInstructions(input: RealtimeResponseBrief) {
  const moment = input.nikitaSpecial
    ? 'Moment: Nikita special — celebrate the exact 1, 5, and 20 visit by name.'
    : input.busted
      ? 'Moment: bust. React immediately and roast the failed visit without cushioning it.'
    : priorityInstruction(input.priority);
  const story = broadcastDirectionInstruction(input.direction);

  return [
    '# Current Call',
    `- ${moment}`,
    `- ${visitScopeInstruction(input)}`,
    `- ${visitTimingInstruction(input)}`,
    `- ${realtimeLengthInstruction(input)}`,
    '- Choose the strongest fresh supplied fact; perform it spontaneously instead of listing candidates.',
    input.legResolved
      ? `- Celebrate the leg result first.${input.nextLegAvailable ? ' You may tee up the supplied next-leg starter in the same line.' : ''}`
      : '',
    story ? `- ${story}` : '',
    `- ${realtimePersonaResponseInstruction(input.personaId)}`,
  ].filter(Boolean).join('\n');
}
