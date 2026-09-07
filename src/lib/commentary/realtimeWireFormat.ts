import { commentaryStartingMood, renderPlayerNicknames, nikitaSpecialMoment } from './personas.ts';
import type { CommentaryContext } from '@/services/commentaryService';
import type { DartIQHistoricalFact } from '@/lib/dartiq/evidence';
import type { BroadcastDirection } from './broadcastDirector.ts';
import type { CommentaryNarrativeMemory, CommentaryPlayerNarrative } from './commentaryNarrative.ts';
import type { RealtimeCommentarySnapshot } from './realtimeSnapshot.ts';
import type { ScoliaRealtimeDartEvent } from './scoliaRealtimeEvent.ts';

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
  private readonly names = new Map<string, string>();
  private readonly playerFingerprints = new Map<string, string>();
  private storyFingerprint = '';
  private historicalFacts: readonly DartIQHistoricalFact[] = [];
  private readonly personalBaselines = new Map<string, number>();

  reset(snapshot?: RealtimeCommentarySnapshot) {
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
  const history = historicalFactLines(snapshot.historicalFacts, state);
  return [
    `AUTHORITATIVE MATCH SNAPSHOT · epoch ${epoch}`,
    `Rules: ${rules}; fair ending ${snapshot.fairEnding ? 'on' : 'off'}.`,
    ...players,
    renderPlayerNicknames(snapshot.players),
    current,
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
    'The previous player has removed the darts; the board is clear.',
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
  ].filter(Boolean).join('\n');
}
