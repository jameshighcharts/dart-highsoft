import { describe, expect, it } from 'vitest';

import { createBehavioralOutcomeModel } from './model/outcomes';
import {
  estimateCheckoutProbability,
  evaluateDartSetup,
  isBogeyLeave,
} from './checkout';

describe('DartIQ checkout', () => {
  it('sums behavioral finish paths from the actual live visit state', () => {
    const double16 = estimateCheckoutProbability({
      visitStartScore: 32, scoreRemaining: 32, dartsRemaining: 1, finishRule: 'double_out',
    });
    const sixtyOne = estimateCheckoutProbability({
      visitStartScore: 61, scoreRemaining: 61, dartsRemaining: 2, finishRule: 'double_out',
    });
    const impossible = estimateCheckoutProbability({
      visitStartScore: 170, scoreRemaining: 170, dartsRemaining: 2, finishRule: 'double_out',
    });

    expect(double16).toBeGreaterThan(sixtyOne);
    expect(sixtyOne).toBeGreaterThan(0);
    expect(impossible).toBe(0);
    expect(estimateCheckoutProbability({
      visitStartScore: 501, scoreRemaining: 501, dartsRemaining: 3, finishRule: 'double_out',
    })).toBe(0);
  });

  it('uses the supplied player outcome distribution', () => {
    const closer = (isStrong: boolean) => createBehavioralOutcomeModel({
      personal: [{
        currentScore: 40,
        dartsLeft: 1,
        finishRule: 'double_out',
        scoreDelta: isStrong ? 40 : 0,
        isDouble: isStrong,
        count: 200,
      }],
    });
    const probability = (isStrong: boolean) => estimateCheckoutProbability({
      visitStartScore: 40,
      scoreRemaining: 40,
      dartsRemaining: 1,
      finishRule: 'double_out',
      outcomeModel: closer(isStrong),
    });

    expect(probability(true)).toBeGreaterThan(probability(false));
  });

  it('detects double-out bogey leaves generically', () => {
    expect(isBogeyLeave(169, 'double_out')).toBe(true);
    expect(isBogeyLeave(168, 'double_out')).toBe(true);
    expect(isBogeyLeave(170, 'double_out')).toBe(false);
    expect(isBogeyLeave(169, 'single_out')).toBe(false);
  });

  it('describes a stronger resulting leave without inventing an intended target', () => {
    const strongLeave = evaluateDartSetup({
      visitStartScore: 110,
      scoreBefore: 110,
      scoreAfter: 50,
      dartsRemainingBefore: 1,
      finishRule: 'double_out',
      busted: false,
      checkedOut: false,
    });
    const weakLeave = evaluateDartSetup({
      visitStartScore: 110,
      scoreBefore: 110,
      scoreAfter: 90,
      dartsRemainingBefore: 1,
      finishRule: 'double_out',
      busted: false,
      checkedOut: false,
    });

    expect(strongLeave.nextVisitCheckoutProbability)
      .toBeGreaterThan(weakLeave.nextVisitCheckoutProbability);
    expect(strongLeave.leaveProbabilityChange)
      .toBeGreaterThan(weakLeave.leaveProbabilityChange);
  });

  it('flags darts that create or escape a bogey leave', () => {
    const created = evaluateDartSetup({
      visitStartScore: 229, scoreBefore: 229, scoreAfter: 169,
      dartsRemainingBefore: 1, finishRule: 'double_out', busted: false, checkedOut: false,
    });
    const escaped = evaluateDartSetup({
      visitStartScore: 169, scoreBefore: 169, scoreAfter: 109,
      dartsRemainingBefore: 1, finishRule: 'double_out', busted: false, checkedOut: false,
    });

    expect(created.createdBogey).toBe(true);
    expect(escaped.avoidedBogey).toBe(true);
  });

  it('respects checkout completion and the visit-start reset after a bust', () => {
    const checkout = evaluateDartSetup({
      visitStartScore: 40, scoreBefore: 40, scoreAfter: 0,
      dartsRemainingBefore: 1, finishRule: 'double_out', busted: false, checkedOut: true,
    });
    const bust = evaluateDartSetup({
      visitStartScore: 100, scoreBefore: 40, scoreAfter: 100,
      dartsRemainingBefore: 1, finishRule: 'double_out', busted: true, checkedOut: false,
    });

    expect(checkout.checkoutProbabilityAfter).toBe(1);
    expect(bust.checkoutProbabilityAfter).toBe(0);
    expect(bust.nextVisitCheckoutProbability).toBe(
      estimateCheckoutProbability({
        visitStartScore: 100, scoreRemaining: 100, dartsRemaining: 3, finishRule: 'double_out',
      })
    );
  });
});
