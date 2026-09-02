import { describe, expect, it } from 'vitest';

import type { CommentaryPayload, CommentaryPersona } from './types';
import { buildCommentaryPrompt } from './promptBuilder';

const persona: CommentaryPersona = {
  id: 'test',
  label: 'Test',
  systemPrompt: 'Test commentator',
  avatar: '',
  description: '',
  thinkingLabel: '',
  style: {
    slangUseProbability: 0,
    maxSlangPerLine: 0,
    plainLineProbability: 1,
    maxWords: 30,
  },
};

function payload(): CommentaryPayload {
  return {
    playerName: 'Ken',
    playerId: 'a',
    totalScore: 100,
    remainingScore: 201,
    throws: [{ segment: 'T20', scored: 60, dart_index: 1 }],
    busted: false,
    isHighScore: true,
    is180: false,
    gameContext: {
      startScore: 301,
      legsToWin: 3,
      currentLegNumber: 2,
      overallTurnNumber: 4,
      playerTurnNumber: 2,
      dartsUsedThisTurn: 3,
      playerAverage: 75,
      playerLegsWon: 1,
      playerRecentTurns: [],
      allPlayers: [],
      isLeading: true,
      positionInMatch: 1,
      pointsBehindLeader: 0,
    },
  };
}

describe('buildCommentaryPrompt pressure context', () => {
  it('bypasses a generic plain line for a significant pressure swing', () => {
    const input = payload();
    input.pressure = {
      matchProbabilityBefore: 0.34,
      matchProbabilityAfter: 0.51,
      matchWpa: 0.17,
      legProbabilityBefore: 0.42,
      legProbabilityAfter: 0.7,
      legWpa: 0.28,
      biggestDartMatchWpa: 0.12,
      peakMatchLeverage: 0.72,
      peakPressureIndex: 0.78,
      changedMatchFavorite: true,
      checkedOut: false,
      busted: false,
      setupQuality: 0.94,
      setupGrade: 'good',
      nextVisitCheckoutProbability: 0.31,
      createdBogey: false,
    };

    const result = buildCommentaryPrompt(input, { persona, random: () => 0 });
    expect(result.plainLine).toBeUndefined();
    expect(result.prompt).toContain('Match win chance 34% → 51% (+17pp)');
    expect(result.prompt).toContain('This visit changed the match favorite');
    expect(result.prompt).toContain('Peak pre-dart pressure index: 78/100');
    expect(result.prompt).toContain('Setup quality: good (94/100)');
    expect(result.prompt).toContain('call the result clutch only when the player gained probability');
  });

  it('retains cheap plain commentary for ordinary low-impact turns', () => {
    const result = buildCommentaryPrompt(payload(), { persona, random: () => 0 });
    expect(result.plainLine).toBe('Ken scores 100; 201 left.');
    expect(result.prompt).toBeUndefined();
  });

  it('names the Nikita special instead of falling through to ordinary 26 commentary', () => {
    const input = payload();
    input.totalScore = 26;
    input.isHighScore = false;
    input.isNikitaSpecial = true;
    input.throws = [
      { segment: 'S1', scored: 1, dart_index: 1 },
      { segment: 'S5', scored: 5, dart_index: 2 },
      { segment: 'S20', scored: 20, dart_index: 3 },
    ];

    const result = buildCommentaryPrompt(input, { persona, random: () => 0 });
    expect(result.plainLine).toBeUndefined();
    expect(result.prompt).toContain('NIKITA SPECIAL');
    expect(result.prompt).toContain('celebrate the exact 1, 5, 20 visit by name');
  });
});
