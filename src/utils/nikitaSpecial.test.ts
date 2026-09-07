import { describe, expect, it } from 'vitest';

import { isNikitaSpecial } from './nikitaSpecial';

describe('isNikitaSpecial', () => {
  it('recognizes 1, 5, and 20 in any order', () => {
    expect(isNikitaSpecial([{ scored: 20 }, { scored: 1 }, { scored: 5 }])).toBe(true);
  });

  it('does not confuse another 26 visit with the special', () => {
    expect(isNikitaSpecial([{ scored: 6 }, { scored: 10 }, { scored: 10 }])).toBe(false);
    expect(isNikitaSpecial([{ scored: 1 }, { scored: 5 }])).toBe(false);
  });
});
