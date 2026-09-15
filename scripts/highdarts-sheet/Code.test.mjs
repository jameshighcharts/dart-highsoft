// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./Code.gs', import.meta.url), 'utf8');
function sample() {
  const layout = [{ office: 'bergen', start: 3, count: 30, players: 12 }, { office: 'sogndal', start: 34, count: 13, players: 5 }, { office: 'vik', start: 48, count: 33, players: 13 }];
  const schedule = Array.from({ length: 80 }, () => []);
  schedule[1] = ['Kontor', 'Kampnr', 'Spelar A', 'Spelar B', 'Legs A', 'Legs B', 'Snitt A', 'Snitt B', 'Vinnar', 'Tel for A', 'Tel for B'];
  const data = { version: 1, generatedAt: '2026-09-15T10:00:00Z', fixtures: [], standings: [], byes: ['', '', '', ''], finals: [] };
  for (const l of layout) {
    for (let i = 0; i < l.count; i++) {
      schedule[l.start + i - 1] = [l.office, i + 1];
      data.fixtures.push({ office: l.office, number: i + 1, players: ['A', 'B'], result: i ? ['', '', '', ''] : [2, 0, 60, 30], counts: [1, 1] });
    }
    data.standings.push({ office: l.office, rows: Array.from({ length: l.players }, (_, i) => [i + 1, 'A', 0, 0, 0]) });
  }
  return { data, schedule };
}
const plan = (data, schedule) => runInNewContext(source + '\nplanHighdartsWrites(data, schedule);', { data, schedule });

describe('bound Apps Script', () => {
  it('maps the actual workbook blocks, preserving winner formulas and notes', () => {
    const { data, schedule } = sample();
    data.fixtures[0].counts = [0, 1];
    data.fixtures.reverse();
    const writes = plan(data, schedule);
    expect(writes.find(w => w.sheet === 'Kampoppsett' && w.row === 3 && w.column === 10).values[0]).toEqual([0, 1]);
    expect(writes.find(w => w.sheet === 'Kampoppsett' && w.row === 48 && w.column === 5).values[0]).toEqual([2, 0, 60, 30]);
    for (const w of writes.filter(w => w.sheet === 'Kampoppsett' && w.row > 1)) {
      expect(w.column).not.toBe(9);
      expect(w.column + w.values[0].length).toBeLessThanOrEqual(12);
    }
    expect(writes.find(w => w.sheet === 'Sluttspilltre' && w.row === 32).values).toEqual([['', '', '']]);
  });

  it('rejects incomplete feeds, duplicate fixture numbers, moved rows and invalid late values before any writes', () => {
    for (const mutate of [
      ({ data }) => data.fixtures.pop(),
      ({ data }) => data.fixtures[1].number = 1,
      ({ schedule }) => schedule[47][1] = 2,
      ({ data }) => data.standings[2].rows[12][4] = null,
      ({ data }) => data.finals = [{ stage: 'final', number: 1, values: ['A', 'B', 'A'] }],
    ]) {
      const state = sample(); mutate(state);
      expect(() => plan(state.data, state.schedule)).toThrow();
    }
  });

  it('preserves all existing cells and releases the lock when the app is unavailable', () => {
    let released = false;
    let writes = 0;
    const context = {
      LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => released = true }) },
      SpreadsheetApp: { getActiveSpreadsheet: () => ({ getId: () => '1gIbV9OM3RsItTwQQPgwQjAxwOfPsfaPLRA08RXqsp_c', getSheetByName: () => { writes++; } }) },
      UrlFetchApp: { fetch: () => ({ getResponseCode: () => 503 }) },
    };
    expect(() => runInNewContext(source + '\nrefreshHighdarts();', context)).toThrow('HTTP 503');
    expect(released).toBe(true);
    expect(writes).toBe(0);
  });
});
