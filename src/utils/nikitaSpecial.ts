/** Exact 1 + 5 + 20 three-dart visit, in any order. */
export function isNikitaSpecial(darts: readonly { scored: number }[]): boolean {
  if (darts.length !== 3) return false;
  const scores = darts.map((dart) => dart.scored).toSorted((left, right) => left - right);
  return scores[0] === 1 && scores[1] === 5 && scores[2] === 20;
}
