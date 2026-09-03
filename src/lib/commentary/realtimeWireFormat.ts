import type { ScoliaRealtimeDartEvent } from './scoliaRealtimeEvent.ts';
import type { RealtimeCommentarySnapshot } from './realtimeSnapshot.ts';
import type { CommentaryNarrativeMemory, CommentaryPlayerNarrative } from './commentaryNarrative.ts';
import type { BroadcastDirection } from './broadcastDirector.ts';
import type { CommentaryContext } from '@/services/commentaryService';

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function points(value: number) {
  const rounded = Math.round(value * 100);
  return `${rounded >= 0 ? '+' : ''}${rounded}pp`;
}

function words(value: string) {
  return value.replaceAll('_', ' ');
}

function narrativePlayerLine(player: CommentaryPlayerNarrative, name: string) {
  const facts = [
    `average ${player.currentThreeDartAverage.toFixed(1)} vs historical ${player.baselineThreeDartAverage.toFixed(1)}`,
    `checkouts ${player.checkoutPressure.conversions}/${player.checkoutPressure.opportunities}`,
  ];
  if (player.checkoutPressure.highPressureOpportunities > 0) {
    facts.push(
      `high-stakes checkouts ${player.checkoutPressure.highPressureConversions}/${player.checkoutPressure.highPressureOpportunities}`
    );
  }
  if (player.tendencies.length > 0) facts.push(`pattern: ${player.tendencies.join(', ')}`);
  const missed = player.checkoutPressure.recentMissedDoubles.at(-1);
  if (missed) facts.push(`latest missed double: leg ${missed.legNumber}, ${missed.scoreBefore} left, hit ${missed.hitSegment}`);
  return `${name}: ${facts.join('; ')}`;
}

function arcLine(
  direction: BroadcastDirection | undefined,
  names: ReadonlyMap<string, string>
) {
  const arc = direction?.activeStoryArc;
  if (!arc) return null;
  const subject = arc.subjectPlayerId ? names.get(arc.subjectPlayerId) ?? 'a player' : 'the match';
  const counterpart = arc.counterpartPlayerId
    ? names.get(arc.counterpartPlayerId) ?? 'the opponent'
    : null;
  const transition = direction.transition === 'payoff_due'
    ? 'pay this story off now'
    : direction.transition === 'closure_due'
      ? 'close this story now'
      : direction.shouldPromote
        ? 'connect this call to it'
        : 'keep it in reserve';
  return `Story: ${words(arc.kind)} for ${subject}${counterpart ? ` against ${counterpart}` : ''}; ${transition}.`;
}

export class RealtimeNarrativeWireState {
  private readonly names = new Map<string, string>();
  private readonly playerFingerprints = new Map<string, string>();
  private storyFingerprint = '';

  reset(snapshot?: RealtimeCommentarySnapshot) {
    this.names.clear();
    this.playerFingerprints.clear();
    this.storyFingerprint = '';
    if (snapshot) {
      for (const player of snapshot.players) this.names.set(player.id, player.name);
    }
  }

  name(playerId: string, fallback = 'Player') {
    return this.names.get(playerId) ?? fallback;
  }

  renderNarrativeDelta(
    narrative: CommentaryNarrativeMemory | undefined,
    direction?: BroadcastDirection
  ) {
    if (!narrative) return [];
    const lines: string[] = [];
    for (const player of narrative.players) {
      const fingerprint = JSON.stringify(player);
      if (this.playerFingerprints.get(player.playerId) === fingerprint) continue;
      this.playerFingerprints.set(player.playerId, fingerprint);
      lines.push(`Memory update — ${narrativePlayerLine(player, this.name(player.playerId))}`);
    }
    const story = arcLine(direction, this.names);
    const fingerprint = story ?? '';
    if (fingerprint !== this.storyFingerprint) {
      this.storyFingerprint = fingerprint;
      if (story) lines.push(story);
    }
    return lines;
  }
}

export function renderRealtimeSnapshot(
  epoch: number,
  snapshot: RealtimeCommentarySnapshot,
  state: RealtimeNarrativeWireState
) {
  state.reset(snapshot);
  const names = new Map(snapshot.players.map((player) => [player.id, player.name]));
  const rules = `${snapshot.startScore} ${words(snapshot.finishRule)}, first to ${snapshot.legsToWin}`;
  const players = snapshot.players.map((player) =>
    `- ${player.name}: ${player.score} left, ${player.legsWon} legs; historical average ${player.historicalBaseline.threeDartAverage.toFixed(1)}, checkout ${percent(player.historicalBaseline.checkoutRate)}, evidence ${player.historicalBaseline.profileSource} (${player.historicalBaseline.historicalDarts} darts)`
  );
  const current = snapshot.currentLeg
    ? `Leg ${snapshot.currentLeg.number}; ${state.name(snapshot.currentLeg.currentPlayerId ?? '', 'nobody')} to throw; ${state.name(snapshot.currentLeg.startingPlayerId)} started.`
    : 'No active leg.';
  const rematch = snapshot.rematch
    ? `Rematch: previous winner ${snapshot.rematch.previousWinnerId ? names.get(snapshot.rematch.previousWinnerId) ?? 'unknown' : 'unknown'}.`
    : null;
  const narrative = state.renderNarrativeDelta(snapshot.narrative, snapshot.narrative.broadcastDirection);
  return [
    `AUTHORITATIVE MATCH SNAPSHOT · epoch ${epoch}`,
    `Rules: ${rules}; fair ending ${snapshot.fairEnding ? 'on' : 'off'}.`,
    ...players,
    current,
    rematch,
    ...narrative,
  ].filter(Boolean).join('\n');
}

export function renderScoliaRealtimeEvent(
  epoch: number,
  event: ScoliaRealtimeDartEvent,
  state: RealtimeNarrativeWireState,
  direction?: BroadcastDirection
) {
  const pressure = event.pressure;
  const result = event.matchWon
    ? 'match won'
    : pressure?.signals.includes('leg_win')
      ? 'leg won'
      : event.checkedOut
        ? 'checkout'
        : event.busted
          ? 'bust'
          : null;
  const visit = event.dartIndex >= 3 || event.checkedOut || event.busted
    ? `Visit: ${event.visitDarts.map((dart) => dart.segment).join(' · ')} = ${event.turnScore}${event.busted ? ' (bust)' : ''}.`
    : null;
  const probability = pressure
    ? `Win chance: leg ${percent(pressure.legProbabilityBefore)} → ${percent(pressure.legProbabilityAfter)} (${points(pressure.legWpa)}); match ${percent(pressure.matchProbabilityBefore)} → ${percent(pressure.matchProbabilityAfter)} (${points(pressure.matchWpa)}).`
    : null;
  const consequence = pressure
    ? `Full-field consequence: leg ${points(pressure.consequence.leg)}; match ${points(pressure.consequence.match)}.`
    : null;
  const signals = pressure?.signals.length ? `Facts: ${pressure.signals.map(words).join(', ')}.` : null;
  return [
    `AUTHORITATIVE EVENT · epoch ${epoch}`,
    `${event.playerName} · leg ${event.legNumber} · dart ${event.dartIndex}: ${event.segment} for ${event.scored}${pressure ? `; score ${pressure.scoreBefore} → ${pressure.scoreAfter}` : ''}${result ? `; ${result}` : ''}.`,
    visit,
    probability,
    consequence,
    signals,
    ...state.renderNarrativeDelta(event.narrative, direction),
  ].filter(Boolean).join('\n');
}

export function renderManualRealtimeEvent(
  epoch: number,
  context: CommentaryContext,
  state: RealtimeNarrativeWireState,
  direction?: BroadcastDirection
) {
  const pressure = context.pressure;
  const currentScoreBefore = context.busted
    ? context.remainingScore
    : context.totalScore + context.remainingScore;
  const probability = pressure
    ? `Win chance: leg ${percent(pressure.legProbabilityBefore)} → ${percent(pressure.legProbabilityAfter)} (${points(pressure.legWpa)}); match ${percent(pressure.matchProbabilityBefore)} → ${percent(pressure.matchProbabilityAfter)} (${points(pressure.matchWpa)}).`
    : null;
  const storyDirection = direction
    ? { ...direction, activeStoryArc: direction.activeStoryArc }
    : undefined;
  return [
    `AUTHORITATIVE EVENT · epoch ${epoch}`,
    `${context.playerName} · leg ${context.gameContext.currentLegNumber} · visit ${context.gameContext.playerTurnNumber}: ${context.throws.map((dart) => dart.segment).join(' · ')} = ${context.totalScore}; score ${currentScoreBefore} → ${context.remainingScore}${context.busted ? '; bust' : pressure?.checkedOut ? '; checkout' : ''}.`,
    probability,
    pressure ? `Full-field consequence: leg ${points(pressure.peakLegConsequence ?? Math.abs(pressure.legWpa))}; match ${points(pressure.peakMatchConsequence ?? Math.abs(pressure.matchWpa))}.` : null,
    ...state.renderNarrativeDelta(context.narrative, storyDirection),
  ].filter(Boolean).join('\n');
}
