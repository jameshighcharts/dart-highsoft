import {
  fixtureLabel,
  officeName,
  resultStats,
  type FixtureResult,
} from './standings';
import type { Player } from '@/lib/match/types';
function escapeSlack(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
export function buildHighdartsResultMessage(
  f: FixtureResult,
  players: Player[],
  slackIds: Map<string, string>,
  appOrigin: string,
) {
  const a =
    players.find((p) => p.id === f.player_a_id)?.display_name ??
    f.player_a_name;
  const b =
    players.find((p) => p.id === f.player_b_id)?.display_name ??
    f.player_b_name;
  const display = (id: string | null, name: string) =>
    id && /^U[A-Z0-9]+$/.test(slackIds.get(id) ?? '')
      ? `<@${slackIds.get(id)}>`
      : escapeSlack(name);
  const aStats = resultStats(f, f.player_a_id),
    bStats = resultStats(f, f.player_b_id);
  const aWon = f.match?.winner_player_id === f.player_a_id;
  const score = `${aWon ? aStats.legs : bStats.legs}–${aWon ? bStats.legs : aStats.legs}`;
  const heading = `🎯 Highdarts 2026 · ${officeName(f.office)} · Fixture ${f.fixture_no}`;
  const outcome = f.match?.ended_early
    ? `${display(f.player_a_id, a)} vs ${display(f.player_b_id, b)} ended early. Excluded from standings.`
    : `*${aWon ? display(f.player_a_id, a) : display(f.player_b_id, b)}* beat ${aWon ? display(f.player_b_id, b) : display(f.player_a_id, a)} *${score}*`;
  const highestCheckout = Math.max(
    0,
    ...(f.match?.legs.flatMap((l) =>
      l.turns
        .filter(
          (t) =>
            t.player_id === l.winner_player_id &&
            !t.busted &&
            t.tiebreak_round === null,
        )
        .slice(-1)
        .map((t) => t.total_scored),
    ) ?? []),
  );
  const stats = `${escapeSlack(a)}: ${aStats.average.toFixed(2)} avg · ${escapeSlack(b)}: ${bStats.average.toFixed(2)} avg${highestCheckout ? ` · Highest checkout: ${highestCheckout}` : ''}`;
  const origin = appOrigin.replace(/\/$/, '');
  return {
    text: `${heading}\n${f.match?.ended_early ? `${a} vs ${b} ended early. Excluded from standings.` : `${aWon ? a : b} beat ${aWon ? b : a} ${score}`}\n${stats}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: heading } },
      { type: 'section', text: { type: 'mrkdwn', text: outcome } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: stats }] },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Match report' },
            url: `${origin}/match/${f.match_id}/report`,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Standings' },
            url: `${origin}/bengt`,
          },
        ],
      },
    ],
    label: fixtureLabel(f),
  };
}
