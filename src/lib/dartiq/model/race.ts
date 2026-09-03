import type { DartIQVisitDistribution } from './visit';

export type DartIQVisitKernel = Map<number, DartIQVisitDistribution>;

export type DartIQFirstFinishPmf = {
  /** Index zero is the player's first upcoming visit. */
  probabilities: number[];
  truncatedMass: number;
};

export type DartIQRaceResult = {
  probabilities: number[];
  approximationMode: 'exact' | 'truncated-tail' | 'no-finish-fallback';
};

function addMass(distribution: DartIQVisitDistribution, score: number, probability: number) {
  distribution.set(score, (distribution.get(score) ?? 0) + probability);
}

function advanceVisit(
  survivors: DartIQVisitDistribution,
  kernel: DartIQVisitKernel
) {
  const next: DartIQVisitDistribution = new Map();
  let finished = 0;
  for (const [score, stateProbability] of survivors) {
    const transitions = kernel.get(score);
    if (!transitions) {
      throw new Error(`Missing DartIQ visit-kernel state for score ${score}`);
    }
    for (const [nextScore, transitionProbability] of transitions) {
      const probability = stateProbability * transitionProbability;
      if (nextScore === 0) finished += probability;
      else addMass(next, nextScore, probability);
    }
  }
  return { survivors: next, finished };
}

export function createFirstFinishPmf(input: {
  startScore: number;
  kernel: DartIQVisitKernel;
  firstVisit?: DartIQVisitDistribution;
  maximumVisits?: number;
  tailTolerance?: number;
}): DartIQFirstFinishPmf {
  if (input.startScore <= 0) return { probabilities: [1], truncatedMass: 0 };
  const maximumVisits = Math.max(1, input.maximumVisits ?? 120);
  const tailTolerance = Math.max(0, input.tailTolerance ?? 1e-10);
  const probabilities: number[] = [];
  let survivors: DartIQVisitDistribution = new Map([[input.startScore, 1]]);

  for (let visit = 0; visit < maximumVisits; visit += 1) {
    let advanced: ReturnType<typeof advanceVisit>;
    if (visit === 0 && input.firstVisit) {
      const next: DartIQVisitDistribution = new Map();
      let finished = 0;
      for (const [score, probability] of input.firstVisit) {
        if (score === 0) finished += probability;
        else addMass(next, score, probability);
      }
      advanced = { survivors: next, finished };
    } else {
      advanced = advanceVisit(survivors, input.kernel);
    }
    probabilities.push(advanced.finished);
    survivors = advanced.survivors;
    const remaining = [...survivors.values()].reduce((sum, probability) => sum + probability, 0);
    if (remaining <= tailTolerance) return { probabilities, truncatedMass: remaining };
  }

  return {
    probabilities,
    truncatedMass: [...survivors.values()].reduce((sum, probability) => sum + probability, 0),
  };
}

function cumulative(pmf: number[], maximumVisits: number) {
  const result = new Array<number>(maximumVisits).fill(0);
  let total = 0;
  for (let index = 0; index < maximumVisits; index += 1) {
    total += pmf[index] ?? 0;
    result[index] = Math.min(1, Math.max(0, total));
  }
  return result;
}

export function combineOrderedFirstFinishPmfs(
  pmfs: DartIQFirstFinishPmf[]
): DartIQRaceResult {
  if (pmfs.length === 0) return { probabilities: [], approximationMode: 'exact' };
  if (pmfs.length === 1) return { probabilities: [1], approximationMode: 'exact' };
  const maximumVisits = Math.max(...pmfs.map((pmf) => pmf.probabilities.length));
  const wins = pmfs.map(() => 0);
  const cdfs = pmfs.map((pmf) => cumulative(pmf.probabilities, maximumVisits));

  for (let visitIndex = 0; visitIndex < maximumVisits; visitIndex += 1) {
    const surviveThroughVisit = cdfs.map((cdf) => 1 - (cdf[visitIndex] ?? 0));
    const survivePreviousVisits = cdfs.map((cdf) =>
      1 - (visitIndex > 0 ? cdf[visitIndex - 1] ?? 0 : 0)
    );
    const before = new Array<number>(pmfs.length).fill(1);
    const after = new Array<number>(pmfs.length).fill(1);
    for (let index = 1; index < pmfs.length; index += 1) {
      before[index] = before[index - 1] * surviveThroughVisit[index - 1];
    }
    for (let index = pmfs.length - 2; index >= 0; index -= 1) {
      after[index] = after[index + 1] * survivePreviousVisits[index + 1];
    }

    for (let playerIndex = 0; playerIndex < pmfs.length; playerIndex += 1) {
      const finish = pmfs[playerIndex].probabilities[visitIndex] ?? 0;
      if (!(finish > 0)) continue;
      wins[playerIndex] += finish * before[playerIndex] * after[playerIndex];
    }
  }

  const total = wins.reduce((sum, probability) => sum + probability, 0);
  if (!(total > 0)) {
    return {
      probabilities: wins.map(() => 1 / wins.length),
      approximationMode: 'no-finish-fallback',
    };
  }
  const hasTruncatedTail = pmfs.some((pmf) => pmf.truncatedMass > 1e-10);
  return {
    probabilities: wins.map((probability) => probability / total),
    approximationMode: hasTruncatedTail ? 'truncated-tail' : 'exact',
  };
}

export function combineCurrentLegWithMatch(input: {
  currentLegProbabilities: number[];
  legsWon: number[];
  legsToWin: number;
  nextStarterIndex: number;
  futureLegProbabilitiesByStarter: number[][];
  maximumStates?: number;
}): DartIQRaceResult {
  const playerCount = input.legsWon.length;
  if (playerCount === 0) return { probabilities: [], approximationMode: 'exact' };
  const maximumStates = input.maximumStates ?? 10_000;
  const memo = new Map<string, number[]>();
  const estimatedStates = Math.pow(input.legsToWin, playerCount) * playerCount;
  const forceBounded = !Number.isFinite(estimatedStates) || estimatedStates > maximumStates;
  let bounded = forceBounded;

  function solve(legsWon: number[], starterIndex: number): number[] {
    const winner = legsWon.findIndex((wins) => wins >= input.legsToWin);
    if (winner >= 0) return legsWon.map((_, index) => index === winner ? 1 : 0);
    const key = `${starterIndex}:${legsWon.join(':')}`;
    const cached = memo.get(key);
    if (cached) return cached;
    if (forceBounded || memo.size >= maximumStates) {
      bounded = true;
      const weights = legsWon.map((wins, index) => {
        const legChance = input.futureLegProbabilitiesByStarter[starterIndex]?.[index]
          ?? 1 / playerCount;
        return Math.pow(Math.max(1e-9, legChance), Math.max(1, input.legsToWin - wins));
      });
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      return weights.map((weight) => weight / total);
    }

    const legProbabilities = input.futureLegProbabilitiesByStarter[starterIndex]
      ?? legsWon.map(() => 1 / playerCount);
    const result = legsWon.map(() => 0);
    for (let legWinner = 0; legWinner < playerCount; legWinner += 1) {
      const next = legsWon.slice();
      next[legWinner] += 1;
      const continuation = solve(next, (starterIndex + 1) % playerCount);
      for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
        result[playerIndex] += (legProbabilities[legWinner] ?? 0) * continuation[playerIndex];
      }
    }
    memo.set(key, result);
    return result;
  }

  const match = input.legsWon.map(() => 0);
  for (let legWinner = 0; legWinner < playerCount; legWinner += 1) {
    const afterLeg = input.legsWon.slice();
    afterLeg[legWinner] += 1;
    const continuation = solve(afterLeg, input.nextStarterIndex % playerCount);
    for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
      match[playerIndex] += (input.currentLegProbabilities[legWinner] ?? 0)
        * continuation[playerIndex];
    }
  }

  const total = match.reduce((sum, probability) => sum + probability, 0);
  return {
    probabilities: total > 0
      ? match.map((probability) => probability / total)
      : match.map(() => 1 / playerCount),
    approximationMode: bounded ? 'truncated-tail' : 'exact',
  };
}
