import type {
  DartIQDartsLeft,
  DartIQOutcomeModel,
} from './outcomes';
import type { FinishRule } from '@/utils/x01';

export type DartIQVisitState = {
  visitStartScore: number;
  currentScore: number;
  dartsLeft: DartIQDartsLeft;
  finishRule: FinishRule;
};

export type DartIQVisitDistribution = Map<number, number>;

function addProbability(distribution: DartIQVisitDistribution, score: number, probability: number) {
  distribution.set(score, (distribution.get(score) ?? 0) + probability);
}

function normalize(distribution: DartIQVisitDistribution) {
  const total = [...distribution.values()].reduce((sum, probability) => sum + probability, 0);
  if (!(total > 0)) return new Map([[0, 1]]);
  return new Map(
    [...distribution.entries()]
      .filter(([, probability]) => probability > 0)
      .map(([score, probability]) => [score, probability / total])
  );
}

export function solveDartIQVisit(
  model: DartIQOutcomeModel,
  state: DartIQVisitState
): DartIQVisitDistribution {
  if (state.currentScore <= 0) return new Map([[0, 1]]);
  let active: DartIQVisitDistribution = new Map([[state.currentScore, 1]]);
  const result: DartIQVisitDistribution = new Map();

  for (let dartsLeft = state.dartsLeft; dartsLeft >= 1; dartsLeft -= 1) {
    const nextActive: DartIQVisitDistribution = new Map();
    for (const [currentScore, stateProbability] of active) {
      const distribution = model.distribution({
        currentScore,
        dartsLeft: dartsLeft as DartIQDartsLeft,
        finishRule: state.finishRule,
      });
      for (const outcome of distribution.outcomes) {
        if (!(outcome.probability > 0)) continue;
        const probability = stateProbability * outcome.probability;
        const nextScore = currentScore - outcome.scoreDelta;
        const busted = nextScore < 0
          || (state.finishRule === 'double_out' && nextScore === 1)
          || (state.finishRule === 'double_out' && nextScore === 0 && !outcome.isDouble);
        if (busted) {
          addProbability(result, state.visitStartScore, probability);
        } else if (nextScore === 0 || dartsLeft === 1) {
          addProbability(result, nextScore, probability);
        } else {
          addProbability(nextActive, nextScore, probability);
        }
      }
    }
    active = nextActive;
    if (active.size === 0) break;
  }

  return normalize(result);
}

export function createDartIQVisitKernel(
  model: DartIQOutcomeModel,
  finishRule: FinishRule,
  maximumScore = 501
) {
  const kernel = new Map<number, DartIQVisitDistribution>();
  for (let score = 1; score <= maximumScore; score += 1) {
    kernel.set(score, solveDartIQVisit(model, {
      visitStartScore: score,
      currentScore: score,
      dartsLeft: 3,
      finishRule,
    }));
  }
  kernel.set(0, new Map([[0, 1]]));
  return kernel;
}
