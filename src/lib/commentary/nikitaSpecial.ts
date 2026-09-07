/** Identity comes from the canonical display name, never a nickname or substring. */
export function nikitaSpecialMoment(playerName: string) {
  const namesake = /^nikita(?:\s|$)/i.test(playerName.trim());
  return `NIKITA SPECIAL: ${playerName} hit exactly 1 + 5 + 20, in any order: 26 points. ${namesake
    ? 'Nikita himself has hit his namesake special. This is the signature moment: maximum affectionate disbelief and absurd stadium-level celebration for the man delivering his own special.'
    : 'Celebrate the office cult classic with wildly disproportionate joy and affectionate ridicule; make those 26 points feel like a trophy moment.'} Say “Nikita Special” aloud. This is a comic celebration, not a scoring record or a claim that the match is won.`;
}
