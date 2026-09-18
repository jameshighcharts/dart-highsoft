import { describe, expect, it } from 'vitest';
import { buildHighdartsDigestMessage, resultsSince } from './digest';
import { fixture, finish } from '@/test-utils/highdartsFixtures';
import type { Player } from '@/lib/match/types';
import type { FixtureResult, Snapshot } from './standings';

const players = [
  { id: 'a', display_name: 'Håvard Gundersen' },
  { id: 'b', display_name: 'James Haugen' },
  { id: 'c', display_name: 'Babar Shah' },
] as Player[];

function at(f: FixtureResult, completed_at: string): FixtureResult {
  return { ...f, match: { ...f.match!, completed_at } };
}

function snapshot(fixtures: FixtureResult[]): Snapshot {
  return { fixtures, players };
}

describe('resultsSince', () => {
  it('keeps only fixtures completed after the previous digest', () => {
    const older = at(finish(fixture('bergen', 'a', 'b', 1), 'a'), '2026-09-14T10:00:00Z');
    const newer = at(finish(fixture('bergen', 'a', 'c', 2), 'a'), '2026-09-15T10:00:00Z');
    const fresh = resultsSince([older, newer], '2026-09-14T20:00:00Z');
    expect(fresh.map((f) => f.fixture_no)).toEqual([2]);
  });

  it('includes everything on the first run', () => {
    const played = at(finish(fixture('bergen', 'a', 'b', 1), 'a'), '2026-09-14T10:00:00Z');
    expect(resultsSince([played, fixture('bergen', 'a', 'c', 2)], null)).toHaveLength(1);
  });

  it('orders oldest first so the newest result sets the coverage mark', () => {
    const first = at(finish(fixture('bergen', 'a', 'b', 1), 'a'), '2026-09-15T09:00:00Z');
    const second = at(finish(fixture('bergen', 'a', 'c', 2), 'a'), '2026-09-15T12:00:00Z');
    expect(resultsSince([second, first], null).map((f) => f.fixture_no)).toEqual([1, 2]);
  });
});

describe('buildHighdartsDigestMessage', () => {
  it('returns null when nothing finished since the last digest', () => {
    const played = at(finish(fixture('bergen', 'a', 'b', 1), 'a'), '2026-09-14T10:00:00Z');
    expect(
      buildHighdartsDigestMessage(snapshot([played]), 'https://hsdart.vercel.app', '2026-09-14T20:00:00Z'),
    ).toBeNull();
  });

  it('summarises new results with the winner first and links the standings', () => {
    const played = at(finish(fixture('bergen', 'a', 'b', 1), 'a'), '2026-09-15T10:00:00Z');
    const message = buildHighdartsDigestMessage(
      snapshot([played, fixture('bergen', 'a', 'c', 2)]),
      'https://hsdart.vercel.app/',
      null,
    );
    expect(message).not.toBeNull();
    expect(message!.results).toBe(1);
    expect(message!.latest).toBe('2026-09-15T10:00:00Z');
    const text = JSON.stringify(message!.blocks);
    expect(text).toContain('Håvard Gundersen');
    expect(text).toContain('beat James Haugen');
    expect(text).toContain('Bergen #1');
    expect(text).toContain('1 of 2 group fixtures played');
    // The trailing slash on the origin must not double up in the button URL.
    expect(text).toContain('"url":"https://hsdart.vercel.app/bengt"');
  });

  it('reports a match that ended early instead of naming a winner', () => {
    const abandoned = {
      ...at(finish(fixture('bergen', 'a', 'b', 1), 'a'), '2026-09-15T10:00:00Z'),
    };
    abandoned.match = { ...abandoned.match!, ended_early: true };
    const message = buildHighdartsDigestMessage(
      snapshot([abandoned]),
      'https://hsdart.vercel.app',
      null,
    );
    expect(JSON.stringify(message!.blocks)).toContain('ended early');
  });

  it('escapes Slack control characters in player names', () => {
    const tricky = [{ id: 'a', display_name: '<Håvard & Co>' }, ...players.slice(1)] as Player[];
    const played = at(finish(fixture('bergen', 'a', 'b', 1), 'a'), '2026-09-15T10:00:00Z');
    const message = buildHighdartsDigestMessage(
      { fixtures: [played], players: tricky },
      'https://hsdart.vercel.app',
      null,
    );
    const text = JSON.stringify(message!.blocks);
    expect(text).toContain('&lt;Håvard &amp; Co&gt;');
    expect(text).not.toContain('<Håvard');
  });
});
