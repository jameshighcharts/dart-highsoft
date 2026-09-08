import { commentaryStartingMood, renderPlayerNicknames, nikitaSpecialMoment } from './personas.ts';
import type { CommentaryContext } from '@/services/commentaryService';
import type { DartIQHistoricalFact } from '@/lib/dartiq/evidence';
import type { BroadcastDirection } from './broadcastDirector.ts';
import type { CommentaryNarrativeMemory, CommentaryPlayerNarrative } from './commentaryNarrative.ts';
import type { RealtimeCommentarySnapshot } from './realtimeSnapshot.ts';
import type { ScoliaRealtimeDartEvent } from './scoliaRealtimeEvent.ts';
import { RivalryDirector } from './broadcastDirector.ts';
import { selectCommentaryRivalry, type CommentaryRivalry, type RivalryBeat } from './commentaryNarrative.ts';
import { hasCheckoutRoute } from '../dartiq/checkout.ts';

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function points(value: number) {
  const rounded = Math.round(value * 100);
  return `${rounded >= 0 ? '+' : ''}${rounded}pp`;
}

function opportunityLine(dartiq: ScoliaRealtimeDartEvent['dartiq']) {
  if (!dartiq?.opportunity) return null;
  return `Before the dart: expected movement leg ${points(dartiq.opportunity.leg)}, match ${points(dartiq.opportunity.match)}; evidence ${words(dartiq.opportunity.confidenceTier)}.`;
}

function rarityLine(dartiq: ScoliaRealtimeDartEvent['dartiq']) {
  if (!dartiq?.outcomeRarity?.eligibleForCommentary) return null;
  const tail = Math.min(
    dartiq.outcomeRarity.legDirectionalTail,
    dartiq.outcomeRarity.matchDirectionalTail
  );
  if (tail > 0.1 || (dartiq.consequence.leg < 0.05 && dartiq.consequence.match < 0.02)) return null;
  return `Model rarity: this direction of swing was in the outer ${percent(tail)} tail for this state.`;
}

function fairEndingLine(
  fair: { phase: string; checkedOutPlayerIds: string[]; tiebreakRound: number;
    tiebreakPlayerIds: string[]; tiebreakScores: Record<string, number>; winnerId: string | null;
    pendingPlayerIds?: string[] } | null | undefined,
  state: RealtimeNarrativeWireState
) {
  if (!fair) return null;
  const names = (ids: string[]) => ids.map((id) => state.name(id)).join(', ');
  if (fair.phase === 'completing_round') return `FAIR ENDING · unresolved. Checked out: ${names(fair.checkedOutPlayerIds)}. ${fair.pendingPlayerIds?.length ? `Still entitled to finish this round: ${names(fair.pendingPlayerIds)}. ` : ''}A checkout is provisional; no winner yet. If another player checks out in this round, the tied finishers enter a high-score tiebreak. Follow the current thrower; do not repeat congratulations to an earlier finisher.`;
  if (fair.phase === 'tiebreak') return `FAIR ENDING · high-score tiebreak round ${fair.tiebreakRound}; unresolved, no winner yet. Players: ${names(fair.tiebreakPlayerIds)}. Round totals: ${fair.tiebreakPlayerIds.map((id) => `${state.name(id)} ${fair.tiebreakScores[id] ?? 0}`).join(', ')}. Each player gets three darts; highest visit total wins after everyone finishes. Tied leaders play another round. These scores count UP; there is no checkout target. React to the current dart, not an earlier X01 checkout.`;
  if (fair.phase === 'resolved') return `FAIR ENDING · resolved${fair.winnerId ? `; confirmed leg winner ${state.name(fair.winnerId)}` : ''}. Announce this result once; subsequent play moves on.`;
  return 'FAIR ENDING · enabled. The first checkout does not end the leg: eligible players finish the same round. Multiple finishers play three-dart high-score tiebreaks; tied leaders repeat until resolved.';
}

function landingLines(event: ScoliaRealtimeDartEvent, state: RealtimeNarrativeWireState) {
  const before = event.landingBefore;
  const next = event.landingNext;
  const segments = (forecast: NonNullable<typeof next>) => forecast.segments
    .map((entry) => `${entry.segment} ${percent(entry.probability)}`).join(', ');
  return [
    'Landing forecasts from earlier events are expired. Only NEXT LANDING below, if present, applies now; correction or turn change also expires it.',
    event.landing?.detail,
    event.grouping ? `VISIT GROUPING · ${event.playerName}, ${event.grouping.dartCount} darts so far: maximum pairwise separation ${event.grouping.maximumSeparationMm.toFixed(1)} mm; first two ${event.grouping.firstPairSeparationMm.toFixed(1)} mm apart; latest dart ${event.grouping.latestNearestSeparationMm.toFixed(1)} mm from its nearest earlier dart. ${event.grouping.shape === 'tight' ? 'Tight physical group.' : event.grouping.shape === 'third_separated' ? 'The first two were close together; the third landed away from both.' : 'Describe the measured spread only; targets may have changed.'} Positions only: no inferred aim, deflection, deliberate grouping, or accuracy judgment. Optional colour for this visit, not a reason to repeat a grouping call.` : null,
    before ? `PRE-DART LANDING · ${state.name(before.playerId)}, ${before.dartsLeft} darts left at ${before.scoreRemaining}: ${segments(before)}.${before.actualSegmentProbability !== undefined ? ` Observed ${event.segment} had ${percent(before.actualSegmentProbability)} probability.` : ''} This was the frozen-model forecast before this dart, not hindsight or an intended target.` : null,
    next ? `NEXT LANDING · ${state.name(next.playerId)}, ${next.dartsLeft} darts left at ${next.scoreRemaining}: ${segments(next)}. Valid only until the next dart. Historical scoring-context distribution; does not infer aim or account for where the previous dart landed. Background context; optional brief anticipation, never a promise or routine probability recital.` : null,
  ].filter(Boolean);
}

function legResolutionLine(
  resolution: NonNullable<ScoliaRealtimeDartEvent['dartiq']>['legResolution'],
  state: RealtimeNarrativeWireState
) {
  if (!resolution) return null;
  const winner = state.name(resolution.winnerPlayerId);
  const scoreline = Object.entries(resolution.legsWonAfter)
    .map(([playerId, legs]) => `${state.name(playerId)} ${legs}`)
    .join(', ');
  const bridge = resolution.nextLeg
    ? ` Next: leg ${resolution.nextLeg.number}, ${state.name(resolution.nextLeg.startingPlayerId)} throws first.`
    : '';
  return `Leg result: ${winner} wins${resolution.wonAgainstThrow ? ', breaking throw' : ''}; ${scoreline}.${bridge}`;
}

function words(value: string) {
  return value.replaceAll('_', ' ');
}

function candidateSet(candidates: Array<string | null | undefined>) {
  const unique = [...new Set(candidates.filter((candidate): candidate is string => Boolean(candidate)))];
  if (unique.length === 0) return null;
  return [
    'Candidates (all true — choose the freshest, or combine only when natural):',
    ...unique.slice(0, 4).map((candidate, index) => `${index + 1}. ${candidate}`),
  ].join('\n');
}

function factNumber(fact: DartIQHistoricalFact, key: string) {
  const value = fact.evidence[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function factPlayerId(fact: DartIQHistoricalFact, key: string) {
  const value = fact.evidence[key];
  return typeof value === 'string' ? value : null;
}

export function renderHistoricalFact(
  fact: DartIQHistoricalFact,
  name: (playerId: string) => string
) {
  const subject = name(fact.subjectPlayerId);
  if (fact.kind === 'matchup_history' && fact.counterpartPlayerId) {
    const counterpart = name(fact.counterpartPlayerId);
    const shared = factNumber(fact, 'sharedMatches');
    const subjectWins = factNumber(fact, 'subjectWins');
    const counterpartWins = factNumber(fact, 'counterpartWins');
    const otherWins = factNumber(fact, 'otherWinnerMatches');
    const twoPlayerMatches = factNumber(fact, 'twoPlayerMatches');
    const latestWinnerId = factPlayerId(fact, 'latestWinnerPlayerId');
    const streak = factNumber(fact, 'currentWinnerStreak');
    const support = `${shared} completed shared match${shared === 1 ? '' : 'es'}, ${words(fact.confidenceTier)} evidence`;
    if (twoPlayerMatches === shared) {
      if (shared === 1 && latestWinnerId) {
        return `History (${support}): ${name(latestWinnerId)} won ${subject} and ${counterpart}'s only previous meeting.`;
      }
      const leaderId = subjectWins > counterpartWins
        ? fact.subjectPlayerId
        : counterpartWins > subjectWins
          ? fact.counterpartPlayerId
          : null;
      const neverWon = shared >= 2 && (subjectWins === 0 || counterpartWins === 0);
      const neverWonPlayer = subjectWins === 0 ? subject : counterpart;
      const streakText = latestWinnerId && streak >= 2
        ? ` ${name(latestWinnerId)} won the last ${streak}.`
        : '';
      const neverText = neverWon && leaderId
        ? ` ${neverWonPlayer} has not beaten ${name(leaderId)} yet.`
        : '';
      const record = subjectWins > counterpartWins
        ? `${subject} leads ${subjectWins}-${counterpartWins} against ${counterpart}.`
        : counterpartWins > subjectWins
          ? `${counterpart} leads ${counterpartWins}-${subjectWins} against ${subject}.`
          : `${subject} and ${counterpart} are tied ${subjectWins}-${counterpartWins}.`;
      return `History (${support}): ${record}${streakText}${neverText}`;
    }
    return `History (${support}): ${subject} won ${subjectWins}, ${counterpart} won ${counterpartWins}, and other players won ${otherWins}.`;
  }

  const matches = factNumber(fact, 'matchesPlayed');
  const streak = factNumber(fact, 'currentWinStreak');
  const fastestLeg = factNumber(fact, 'fastestWinningLegDarts');
  const highestCheckout = factNumber(fact, 'highestCheckout');
  const oneEighties = factNumber(fact, 'oneEighties');
  const visits = factNumber(fact, 'visits');
  const tonPlusVisits = factNumber(fact, 'tonPlusVisits');
  const busts = factNumber(fact, 'busts');
  const bogeyLeaves = factNumber(fact, 'bogeyLeaves');
  const checkoutReadyLosses = factNumber(fact, 'checkoutReadyLosses');
  const highlights: string[] = [];
  if (streak >= 2) highlights.push(`has won ${streak} straight matches`);
  if (oneEighties > 0) highlights.push(`${oneEighties} historical 180${oneEighties === 1 ? '' : 's'}`);
  if (tonPlusVisits >= 3 && visits >= 10) highlights.push(`${tonPlusVisits} ton-plus visits in ${visits}`);
  if (busts >= 3 && visits >= 10) highlights.push(`${busts} busts in ${visits} visits`);
  if (bogeyLeaves >= 2) highlights.push(`left a bogey ${bogeyLeaves} times`);
  if (checkoutReadyLosses >= 2) {
    highlights.push(`lost ${checkoutReadyLosses} single-leg matches while sitting on a finish`);
  }
  if (highestCheckout > 0) highlights.push(`highest checkout ${highestCheckout}`);
  if (fastestLeg > 0) highlights.push(`best winning leg ${fastestLeg} darts`);
  if (highlights.length === 0) return null;
  return `History (${matches} completed matches, ${words(fact.confidenceTier)} evidence): ${subject} ${highlights.slice(0, 2).join('; ')}.`;
}

function historicalFactLines(
  facts: readonly DartIQHistoricalFact[],
  state: RealtimeNarrativeWireState
) {
  const ordered = [
    ...facts.filter((fact) => fact.kind === 'matchup_history')
      .sort((left, right) => right.support - left.support)
      .slice(0, 6),
    ...facts.filter((fact) => fact.kind === 'player_history')
      .sort((left, right) => right.support - left.support),
  ];
  return ordered
    .map((fact) => renderHistoricalFact(fact, (playerId) => state.name(playerId)))
    .filter((line): line is string => Boolean(line))
    .slice(0, 12);
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
  const unconverted = player.checkoutPressure.recentUnconvertedOneDartFinishes.at(-1);
  if (unconverted) {
    facts.push(`latest one-dart finish left unconverted: leg ${unconverted.legNumber}, ${unconverted.scoreBefore} left, hit ${unconverted.hitSegment}`);
  }
  return `${name}: ${facts.join('; ')}`;
}

function arcLine(
  direction: BroadcastDirection | undefined,
  names: ReadonlyMap<string, string>
) {
  if (!direction?.shouldPromote) return null;
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
  if (arc.kind === 'seesaw_match') {
    const distinctFavorites = Number(arc.evidence.distinctFavorites ?? 0);
    const favoriteChanges = Number(arc.evidence.favoriteChanges ?? 0);
    const checkoutContenders = Number(arc.evidence.checkoutContenders ?? 0);
    const shape = distinctFavorites >= 3
      ? `${distinctFavorites} different players have held the favorite spot`
      : `the favorite has changed ${favoriteChanges} times`;
    const finish = checkoutContenders >= 3
      ? `; ${checkoutContenders} players are in checkout range`
      : '';
    return `Live match pattern: ${shape}${finish}; ${transition}.`;
  }
  return `Story: ${words(arc.kind)} for ${subject}${counterpart ? ` against ${counterpart}` : ''}; ${transition}.`;
}

export class RealtimeNarrativeWireState {
  readonly rivalry = new RivalryDirector();
  private readonly names = new Map<string, string>();
  private readonly playerFingerprints = new Map<string, string>();
  private storyFingerprint = '';
  private historicalFacts: readonly DartIQHistoricalFact[] = [];
  private readonly personalBaselines = new Map<string, number>();

  reset(snapshot?: RealtimeCommentarySnapshot) {
    this.rivalry.reset(snapshot ? selectCommentaryRivalry({
      playerIds: snapshot.players.map((player) => player.id),
      historicalFacts: snapshot.historicalFacts,
      rematch: snapshot.rematch,
    // The sideband commonly attaches on dart one. No completed visit means
    // there cannot yet have been a dispatched rivalry setup to repeat.
    }) : null, snapshot?.narrative.players.some((player) => player.completedVisits > 0) ?? false);
    this.names.clear();
    this.personalBaselines.clear();
    this.historicalFacts = snapshot?.historicalFacts ?? [];
    this.playerFingerprints.clear();
    this.storyFingerprint = '';
    if (snapshot) {
      for (const player of snapshot.players) {
        this.names.set(player.id, player.name);
        const baseline = player.historicalBaseline;
        if (baseline.profileSource === 'personal' && baseline.historicalDarts >= 30) {
          this.personalBaselines.set(player.id, baseline.threeDartAverage);
        }
      }
    }
  }

  name(playerId: string, fallback = 'Player') {
    return this.names.get(playerId) ?? fallback;
  }

  observeRivalryDart(event: ScoliaRealtimeDartEvent) {
    const packet = event.dartiq;
    if (!packet) return null;
    // semanticStakes describes BEFORE this dart. Recheck the actual leave and
    // remaining darts, and never promise an immediate win during fair ending.
    const matchDart = packet.finishRule && !packet.fairEnding?.enabled
      && packet.semanticStakes.matchWinAvailableThisVisit && event.dartIndex < 3
      && !event.busted && !event.checkedOut
      && hasCheckoutRoute(packet.scoreAfter, 1, packet.finishRule)
      ? { score: packet.scoreAfter, target: packet.finishRule === 'double_out'
        ? packet.scoreAfter === 50 ? 'bull (50)' : `D${packet.scoreAfter / 2}` : null }
      : undefined;
    return this.rivalry.observe({
      eventId: event.eventId, sequence: packet.sequence, turnId: event.turnId, playerId: event.playerId,
      probabilityBefore: packet.matchProbabilityBefore, probabilityAfter: packet.matchProbabilityAfter,
      matchChance: packet.semanticStakes.matchWinAvailableThisVisit,
      matchDart,
      completedVisit: event.dartIndex === 3 || event.busted || event.checkedOut,
      checkedOut: event.checkedOut, busted: event.busted,
      protectedMoment: event.nikitaSpecial || event.priority === 'marquee',
      legResolved: Boolean(packet.legResolution),
      fairEndingPending: Boolean(packet.fairEnding && packet.fairEnding.phase !== 'normal'),
      winnerId: packet.legResolution?.matchWon ? packet.legResolution.winnerPlayerId : null,
      isLatest: event.isLatestDart,
    });
  }

  observeRivalryVisit(context: CommentaryContext) {
    const dartiq = context.dartiq;
    if (!dartiq || !context.narrative) return null;
    return this.rivalry.observe({
      eventId: context.turnId ?? `visit-${context.gameContext.overallTurnNumber}`,
      sequence: context.narrative.sequence,
      turnId: context.turnId ?? `visit-${context.gameContext.overallTurnNumber}`,
      playerId: context.playerId,
      probabilityBefore: dartiq.matchProbabilityBefore, probabilityAfter: dartiq.matchProbabilityAfter,
      matchChance: Boolean(dartiq.matchWinAvailableThisVisit), completedVisit: true,
      checkedOut: Boolean(dartiq.checkedOut), busted: context.busted,
      protectedMoment: context.is180 || Boolean(context.isNikitaSpecial),
      legResolved: Boolean(dartiq.legResolution),
      fairEndingPending: dartiq.signals?.some((signal) => signal === 'fair_ending_checkout'
        || signal === 'tiebreak_started' || signal === 'tiebreak_tied' || signal === 'tiebreak_lead_change') ?? false,
      winnerId: dartiq.legResolution?.matchWon ? dartiq.legResolution.winnerPlayerId : null,
    });
  }

  historicalCandidateForDart(event: ScoliaRealtimeDartEvent) {
    const dartiq = event.dartiq;
    return this.contextualCandidate({
      playerId: event.playerId,
      checkoutScore: event.checkedOut ? event.turnScore : undefined,
      firstNineAverage: dartiq?.firstNineAverage,
      counterpartId: (event.busted || dartiq?.signals.includes('one_dart_finish_created'))
        && dartiq?.nextOpponentThreat && dartiq.nextOpponentThreat.scoreRemaining <= 170
        && dartiq.nextOpponentThreat.checkoutProbabilityNextVisit >= 0.05
        ? dartiq.nextOpponentThreat.playerId : undefined,
      counterpartScore: dartiq?.nextOpponentThreat?.scoreRemaining,
    });
  }

  /** One human-scale angle, ahead of generic model statistics in the brief. */
  contextualCandidate(input: {
    playerId: string;
    checkoutScore?: number;
    firstNineAverage?: number;
    counterpartId?: string;
    counterpartScore?: number;
  }) {
    const playerName = this.name(input.playerId);
    const personal = this.historicalFacts.find((fact) =>
      fact.kind === 'player_history' && fact.subjectPlayerId === input.playerId
    );
    const previousBest = personal ? factNumber(personal, 'highestCheckout') : 0;
    if (input.checkoutScore && previousBest > 0 && input.checkoutScore >= previousBest) {
      // Compare with the frozen pre-match record, not an assumed current record:
      // an earlier leg in this very match may already have beaten it.
      return `${playerName} checked out ${input.checkoutScore}; their best recorded checkout before this match was ${previousBest}.`;
    }
    const baseline = this.personalBaselines.get(input.playerId);
    if (input.firstNineAverage !== undefined && baseline !== undefined
      && Math.abs(input.firstNineAverage - baseline) >= 7) {
      return `${playerName}'s first nine averaged ${input.firstNineAverage.toFixed(1)}, against their historical average of ${baseline.toFixed(1)}; this is an early scoring comparison, not a finished-match average.`;
    }
    if (!input.counterpartId) return null;
    const matchup = this.historicalFacts.find((fact) => fact.kind === 'matchup_history'
      && ((fact.subjectPlayerId === input.playerId && fact.counterpartPlayerId === input.counterpartId)
        || (fact.subjectPlayerId === input.counterpartId && fact.counterpartPlayerId === input.playerId)));
    if (!matchup) return null;
    const current = input.counterpartScore !== undefined
      ? `${this.name(input.counterpartId)} has ${input.counterpartScore} remaining. ` : '';
    return `${current}Coming into this match — ${renderHistoricalFact(matchup, (id) => this.name(id))}`;
  }

  renderNarrativeDelta(
    narrative: CommentaryNarrativeMemory | undefined,
    direction?: BroadcastDirection
  ) {
    if (!narrative) return [];
    const lines: string[] = [];
    for (const player of narrative.players) {
      const rendered = narrativePlayerLine(player, this.name(player.playerId));
      const fingerprint = rendered;
      if (this.playerFingerprints.get(player.playerId) === fingerprint) continue;
      this.playerFingerprints.set(player.playerId, fingerprint);
      lines.push(`Memory update — ${rendered}`);
    }
    const story = direction?.rivalry ? null : arcLine(direction, this.names);
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
  const history = historicalFactLines(snapshot.historicalFacts, state);
  return [
    `AUTHORITATIVE MATCH SNAPSHOT · epoch ${epoch}`,
    `Rules: ${rules}; fair ending ${snapshot.fairEnding ? 'on' : 'off'}.`,
    ...players,
    renderPlayerNicknames(snapshot.players),
    current,
    fairEndingLine(snapshot.currentLeg?.fairEndingState, state),
    rematch,
    ...history,
    ...narrative,
    `FICTIONAL COMMENTATOR PREMISE · ${commentaryStartingMood(snapshot.matchId)}`,
    'This is your starting temperament, not a reset of the mood already developed in conversation. It is character flavour, not evidence about the game or players.',
  ].filter(Boolean).join('\n');
}

export function renderScoliaRealtimeEvent(
  epoch: number,
  event: ScoliaRealtimeDartEvent,
  state: RealtimeNarrativeWireState,
  direction?: BroadcastDirection
) {
  const dartiq = event.dartiq;
  const resolvedMatchWin = event.dartiq?.legResolution?.matchWon ?? event.matchWon;
  const actorWonResolution = !dartiq?.legResolution
    || dartiq.legResolution.winnerPlayerId === event.playerId;
  const result = resolvedMatchWin
    ? actorWonResolution ? 'match won' : 'match resolved'
    : dartiq?.signals.includes('leg_win')
      ? actorWonResolution ? 'leg won' : 'leg resolved'
      : event.checkedOut
        ? 'checkout'
        : event.busted
          ? 'bust'
          : null;
  const visit = event.dartIndex >= 3 || event.checkedOut || event.busted
    ? `Visit: ${event.visitDarts.map((dart) => dart.segment).join(' · ')} = ${event.turnScore}${event.busted ? ' (bust)' : ''}.`
    : null;
  const probability = dartiq
    ? `Win chance: leg ${percent(dartiq.legProbabilityBefore)} → ${percent(dartiq.legProbabilityAfter)} (${points(dartiq.legWpa)}); match ${percent(dartiq.matchProbabilityBefore)} → ${percent(dartiq.matchProbabilityAfter)} (${points(dartiq.matchWpa)}).`
    : null;
  const consequence = dartiq
    ? `Full-field consequence: leg ${points(dartiq.consequence.leg)}; match ${points(dartiq.consequence.match)}.`
    : null;
  const completedVisit = event.dartIndex >= 3 || event.checkedOut || event.busted;
  const opponentThreat = dartiq && !completedVisit && !dartiq.checkedOut && dartiq.nextOpponentThreat
    && dartiq.nextOpponentThreat.scoreRemaining <= 170
    && dartiq.nextOpponentThreat.checkoutProbabilityNextVisit >= 0.05
    ? `If this visit passes: ${state.name(dartiq.nextOpponentThreat.playerId)} has ${dartiq.nextOpponentThreat.scoreRemaining} left and a ${percent(dartiq.nextOpponentThreat.checkoutProbabilityNextVisit)} next-visit checkout chance.`
    : null;
  const suppressFavoriteChurn = direction?.activeStoryArc?.kind === 'seesaw_match'
    && !direction.shouldPromote;
  const spokenSignals = dartiq?.signals.filter((signal) =>
    !(suppressFavoriteChurn && signal === 'favorite_change')
  ) ?? [];
  const signals = spokenSignals.length ? `Facts: ${spokenSignals.map(words).join(', ')}.` : null;
  const visitCandidate = completedVisit && !event.checkedOut && !event.busted
    ? `${event.playerName} scored ${event.turnScore} with ${event.visitDarts.map((dart) => dart.segment).join(', ')} and left ${dartiq?.scoreAfter ?? 'their remaining score'}.`
    : null;
  const candidates = candidateSet([
    event.nikitaSpecial ? nikitaSpecialMoment(event.playerName) : null,
    dartiq?.legResolution
      ? `${state.name(dartiq.legResolution.winnerPlayerId)} won the leg${dartiq.legResolution.wonAgainstThrow ? ' against the throw' : ''}.`
      : null,
    dartiq?.signals.includes('big_fish')
      ? `${event.playerName} finished the 170 big fish.`
      : dartiq?.signals.includes('nine_darter')
        ? `${event.playerName} completed a nine-darter.`
        : dartiq?.signals.includes('one_eighty')
          ? `${event.playerName} hit 180.`
          : dartiq?.signals.includes('bull_checkout')
            ? `${event.playerName} finished on the bull.`
            : event.checkedOut && dartiq
              ? `${event.playerName} checked out ${dartiq.turnScoreAfter} on ${event.segment}.`
              : event.busted
                ? `${event.playerName} busted the visit.`
                : null,
    state.historicalCandidateForDart(event),
    dartiq?.signals.includes('back_to_back_t20')
      ? `${event.playerName} opened T20, T20; one dart remains for 180.`
      : dartiq?.signals.includes('one_dart_finish_created')
        ? `${event.playerName} has ${dartiq.scoreAfter} left with ${3 - event.dartIndex} dart${3 - event.dartIndex === 1 ? '' : 's'} still in hand.`
        : dartiq?.signals.includes('one_dart_finish_unconverted')
          ? `${event.playerName} had a one-dart finish at ${dartiq.scoreBefore}; ${dartiq.scoreAfter} remains with ${3 - event.dartIndex} dart${3 - event.dartIndex === 1 ? '' : 's'} in hand.`
          : dartiq?.signals.includes('low_scoring_dart')
            ? `${event.playerName} scored ${event.scored}; ${3 - event.dartIndex} dart${3 - event.dartIndex === 1 ? '' : 's'} remain in the visit.`
            : dartiq?.signals.includes('missed_board')
              ? `${event.playerName} scored zero; ${3 - event.dartIndex} dart${3 - event.dartIndex === 1 ? '' : 's'} remain in the visit.`
              : dartiq?.signals.includes('treble_hit') || dartiq?.signals.includes('double_hit')
                ? `${event.playerName} hit ${event.segment}; ${3 - event.dartIndex} dart${3 - event.dartIndex === 1 ? '' : 's'} remain in the visit.`
                : null,
    dartiq
      && (Math.abs(dartiq.matchWpa) >= 0.02 || Math.abs(dartiq.legWpa) >= 0.05)
      ? `${event.playerName}'s dart moved the match ${points(dartiq.matchWpa)} and the leg ${points(dartiq.legWpa)}.`
      : null,
    rarityLine(dartiq)?.replace('Model rarity: ', ''),
    dartiq?.firstNineAverage !== undefined
      ? `${event.playerName}'s first-nine average is ${dartiq.firstNineAverage.toFixed(1)}.`
      : null,
    dartiq?.tonPlusStreakReached
      ? `${event.playerName} has three consecutive ton-plus visits.`
      : null,
    opponentThreat,
    visitCandidate,
  ]);
  return [
    `AUTHORITATIVE EVENT · epoch ${epoch}`,
    `${event.playerName} · leg ${event.legNumber} · dart ${event.dartIndex}: ${event.segment} for ${event.scored}${dartiq ? `; score ${dartiq.scoreBefore} → ${dartiq.scoreAfter}` : ''}${result ? `; ${result}` : ''}.`,
    visit,
    fairEndingLine(dartiq?.fairEnding, state),
    ...landingLines(event, state),
    probability,
    consequence,
    opportunityLine(dartiq),
    rarityLine(dartiq),
    dartiq?.firstNineAverage !== undefined
      ? `First-nine average: ${dartiq.firstNineAverage.toFixed(1)}.`
      : null,
    dartiq?.tonPlusStreakReached ? 'Run: three consecutive ton-plus visits.' : null,
    legResolutionLine(dartiq?.legResolution, state),
    opponentThreat,
    signals,
    candidates,
    direction?.rivalry ? renderRivalryBeat(direction.rivalry, (id) => state.name(id)) : null,
    ...state.renderNarrativeDelta(event.narrative, direction),
  ].filter(Boolean).join('\n');
}

export function renderScoliaTakeoutFinished(input: {
  epoch: number;
  takeoutEventId: string;
  playerName: string;
  scoreRemaining: number;
}) {
  return [
    `AUTHORITATIVE TAKEOUT · epoch ${input.epoch} · ${input.takeoutEventId}`,
    'The previous player has removed the darts; the board is clear. All earlier next-landing forecasts have expired.',
    `Visit opening: ${input.playerName} is now up with ${input.scoreRemaining} remaining. No dart has landed yet.`,
  ].join('\n');
}

export function renderManualRealtimeEvent(
  epoch: number,
  context: CommentaryContext,
  state: RealtimeNarrativeWireState,
  direction?: BroadcastDirection
) {
  const dartiq = context.dartiq;
  const currentScoreBefore = context.busted
    ? context.remainingScore
    : context.totalScore + context.remainingScore;
  const probability = dartiq
    ? `Win chance: leg ${percent(dartiq.legProbabilityBefore)} → ${percent(dartiq.legProbabilityAfter)} (${points(dartiq.legWpa)}); match ${percent(dartiq.matchProbabilityBefore)} → ${percent(dartiq.matchProbabilityAfter)} (${points(dartiq.matchWpa)}).`
    : null;
  const storyDirection = direction
    ? { ...direction, activeStoryArc: direction.activeStoryArc }
    : undefined;
  const opponentThreat = dartiq && !dartiq.checkedOut && dartiq.nextOpponentThreat
    && dartiq.nextOpponentThreat.scoreRemaining <= 170
    && dartiq.nextOpponentThreat.checkoutProbabilityNextVisit >= 0.05
    ? `Next up: ${state.name(dartiq.nextOpponentThreat.playerId)} has ${dartiq.nextOpponentThreat.scoreRemaining} left and a ${percent(dartiq.nextOpponentThreat.checkoutProbabilityNextVisit)} next-visit checkout chance.`
    : null;
  const candidates = candidateSet([
    context.isNikitaSpecial ? nikitaSpecialMoment(context.playerName) : null,
    dartiq?.legResolution
      ? `${state.name(dartiq.legResolution.winnerPlayerId)} won the leg${dartiq.legResolution.wonAgainstThrow ? ' against the throw' : ''}.`
      : null,
    dartiq?.signals?.includes('big_fish')
      ? `${context.playerName} finished the 170 big fish.`
      : dartiq?.signals?.includes('nine_darter')
        ? `${context.playerName} completed a nine-darter.`
        : context.is180
          ? `${context.playerName} hit 180.`
          : dartiq?.signals?.includes('bull_checkout')
            ? `${context.playerName} finished on the bull.`
            : dartiq?.checkedOut
              ? `${context.playerName} checked out from ${currentScoreBefore}.`
              : context.busted
                ? `${context.playerName} busted the visit.`
                : null,
    state.contextualCandidate({
      playerId: context.playerId,
      checkoutScore: dartiq?.checkedOut ? currentScoreBefore : undefined,
      firstNineAverage: dartiq?.firstNineAverage,
      counterpartId: context.busted && opponentThreat ? dartiq?.nextOpponentThreat?.playerId : undefined,
      counterpartScore: dartiq?.nextOpponentThreat?.scoreRemaining,
    }),
    dartiq && (Math.abs(dartiq.matchWpa) >= 0.02 || Math.abs(dartiq.legWpa) >= 0.05)
      ? `${context.playerName}'s visit moved the match ${points(dartiq.matchWpa)} and the leg ${points(dartiq.legWpa)}.`
      : null,
    dartiq?.rarestMatchDirectionalTail !== undefined
      && dartiq.rarestMatchDirectionalTail <= 0.1
      && (dartiq.peakMatchConsequence ?? 0) >= 0.02
      ? `The visit produced an outer ${percent(dartiq.rarestMatchDirectionalTail)} model-relative match swing.`
      : null,
    dartiq?.firstNineAverage !== undefined
      ? `${context.playerName}'s first-nine average is ${dartiq.firstNineAverage.toFixed(1)}.`
      : null,
    dartiq?.signals?.includes('ton_plus_streak')
      ? `${context.playerName} has three consecutive ton-plus visits.`
      : null,
    opponentThreat,
  ]);
  return [
    `AUTHORITATIVE EVENT · epoch ${epoch}`,
    `${context.playerName} · leg ${context.gameContext.currentLegNumber} · visit ${context.gameContext.playerTurnNumber}: ${context.throws.map((dart) => dart.segment).join(' · ')} = ${context.totalScore}; score ${currentScoreBefore} → ${context.remainingScore}${context.busted ? '; bust' : dartiq?.checkedOut ? '; checkout' : ''}.`,
    fairEndingLine(dartiq?.fairEnding, state),
    probability,
    dartiq ? `Full-field consequence: leg ${points(dartiq.peakLegConsequence ?? Math.abs(dartiq.legWpa))}; match ${points(dartiq.peakMatchConsequence ?? Math.abs(dartiq.matchWpa))}.` : null,
    dartiq?.peakLegOpportunity !== undefined
      ? `Before the visit's biggest dart: expected movement leg ${points(dartiq.peakLegOpportunity)}, match ${points(dartiq.peakMatchOpportunity ?? 0)}.`
      : null,
    dartiq?.rarestMatchDirectionalTail !== undefined
      && dartiq.rarestMatchDirectionalTail <= 0.1
      && (dartiq.peakMatchConsequence ?? 0) >= 0.02
      ? `Model rarity: the visit contained an outer ${percent(dartiq.rarestMatchDirectionalTail)} match-swing tail.`
      : null,
    dartiq?.firstNineAverage !== undefined
      ? `First-nine average: ${dartiq.firstNineAverage.toFixed(1)}.`
      : null,
    dartiq?.signals?.includes('ton_plus_streak') ? 'Run: three consecutive ton-plus visits.' : null,
    legResolutionLine(dartiq?.legResolution, state),
    opponentThreat,
    candidates,
    ...state.renderNarrativeDelta(context.narrative, storyDirection),
    direction?.rivalry ? renderRivalryBeat(direction.rivalry, (id) => state.name(id)) : null,
  ].filter(Boolean).join('\n');
}

export function renderRivalryContext(rivalry: CommentaryRivalry, name: (id: string) => string) {
  const subject = name(rivalry.subjectId);
  const counterpart = name(rivalry.counterpartId);
  const history = rivalry.kind === 'revenge'
    ? `${counterpart} won the previous match; ${subject} is in this rematch.`
    : rivalry.kind === 'breakthrough'
      ? `${subject} has no wins in ${rivalry.meetings} recorded direct meetings with ${counterpart}.`
      : rivalry.kind === 'tied_record'
        ? `${subject} and ${counterpart} entered tied ${rivalry.subjectWins}-${rivalry.counterpartWins} in direct meetings.`
        : `${counterpart} won the last ${rivalry.streak} ${rivalry.scope === 'direct' ? 'direct meetings' : 'shared multiplayer/mixed-field meetings'} with ${subject}.`;
  return `${history}${rivalry.fieldSize > 2
    ? ' Today has other players: winning this field is not a new direct head-to-head result; another player can win.' : ''}`;
}

export function renderRivalryBeat(beat: RivalryBeat, name: (id: string) => string) {
  const subject = name(beat.rivalry.subjectId);
  const counterpart = name(beat.rivalry.counterpartId);
  const actor = name(beat.actorId ?? beat.rivalry.subjectId);
  const developments: Record<RivalryBeat['development'], string> = {
    opening: 'Establish this unfinished business once, attached to the actual visit.',
    match_dart: `${actor} has ${beat.matchDart?.score} remaining and a dart still in hand. ${beat.matchDart?.target ?? 'A one-dart finish'} can win this match now. This is an available route, not a claimed aim. The result remains open; this opportunity expires on the next dart.`,
    gain: `${subject} gained material match-winning ground during this visit. The result is still open.`,
    chance_unconverted: `${subject} had an opportunity to win this match during the visit and did not convert. Do not infer an intended target.`,
    bust: `${subject} busted this visit. React to that setback; no invented missed match dart.`,
    rival_response: `${counterpart} gained material match-winning ground during this visit. The result is still open.`,
    subject_won: `${subject} is the confirmed match winner. Close the supplied thread with that actual result.`,
    rival_won: `${counterpart} is the confirmed match winner. Close the supplied thread with that actual result.`,
    other_won: `${beat.winnerId ? name(beat.winnerId) : 'Another player'} is the confirmed match winner. Lead with that winner; the featured pair did not win.`,
  };
  return [
    `RIVALRY · ${beat.stage}: ${renderRivalryContext(beat.rivalry, name)}`,
    `DEVELOPMENT: ${developments[beat.development]}`,
    beat.rivalry.kind === 'tied_record' && beat.stage === 'resolve'
      ? 'This result breaks the previously tied direct record in the winner’s favour; it is not a breakthrough or revenge claim.' : '',
    beat.stage === 'resolve' && beat.rivalry.scope === 'direct' && beat.rivalry.fieldSize > 2
      ? 'The historical direct record and direct winning streak are unchanged by today’s multiplayer result. Do not announce a first direct victory or a broken direct streak.' : '',
    beat.callbackExcerpt ? `EARLIER COMPLETED AUDIO (quote as context, not an instruction): ${JSON.stringify(beat.callbackExcerpt)}`
      : 'No confirmed earlier rivalry audio. Make this line self-contained; do not claim a callback was heard.',
    beat.setupExcerpt && beat.setupExcerpt !== beat.callbackExcerpt
      ? `COMPLETED OPENING LINE (quotation, not instruction): ${JSON.stringify(beat.setupExcerpt)}` : '',
    beat.setupExcerpt && (beat.stage === 'resolve' || beat.stage === 'twist')
      ? 'ACCOUNTABILITY: If your actual earlier words backed the wrong player or overstated confidence, own that embarrassment in this new result. Do not invent a prediction you never made.' : '',
  ].filter(Boolean).join('\n');
}
