import type { PressureConsequence } from './pressureSignificance.ts';

export const PRESSURE_POLICY_VERSION = 'broadcast-1' as const;

export function pressureConsequenceFloors(playerCount: number) {
  if (playerCount <= 2) return { leg: 0.08, match: 0.04 } as const;
  if (playerCount <= 4) return { leg: 0.06, match: 0.03 } as const;
  return { leg: 0.04, match: 0.02 } as const;
}

export function isMaterialPressureConsequence(
  consequence: PressureConsequence,
  playerCount: number
) {
  const floor = pressureConsequenceFloors(playerCount);
  return consequence.leg >= floor.leg || consequence.match >= floor.match;
}
