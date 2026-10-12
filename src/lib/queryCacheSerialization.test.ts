import { describe, expect, it } from 'vitest';
import { deserializeQueryCache, serializeQueryCache } from './queryCacheSerialization';

describe('query cache serialization', () => {
  it('round-trips the Map, Set and Date values query data uses', () => {
    const data = {
      byPlayer: new Map([['p1', [1, 2]], ['p2', []]]),
      nested: { ids: new Set(['a', 'b']), when: new Date('2026-10-12T10:00:00.000Z') },
      list: [new Map([[1, { at: new Date(0) }]])],
      plain: { n: 1, s: 'x', none: null },
    };
    const restored = deserializeQueryCache<typeof data>(serializeQueryCache(data));
    expect(restored).toEqual(data);
    expect(restored.byPlayer).toBeInstanceOf(Map);
    expect(restored.nested.when).toBeInstanceOf(Date);
    expect(restored.list[0].get(1)?.at).toBeInstanceOf(Date);
  });
});
