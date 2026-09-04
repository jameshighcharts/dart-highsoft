import { describe, expect, it } from 'vitest';

import { formatNicknames, parseNicknames } from './nicknames';

describe('parseNicknames', () => {
  it('splits on commas, trims and drops empties', () => {
    expect(parseNicknames(' Jimbo, The Hammer ,, ,jim  bo ')).toEqual(['Jimbo', 'The Hammer', 'jim bo']);
  });
  it('dedupes case-insensitively', () => {
    expect(parseNicknames('Jimbo, jimbo, JIMBO')).toEqual(['Jimbo']);
  });
  it('caps length and count', () => {
    expect(parseNicknames('a'.repeat(60))[0]).toHaveLength(40);
    expect(parseNicknames(Array.from({ length: 15 }, (_, i) => `n${i}`).join(','))).toHaveLength(10);
  });
  it('round-trips through formatNicknames', () => {
    expect(formatNicknames(parseNicknames('A, B'))).toBe('A, B');
    expect(formatNicknames(null)).toBe('');
  });
});
