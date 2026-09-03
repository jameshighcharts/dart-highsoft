// Display metadata and config field schema per game mode. Client-only; drives
// the New Match option controls and labels around the app.

import type { GameMode } from './types';

export type ConfigField =
  | { key: string; label: string; help?: string; kind: 'select'; options: { value: string; label: string }[] }
  | { key: string; label: string; help?: string; kind: 'stepper'; min: number; max: number; step?: number; nullable?: boolean; nullLabel?: string }
  | { key: string; label: string; help?: string; kind: 'switch' };

export type GameModeInfo = {
  mode: GameMode;
  name: string;
  shortName: string;
  tagline: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  fields: ConfigField[];
  defaults: Record<string, unknown>;
};

export const GAME_MODE_INFO: Record<GameMode, GameModeInfo> = {
  cricket: {
    mode: 'cricket',
    name: 'Cricket',
    shortName: 'Cricket',
    tagline: 'Close 15 to 20 and Bull, score while opponents are open.',
    description:
      'Hit each of 15, 16, 17, 18, 19, 20 and Bull three times to close it. Extra hits on a number you own score points until everyone has closed it. Close everything with the most points to win.',
    minPlayers: 2,
    maxPlayers: 8,
    fields: [
      {
        key: 'variant',
        label: 'Variant',
        kind: 'select',
        options: [
          { value: 'standard', label: 'Standard (points to you)' },
          { value: 'cut_throat', label: 'Cut-throat (points to opponents, lowest wins)' },
        ],
      },
      { key: 'maxRounds', label: 'Max rounds', kind: 'stepper', min: 5, max: 50, nullable: true, nullLabel: 'Unlimited', help: 'Highest points wins when the limit is reached.' },
    ],
    defaults: { variant: 'standard', maxRounds: 20 },
  },
  killer: {
    mode: 'killer',
    name: 'Killer',
    shortName: 'Killer',
    tagline: 'Own a number, become a killer, take lives. Last one standing wins.',
    description:
      'Every player gets a number. Hit your own double to become a killer, then hit opponents’ doubles to take their lives. Lose all your lives and you are out.',
    minPlayers: 2,
    maxPlayers: 20,
    fields: [
      { key: 'lives', label: 'Lives', kind: 'stepper', min: 1, max: 5 },
      {
        key: 'killerRequirement',
        label: 'Become a killer with',
        kind: 'select',
        options: [
          { value: 'double', label: 'Double of your number' },
          { value: 'any', label: 'Any hit on your number' },
        ],
      },
      {
        key: 'hitToKill',
        label: 'Take a life with',
        kind: 'select',
        options: [
          { value: 'double', label: 'Double of their number' },
          { value: 'any', label: 'Any hit on their number' },
        ],
      },
      { key: 'selfHitPenalty', label: 'Killers lose a life on their own number', kind: 'switch' },
      {
        key: 'assignment',
        label: 'Numbers',
        kind: 'select',
        options: [
          { value: 'random', label: 'Assigned randomly' },
          { value: 'choose', label: 'Players choose' },
        ],
      },
    ],
    defaults: { lives: 3, killerRequirement: 'double', hitToKill: 'double', selfHitPenalty: true, assignment: 'random', assignedNumbers: {} },
  },
  shanghai: {
    mode: 'shanghai',
    name: 'Shanghai',
    shortName: 'Shanghai',
    tagline: 'One target per round. Single, double and treble in one turn wins instantly.',
    description:
      'Each round has a target number. Only hits on the target score: single, double or treble value. Hit all three in one turn for a Shanghai and win on the spot; otherwise the highest total after the last round wins.',
    minPlayers: 1,
    maxPlayers: 8,
    fields: [
      {
        key: 'rounds',
        label: 'Rounds',
        kind: 'select',
        options: [
          { value: '7', label: '7 rounds (1 to 7)' },
          { value: '20', label: '20 rounds (1 to 20)' },
        ],
      },
      { key: 'startNumber', label: 'Start number', kind: 'stepper', min: 1, max: 20 },
    ],
    defaults: { rounds: 7, startNumber: 1 },
  },
  around_the_clock: {
    mode: 'around_the_clock',
    name: 'Around the Clock',
    shortName: 'Clock',
    tagline: 'Race from 1 to 20 and finish on Bull.',
    description:
      'Hit every number in order from 1 to 20, then Bull. Any part of the number counts. First player to finish wins.',
    minPlayers: 1,
    maxPlayers: 8,
    fields: [
      { key: 'includeBull', label: 'Finish on Bull', kind: 'switch' },
      {
        key: 'bullRequirement',
        label: 'Bull counts with',
        kind: 'select',
        options: [
          { value: 'any', label: 'Outer or inner bull' },
          { value: 'double', label: 'Inner bull only' },
        ],
      },
      { key: 'skipOnDoubleTreble', label: 'Doubles skip 2, trebles skip 3', kind: 'switch' },
      { key: 'fairFinish', label: 'Fair finish (round completes, fewest darts wins)', kind: 'switch' },
    ],
    defaults: { includeBull: true, bullRequirement: 'any', skipOnDoubleTreble: false, fairFinish: false },
  },
};

export const GAME_MODE_ORDER: GameMode[] = ['cricket', 'killer', 'shanghai', 'around_the_clock'];

export function gameModeName(mode: string): string {
  return (GAME_MODE_INFO as Record<string, GameModeInfo | undefined>)[mode]?.name ?? mode;
}

/** Human label for a segment such as T20 → "Treble 20". */
export function describeSegment(segment: string): string {
  if (segment === 'Miss') return 'Miss';
  if (segment === 'SB' || segment === 'OuterBull') return 'Outer Bull';
  if (segment === 'DB' || segment === 'InnerBull') return 'Bull';
  const match = segment.match(/^([SDT])(\d{1,2})$/);
  if (!match) return segment;
  const prefix = match[1] === 'S' ? 'Single' : match[1] === 'D' ? 'Double' : 'Treble';
  return `${prefix} ${match[2]}`;
}
