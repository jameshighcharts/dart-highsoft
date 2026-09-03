import { describe, expect, it } from 'vitest';

import { parseSegment, scoreFromSegment } from './segment.ts';

describe('parseSegment', () => {
  it('parses miss and bulls, including legacy labels', () => {
    expect(parseSegment('Miss')).toEqual({ kind: 'miss', scored: 0 });
    expect(parseSegment('SB')).toEqual({ kind: 'bull', multiplier: 1, scored: 25 });
    expect(parseSegment('OuterBull')).toEqual({ kind: 'bull', multiplier: 1, scored: 25 });
    expect(parseSegment('DB')).toEqual({ kind: 'bull', multiplier: 2, scored: 50 });
    expect(parseSegment('InnerBull')).toEqual({ kind: 'bull', multiplier: 2, scored: 50 });
  });

  it('parses every S/D/T number segment with the right multiplier', () => {
    for (let value = 1; value <= 20; value++) {
      expect(parseSegment(`S${value}`)).toEqual({ kind: 'number', value, multiplier: 1, scored: value });
      expect(parseSegment(`D${value}`)).toEqual({ kind: 'number', value, multiplier: 2, scored: value * 2 });
      expect(parseSegment(`T${value}`)).toEqual({ kind: 'number', value, multiplier: 3, scored: value * 3 });
    }
  });

  it.each(['S0', 'T21', 'X5', 's20', '', 'Bull', '25', 'D 16', 'T020'])('rejects %j', (label) => {
    expect(parseSegment(label)).toBeNull();
    expect(scoreFromSegment(label)).toBeNull();
  });
});

describe('scoreFromSegment', () => {
  it.each([
    ['Miss', 0],
    ['SB', 25],
    ['OuterBull', 25],
    ['DB', 50],
    ['InnerBull', 50],
    ['S1', 1],
    ['D16', 32],
    ['T20', 60],
  ])('%s scores %i', (label, expected) => {
    expect(scoreFromSegment(label)).toBe(expected);
  });
});
