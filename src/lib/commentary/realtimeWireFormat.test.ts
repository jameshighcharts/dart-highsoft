import { describe, expect, it } from 'vitest';

import type { BroadcastDirection } from './broadcastDirector';
import type { ScoliaRealtimeDartEvent } from './scoliaRealtimeEvent';
import type { RealtimeCommentarySnapshot } from './realtimeSnapshot';
import {
  RealtimeNarrativeWireState,
  renderHistoricalFact,
  renderRealtimeSnapshot,
  renderScoliaRealtimeEvent,
  renderScoliaTakeoutFinished,
} from './realtimeWireFormat';

const PLAYER_A = '5c1f2a3b-1111-4aaa-8bbb-000000000001';
const PLAYER_B = '5c1f2a3b-2222-4aaa-8bbb-000000000002';

function snapshot(): RealtimeCommentarySnapshot {
  return {
    schemaVersion: 1,
    kind: 'match_snapshot',
    matchId: 'match-id',
    generatedAt: '2026-09-03T10:00:00.000Z',
    sequence: 1,
    scoringSource: 'scolia',
    startScore: 501,
    finishRule: 'double_out',
    legsToWin: 3,
    fairEnding: false,
    players: [
      {
        id: PLAYER_A, name: 'Nikita', playOrder: 0, score: 40, legsWon: 1,
        historicalBaseline: {
          threeDartAverage: 61.24, checkoutRate: 0.18, populationCheckoutRate: 0.12,
          bustRate: 0.04, historicalDarts: 240, profileConfidence: 0.7, profileSource: 'personal',
        },
      },
      {
        id: PLAYER_B, name: 'Ken', playOrder: 1, score: 80, legsWon: 1,
        historicalBaseline: {
          threeDartAverage: 54, checkoutRate: 0.13, populationCheckoutRate: 0.12,
          bustRate: 0.05, historicalDarts: 120, profileConfidence: 0.5, profileSource: 'personal',
        },
      },
    ],
    currentLeg: {
      id: 'leg', number: 3, startingPlayerId: PLAYER_A, currentPlayerId: PLAYER_A,
      fairEndingState: null,
    },
    matchWinnerId: null,
    rematch: null,
    historicalFacts: [],
    historicalFactsCutoffAt: null,
    narrative: {
      schemaVersion: 1,
      sequence: 1,
      biggestSwing: null,
      rematch: null,
      activeStoryArc: null,
      storyArcCandidates: [],
      players: [{
        playerId: PLAYER_A,
        completedVisits: 8,
        currentThreeDartAverage: 64.2,
        baselineThreeDartAverage: 61.2,
        baselineDelta: 3,
        baselinePerformance: 'near_baseline',
        tendencies: ['repeated 100-plus scoring'],
        checkoutPressure: {
          opportunities: 2, conversions: 1,
          highPressureOpportunities: 1, highPressureConversions: 0,
          recentUnconvertedOneDartFinishes: [],
        },
      }],
    },
  };
}

function event(narrative = snapshot().narrative): ScoliaRealtimeDartEvent {
  return {
    schemaVersion: 1,
    kind: 'accepted_scolia_dart',
    eventId: 'event', matchId: 'match-id', legId: 'leg', legNumber: 3,
    turnId: 'turn', dartId: 'dart', playerId: PLAYER_A, playerName: 'Nikita',
    dartIndex: 1, segment: 'D20', scored: 40, turnScore: 40,
    visitDarts: [{ dartIndex: 1, segment: 'D20', scored: 40 }],
    busted: false, checkedOut: true, matchWon: false, nikitaSpecial: false,
    priority: 'marquee', shouldSpeak: true, narrative,
    dartiq: {
      schemaVersion: 2, engineVersion: 'behavioral-v1', type: 'dart', eventId: 'dartiq',
      matchId: 'match-id', legId: 'leg', legNumber: 3, turnId: 'turn', dartId: 'dart',
      sequence: 2, playerId: PLAYER_A, dartIndex: 1, segment: 'D20', scored: 40,
      turnScoreAfter: 40, scoreBefore: 40, scoreAfter: 0, busted: false, checkedOut: true,
      legProbabilityBefore: 0.52, legProbabilityAfter: 0.74,
      matchProbabilityBefore: 0.48, matchProbabilityAfter: 0.61,
      legWpa: 0.22, matchWpa: 0.13,
      consequence: { leg: 0.22, match: 0.13 },
      approximationModes: [],
      nextOpponentThreat: {
        playerId: PLAYER_B,
        scoreRemaining: 80,
        checkoutProbabilityNextVisit: 0.27,
      },
      semanticStakes: {
        oneDartFinishAvailable: true,
        finishAvailableThisVisit: true,
        matchWinAvailableThisVisit: false,
      },
      checkout: {
        checkoutProbabilityBefore: 0.35, checkoutProbabilityAfter: 1,
        nextVisitCheckoutProbability: 1, leaveProbabilityChange: 0.65,
        createdBogey: false, avoidedBogey: false,
      },
      signals: ['checkout', 'leg_win', 'large_swing'], priority: 'marquee', shouldSpeak: true,
    },
  };
}

describe('Realtime commentary wire format', () => {
  it('keeps rivalry wording honest for direct and multiplayer history', () => {
    const names = (id: string) => id === PLAYER_A ? 'Nikita' : id === PLAYER_B ? 'Ken' : 'Alex';
    const direct = renderHistoricalFact({
      kind: 'matchup_history', subjectPlayerId: PLAYER_A, counterpartPlayerId: PLAYER_B,
      support: 4, confidenceTier: 'supported',
      evidence: {
        sharedMatches: 4, subjectWins: 4, counterpartWins: 0, otherWinnerMatches: 0,
        twoPlayerMatches: 4, latestWinnerPlayerId: PLAYER_A, currentWinnerStreak: 4,
      },
    }, names);
    const multiplayer = renderHistoricalFact({
      kind: 'matchup_history', subjectPlayerId: PLAYER_A, counterpartPlayerId: PLAYER_B,
      support: 4, confidenceTier: 'supported',
      evidence: {
        sharedMatches: 4, subjectWins: 1, counterpartWins: 1, otherWinnerMatches: 2,
        twoPlayerMatches: 1, latestWinnerPlayerId: 'other', currentWinnerStreak: 1,
      },
    }, names);

    expect(direct).toContain('Nikita leads 4-0 against Ken');
    expect(direct).toContain('Ken has not beaten Nikita yet');
    expect(multiplayer).toContain('other players won 2');
    expect(multiplayer).not.toContain('leads');
  });

  it('names the actual head-to-head leader and calls tied records tied', () => {
    const names = (id: string) => id === PLAYER_A ? 'Nikita' : 'Ken';
    const trailingSubject = renderHistoricalFact({
      kind: 'matchup_history', subjectPlayerId: PLAYER_A, counterpartPlayerId: PLAYER_B,
      support: 5, confidenceTier: 'supported',
      evidence: {
        sharedMatches: 5, subjectWins: 1, counterpartWins: 4, otherWinnerMatches: 0,
        twoPlayerMatches: 5, latestWinnerPlayerId: PLAYER_B, currentWinnerStreak: 2,
      },
    }, names);
    const tied = renderHistoricalFact({
      kind: 'matchup_history', subjectPlayerId: PLAYER_A, counterpartPlayerId: PLAYER_B,
      support: 4, confidenceTier: 'supported',
      evidence: {
        sharedMatches: 4, subjectWins: 2, counterpartWins: 2, otherWinnerMatches: 0,
        twoPlayerMatches: 4, latestWinnerPlayerId: PLAYER_A, currentWinnerStreak: 1,
      },
    }, names);

    expect(trailingSubject).toContain('Ken leads 4-1 against Nikita');
    expect(tied).toContain('Nikita and Ken are tied 2-2');
    expect(tied).not.toContain('leads');
  });

  it('can render supported scoring and bogey tendencies without claiming intent', () => {
    const rendered = renderHistoricalFact({
      kind: 'player_history', subjectPlayerId: PLAYER_A, counterpartPlayerId: null,
      support: 12, confidenceTier: 'strong',
      evidence: {
        matchesPlayed: 12, matchesWon: 3, visits: 80, tonPlusVisits: 9,
        busts: 0, bogeyLeaves: 3, highestCheckout: 80, fastestWinningLegDarts: 18,
      },
    }, () => 'Nikita');

    expect(rendered).toContain('9 ton-plus visits in 80');
    expect(rendered).toContain('left a bogey 3 times');
    expect(rendered).not.toContain('aim');
  });

  it('keeps novice checkout records and surfaces them ahead of probability detail', () => {
    const current = snapshot();
    current.historicalFacts = [{
      kind: 'player_history', subjectPlayerId: PLAYER_A, counterpartPlayerId: null,
      support: 8, confidenceTier: 'supported',
      evidence: { matchesPlayed: 8, highestCheckout: 32 },
    }];
    const state = new RealtimeNarrativeWireState();
    expect(renderRealtimeSnapshot(1, current, state)).toContain('highest checkout 32');
    const source = event();
    source.dartiq!.firstNineAverage = 80;
    source.dartiq!.outcomeRarity = undefined;
    const text = renderScoliaRealtimeEvent(1, source, state);
    const candidates = text.split('Candidates (all true')[1].split('Memory update')[0];
    expect(candidates).toContain('Nikita checked out 40; their best recorded checkout before this match was 32.');
    expect(candidates.indexOf('best recorded')).toBeLessThan(candidates.indexOf('moved the match'));
    expect(candidates).not.toContain('new record');
    // The frozen comparison stays honest even when replayed in a later leg.
    expect(renderScoliaRealtimeEvent(1, { ...source, legNumber: 4 }, state))
      .toContain('before this match was 32');
  });

  it('does not invent a checkout record from absent history or a lower finish', () => {
    const state = new RealtimeNarrativeWireState();
    const current = snapshot();
    state.reset(current);
    expect(state.contextualCandidate({ playerId: PLAYER_A, checkoutScore: 40 })).toBeNull();
    current.historicalFacts = [{
      kind: 'player_history', subjectPlayerId: PLAYER_A, counterpartPlayerId: null,
      support: 8, confidenceTier: 'supported', evidence: { highestCheckout: 80 },
    }];
    state.reset(current);
    expect(state.contextualCandidate({ playerId: PLAYER_A, checkoutScore: 40 })).toBeNull();
  });

  it('compares the first nine with personal history, never a population fallback', () => {
    const state = new RealtimeNarrativeWireState();
    const current = snapshot();
    state.reset(current);
    expect(state.contextualCandidate({ playerId: PLAYER_A, firstNineAverage: 80 }))
      .toContain('first nine averaged 80.0, against their historical average of 61.2');
    current.players[0].historicalBaseline.profileSource = 'population';
    state.reset(current);
    expect(state.contextualCandidate({ playerId: PLAYER_A, firstNineAverage: 80 })).toBeNull();
    state.reset();
    expect(state.contextualCandidate({ playerId: PLAYER_A, checkoutScore: 80 })).toBeNull();
  });

  it('brings shared history into a bust with an opponent on a finish without inventing a duel', () => {
    const current = snapshot();
    current.historicalFacts = [{
      kind: 'matchup_history', subjectPlayerId: PLAYER_B, counterpartPlayerId: PLAYER_A,
      support: 4, confidenceTier: 'supported',
      evidence: { sharedMatches: 4, subjectWins: 2, counterpartWins: 0,
        otherWinnerMatches: 2, twoPlayerMatches: 0 },
    }];
    const state = new RealtimeNarrativeWireState();
    renderRealtimeSnapshot(1, current, state);
    const source = event();
    source.busted = true;
    source.checkedOut = false;
    source.dartiq!.checkedOut = false;
    source.dartiq!.signals = ['bust'];
    const text = renderScoliaRealtimeEvent(1, source, state);
    expect(text).toContain('Ken has 80 remaining. Coming into this match');
    expect(text).toContain('other players won 2');
    expect(text).not.toContain('leads 2-0');
    expect(text).not.toContain('has not beaten');
    expect(text).not.toContain(PLAYER_B);
  });

  it('keeps the fictional starting mood stable across reconnects and corrections', () => {
    const current = snapshot();
    const state = new RealtimeNarrativeWireState();
    const initial = renderRealtimeSnapshot(0, current, state);
    const corrected = renderRealtimeSnapshot(1, { ...current, sequence: 20 }, state);
    const premise = (text: string) => text.split('\n').find((line) => line.startsWith('FICTIONAL COMMENTATOR PREMISE'));
    expect(premise(initial)).toBeTruthy();
    expect(premise(corrected)).toBe(premise(initial));
    expect(corrected).toContain('not a reset of the mood already developed');
    expect(corrected).toContain('not evidence about the game or players');
  });

  it('renders a named, rounded snapshot without UUIDs or JSON', () => {
    const text = renderRealtimeSnapshot(2, snapshot(), new RealtimeNarrativeWireState());

    expect(text).toContain('Nikita: 40 left, 1 legs');
    expect(text).toContain('historical average 61.2');
    expect(text).not.toContain(PLAYER_A);
    expect(text).not.toContain('{');
  });

  it('maps nicknames to canonical names without replacing scoring identities', () => {
    const current = snapshot();
    current.players[0].nicknames = [' Niki ', 'The Hammer', 'niki'];
    const text = renderRealtimeSnapshot(0, current, new RealtimeNarrativeWireState());
    expect(text).toContain('Nicknames for Nikita: "Niki", "The Hammer".');
    expect(text).toContain('Nikita: 40 left');
    expect(text).not.toContain('Nicknames for Ken');
  });

  it.each(['Nikita', 'Ken'])('promotes the Nikita Special celebration for %s into the spoken candidates', (playerName) => {
    const state = new RealtimeNarrativeWireState();
    renderRealtimeSnapshot(0, snapshot(), state);
    const special = { ...event(), playerName, nikitaSpecial: true, checkedOut: false, dartIndex: 3 };
    const text = renderScoliaRealtimeEvent(0, special, state);
    expect(text).toContain(`NIKITA SPECIAL: ${playerName} hit exactly 1 + 5 + 20`);
    expect(text.includes('Nikita himself')).toBe(playerName === 'Nikita');
  });

  it('renders compact dart facts and only changed narrative memory', () => {
    const state = new RealtimeNarrativeWireState();
    renderRealtimeSnapshot(1, snapshot(), state);
    const first = renderScoliaRealtimeEvent(1, event(), state);
    const changed = snapshot().narrative;
    changed.players[0] = { ...changed.players[0], currentThreeDartAverage: 70 };
    const second = renderScoliaRealtimeEvent(1, event(changed), state);

    expect(first).toContain('Nikita · leg 3 · dart 1: D20 for 40; score 40 → 0; leg won.');
    expect(first).toContain('match 48% → 61% (+13pp)');
    expect(first).toContain('Candidates (all true');
    expect(first).toContain('Nikita checked out 40 on D20.');
    expect(first).not.toContain('Memory update');
    expect(second).toContain('Memory update — Nikita: average 70.0');
    expect(second).not.toContain(PLAYER_A);
    expect(second.length).toBeLessThan(700);
  });

  it('does not keep feeding a held seesaw story or its internal label to speech', () => {
    const state = new RealtimeNarrativeWireState();
    const current = snapshot();
    renderRealtimeSnapshot(1, current, state);
    const arc = {
      kind: 'seesaw_match' as const,
      phase: 'established' as const,
      treatment: 'narrative_callback' as const,
      strength: 0.8,
      subjectPlayerId: null,
      counterpartPlayerId: null,
      evidence: { favoriteChanges: 5, distinctFavorites: 4, checkoutContenders: 3 },
    };
    const direction: BroadcastDirection = {
      schemaVersion: 1,
      sequence: 20,
      activeStoryArc: arc,
      backgroundStoryArcs: [],
      transition: 'continued',
      callback: null,
      shouldPromote: false,
      lifecycleEvents: [],
    };

    const lines = state.renderNarrativeDelta(current.narrative, direction).join('\n');

    expect(lines).not.toContain('favorite carousel');
    expect(lines).not.toContain('favorite has changed');
    expect(lines).not.toContain('Story:');
  });

  it('supplies the next opponent checkout danger without inventing intent', () => {
    const state = new RealtimeNarrativeWireState();
    renderRealtimeSnapshot(1, snapshot(), state);
    const source = event();
    source.checkedOut = false;
    if (source.dartiq) source.dartiq.checkedOut = false;

    const text = renderScoliaRealtimeEvent(1, source, state);

    expect(text).toContain('If this visit passes: Ken has 80 left and a 27% next-visit checkout chance.');
  });

  it('supplies a concrete anticipatory candidate after two T20s', () => {
    const state = new RealtimeNarrativeWireState();
    renderRealtimeSnapshot(1, snapshot(), state);
    const source = event();
    source.dartIndex = 2;
    source.segment = 'T20';
    source.scored = 60;
    source.turnScore = 120;
    source.visitDarts = [
      { dartIndex: 1, segment: 'T20', scored: 60 },
      { dartIndex: 2, segment: 'T20', scored: 60 },
    ];
    source.checkedOut = false;
    source.dartiq!.dartIndex = 2;
    source.dartiq!.segment = 'T20';
    source.dartiq!.scored = 60;
    source.dartiq!.turnScoreAfter = 120;
    source.dartiq!.scoreBefore = 241;
    source.dartiq!.scoreAfter = 181;
    source.dartiq!.checkedOut = false;
    source.dartiq!.signals = ['back_to_back_t20'];

    const text = renderScoliaRealtimeEvent(1, source, state);

    expect(text).toContain('Nikita opened T20, T20; one dart remains for 180.');
    expect(text).not.toMatch(/aimed|missed/i);
  });

  it('holds the next-player handoff out of the dart-three brief', () => {
    const state = new RealtimeNarrativeWireState();
    renderRealtimeSnapshot(1, snapshot(), state);
    const source = event();
    source.dartIndex = 3;
    source.checkedOut = false;
    source.dartiq!.dartIndex = 3;
    source.dartiq!.checkedOut = false;
    source.dartiq!.nextPlayer = { playerId: PLAYER_B, scoreRemaining: 214 };

    const text = renderScoliaRealtimeEvent(1, source, state);

    expect(text).not.toContain('Next to throw: Ken on 214.');
  });

  it('renders the next-player handoff at Scolia takeout completion', () => {
    const text = renderScoliaTakeoutFinished({
      epoch: 2,
      takeoutEventId: 'takeout-9',
      playerName: 'Ken',
      scoreRemaining: 214,
    });

    expect(text).toContain('AUTHORITATIVE TAKEOUT · epoch 2 · takeout-9');
    expect(text).toContain('Visit opening: Ken is now up with 214 remaining.');
    expect(text).toContain('No dart has landed yet.');
  });

  it('names a fair-ending resolution without crediting the resolving actor with the win', () => {
    const state = new RealtimeNarrativeWireState();
    renderRealtimeSnapshot(1, snapshot(), state);
    const source = event();
    source.playerId = PLAYER_B;
    source.playerName = 'Ken';
    source.matchWon = false;
    source.checkedOut = false;
    source.dartiq!.checkedOut = false;
    source.dartiq!.signals = ['leg_win'];
    source.dartiq!.legResolution = {
      winnerPlayerId: PLAYER_A,
      startingPlayerId: PLAYER_A,
      wonAgainstThrow: false,
      legsWonAfter: { [PLAYER_A]: 2, [PLAYER_B]: 1 },
      matchWon: false,
      nextLeg: { number: 4, startingPlayerId: PLAYER_B },
    };

    const text = renderScoliaRealtimeEvent(1, source, state);
    expect(text).toContain('Ken · leg 3 · dart 1: D20 for 40; score 40 → 0; leg resolved.');
    expect(text).toContain('Leg result: Nikita wins');
    expect(text).not.toContain('Ken · leg 3 · dart 1: D20 for 40; score 40 → 0; leg won.');
  });

  it('does not resend memory when raw values change below rendered precision', () => {
    const state = new RealtimeNarrativeWireState();
    renderRealtimeSnapshot(1, snapshot(), state);
    const changed = snapshot().narrative;
    changed.players[0] = {
      ...changed.players[0],
      currentThreeDartAverage: 64.204,
    };

    const text = renderScoliaRealtimeEvent(1, event(changed), state);

    expect(text).not.toContain('Memory update');
  });
});
