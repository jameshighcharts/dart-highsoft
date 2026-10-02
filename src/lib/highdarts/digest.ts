import {
  buildStandings,
  fixtureLabel,
  fixtureWinner,
  isCompleted,
  officeName,
  resultStats,
  type FixtureResult,
  type Snapshot,
} from './standings';

function escapeSlack(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Completion instant a digest orders and filters by. Reported results carry no
 *  match timestamp, so they surface in the first digest that follows. */
export function completedAt(f: FixtureResult) {
  return f.match?.completed_at ?? null;
}

export function resultsSince(fixtures: FixtureResult[], since: string | null) {
  return fixtures
    .filter((f) => isCompleted(f) || f.match?.ended_early)
    .filter((f) => {
      const at = completedAt(f);
      if (!at) return since === null;
      return since === null || at > since;
    })
    .sort((a, b) => (completedAt(a) ?? '').localeCompare(completedAt(b) ?? ''));
}

/** A day's tournament wrap for Slack. Returns null when nothing finished since
 *  the previous digest, so quiet days stay silent instead of posting noise. */
export function buildHighdartsDigestMessage(
  snapshot: Snapshot,
  appOrigin: string,
  since: string | null,
) {
  const fresh = resultsSince(snapshot.fixtures, since);
  if (fresh.length === 0) return null;

  const standings = buildStandings(snapshot);
  const name = (id: string | null, fallback: string) =>
    escapeSlack(
      snapshot.players.find((p) => p.id === id)?.display_name ?? fallback,
    );

  const line = (f: FixtureResult) => {
    const a = name(f.player_a_id, f.player_a_name);
    const b = name(f.player_b_id, f.player_b_name);
    if (f.match?.ended_early)
      return `• ${a} vs ${b} ended early _(${fixtureLabel(f)})_`;
    const winnerId = fixtureWinner(f) ?? null;
    const loserId = winnerId === f.player_a_id ? f.player_b_id : f.player_a_id;
    const winner = winnerId === f.player_a_id ? a : b;
    const loser = winnerId === f.player_a_id ? b : a;
    const score = `${resultStats(f, winnerId).legs}–${resultStats(f, loserId).legs}`;
    return `• *${winner}* beat ${loser} ${score} _(${fixtureLabel(f)})_`;
  };

  const shown = fresh.slice(0, 12);
  const results = shown.map(line).join('\n');
  const more =
    fresh.length > shown.length
      ? `\n_…and ${fresh.length - shown.length} more._`
      : '';

  const progress = `${standings.played} of ${standings.total} group fixtures played`;
  const perOffice = standings.offices
    .map((o) => `${officeName(o.office)} ${o.played}/${o.total}`)
    .join(' · ');

  const leaders = standings.offices
    .filter((o) => o.played > 0 && o.table[0])
    .map(
      (o) =>
        `${officeName(o.office)}: *${escapeSlack(o.table[0].player.display_name)}* (${o.table[0].wins} W)`,
    )
    .join(' · ');

  const heading = '🎯 Highdarts 2026 — daily update';
  const origin = appOrigin.replace(/\/$/, '');
  const plainResults = shown
    .map((f) => line(f).replace(/[*_•]/g, '').trim())
    .join('\n');

  return {
    results: fresh.length,
    latest: completedAt(fresh[fresh.length - 1]),
    text: `${heading}\n${plainResults}\n${progress}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: heading } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${fresh.length === 1 ? 'One match' : `${fresh.length} matches`} since the last update*\n${results}${more}`,
        },
      },
      ...(leaders
        ? [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `*Leading:* ${leaders}` },
            },
          ]
        : []),
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `${progress} · ${perOffice}` }],
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Standings' },
            url: `${origin}/bengt`,
          },
        ],
      },
    ],
  };
}
