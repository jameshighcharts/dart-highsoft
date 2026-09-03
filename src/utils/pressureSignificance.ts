export type PressureProbabilityPoint = {
  id: string;
  legWinProbability: number;
  matchWinProbability: number;
};

export type PressureConsequence = {
  leg: number;
  match: number;
};

export function calculateProbabilityVectorConsequence(
  before: PressureProbabilityPoint[],
  after: PressureProbabilityPoint[]
): PressureConsequence {
  const beforeById = new Map(before.map((player) => [player.id, player]));
  const afterById = new Map(after.map((player) => [player.id, player]));
  const playerIds = new Set([...beforeById.keys(), ...afterById.keys()]);
  let leg = 0;
  let match = 0;
  for (const playerId of playerIds) {
    const previous = beforeById.get(playerId);
    const next = afterById.get(playerId);
    leg += Math.abs((next?.legWinProbability ?? 0) - (previous?.legWinProbability ?? 0));
    match += Math.abs((next?.matchWinProbability ?? 0) - (previous?.matchWinProbability ?? 0));
  }
  return { leg: leg / 2, match: match / 2 };
}
