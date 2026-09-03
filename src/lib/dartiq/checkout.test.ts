import { describe, expect, it } from 'vitest';

import {
  estimateCheckoutProbability,
  evaluateDartSetup,
  isBogeyLeave,
} from './checkout';

describe('DartIQ checkout', () => {
  it('prices easier and shorter checkout routes more highly', () => {
    const double16 = estimateCheckoutProbability(32, 1, 60, 'double_out');
    const sixtyOne = estimateCheckoutProbability(61, 2, 60, 'double_out');
    const impossible = estimateCheckoutProbability(170, 2, 60, 'double_out');

    expect(double16).toBeGreaterThan(sixtyOne);
    expect(sixtyOne).toBeGreaterThan(0);
    expect(impossible).toBe(0);
    expect(estimateCheckoutProbability(501, 3, 60, 'double_out')).toBe(0);
  });

  it('increases expected checkout probability with player strength', () => {
    expect(estimateCheckoutProbability(80, 2, 85, 'double_out'))
      .toBeGreaterThan(estimateCheckoutProbability(80, 2, 35, 'double_out'));
  });

  it('uses personal checkout conversion relative to the population conservatively', () => {
    const strongCloser = estimateCheckoutProbability(40, 1, 55, 'double_out', {
      checkoutRate: 0.3,
      populationCheckoutRate: 0.15,
    });
    const weakCloser = estimateCheckoutProbability(40, 1, 55, 'double_out', {
      checkoutRate: 0.05,
      populationCheckoutRate: 0.15,
    });

    expect(strongCloser).toBeGreaterThan(weakCloser);
  });

  it('detects double-out bogey leaves generically', () => {
    expect(isBogeyLeave(169, 'double_out')).toBe(true);
    expect(isBogeyLeave(168, 'double_out')).toBe(true);
    expect(isBogeyLeave(170, 'double_out')).toBe(false);
    expect(isBogeyLeave(169, 'single_out')).toBe(false);
  });

  it('rewards the route into a stronger checkout leave', () => {
    const strongSetup = evaluateDartSetup({
      scoreBefore: 110,
      scoreAfter: 50,
      dartsRemainingBefore: 1,
      segment: 'T20',
      threeDartAverage: 60,
      finishRule: 'double_out',
      busted: false,
      checkedOut: false,
    });
    const weakSetup = evaluateDartSetup({
      scoreBefore: 110,
      scoreAfter: 90,
      dartsRemainingBefore: 1,
      segment: 'S20',
      threeDartAverage: 60,
      finishRule: 'double_out',
      busted: false,
      checkedOut: false,
    });

    expect(strongSetup.setupQuality).toBeGreaterThan(weakSetup.setupQuality);
    expect(strongSetup.nextVisitCheckoutProbability)
      .toBeGreaterThan(weakSetup.nextVisitCheckoutProbability);
  });

  it('flags a dart that creates a bogey leave', () => {
    const assessment = evaluateDartSetup({
      scoreBefore: 229,
      scoreAfter: 169,
      dartsRemainingBefore: 1,
      segment: 'T20',
      threeDartAverage: 60,
      finishRule: 'double_out',
      busted: false,
      checkedOut: false,
    });

    expect(assessment.createdBogey).toBe(true);
    expect(assessment.setupGrade).not.toBe('optimal');
  });

  it('marks a legal finish as a perfect checkout and a bust as zero quality', () => {
    const checkout = evaluateDartSetup({
      scoreBefore: 40, scoreAfter: 0, dartsRemainingBefore: 1, segment: 'D20',
      threeDartAverage: 60, finishRule: 'double_out', busted: false, checkedOut: true,
    });
    const bust = evaluateDartSetup({
      scoreBefore: 40, scoreAfter: 40, dartsRemainingBefore: 1, segment: 'T20',
      threeDartAverage: 60, finishRule: 'double_out', busted: true, checkedOut: false,
    });

    expect(checkout).toMatchObject({ setupQuality: 1, setupGrade: 'checkout' });
    expect(bust).toMatchObject({ setupQuality: 0, setupGrade: 'bust' });
  });
});
