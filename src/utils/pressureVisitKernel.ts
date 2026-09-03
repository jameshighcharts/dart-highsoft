import type {
  PressureDartsLeft,
  PressureOutcomeModel,
} from './pressureOutcomeModel.ts';
import type { FinishRule } from './x01.ts';

export type PressureVisitState = {
  visitStartScore: number;
  currentScore: number;
  dartsLeft: PressureDartsLeft;
  finishRule: FinishRule;
};

export type PressureVisitDistribution = Map<number, number>;

function addProbability(distribution: PressureVisitDistribution, score: number, probability: number) {
  distribution.set(score, (distribution.get(score) ?? 0) + probability);
}

function normalize(distribution: PressureVisitDistribution) {
  const total = [...distribution.values()].reduce((sum, probability) => sum + probability, 0);
  if (!(total > 0)) return new Map([[0, 1]]);
  return new Map(
    [...distribution.entries()]
      .filter(([, probability]) => probability > 0)
      .map(([score, probability]) => [score, probability / total])
  );
}

export function solvePressureVisit(
  model: PressureOutcomeModel,
  state: PressureVisitState
): PressureVisitDistribution {
  if (state.currentScore <= 0) return new Map([[0, 1]]);
  let active: PressureVisitDistribution = new Map([[state.currentScore, 1]]);
  const result: PressureVisitDistribution = new Map();

  for (let dartsLeft = state.dartsLeft; dartsLeft >= 1; dartsLeft -= 1) {
    const nextActive: PressureVisitDistribution = new Map();
    for (const [currentScore, stateProbability] of active) {
      const distribution = model.distribution({
        currentScore,
        dartsLeft: dartsLeft as PressureDartsLeft,
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

export function createPressureVisitKernel(
  model: PressureOutcomeModel,
  finishRule: FinishRule,
  maximumScore = 501
) {
  const kernel = new Map<number, PressureVisitDistribution>();
  for (let score = 1; score <= maximumScore; score += 1) {
    kernel.set(score, solvePressureVisit(model, {
      visitStartScore: score,
      currentScore: score,
      dartsLeft: 3,
      finishRule,
    }));
  }
  kernel.set(0, new Map([[0, 1]]));
  return kernel;
}
