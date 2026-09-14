import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import {
  buildStandings,
  fixtureFormat,
  isCompleted,
  type FixtureResult,
  type Snapshot,
} from '../src/lib/highdarts/standings';
import { projectFinals } from '../src/lib/highdarts/finals';

// Explicitly targets the disposable native database. Never inherits a production URL.
const native = process.env.HIGHDARTS_E2E_NATIVE === '1';
const db = () =>
  createClient(
    'http://127.0.0.1:56558',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'unset',
    { auth: { persistSession: false } },
  );
function sql(query: string) {
  if (!native) throw new Error('Native Highdarts E2E environment is required');
  return execFileSync(
    '/Applications/Postgres.app/Contents/Versions/18/bin/psql',
    [
      '-h',
      '/private/tmp',
      '-p',
      '56555',
      '-d',
      'highdarts_e2e',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      query,
    ],
    { encoding: 'utf8' },
  ).trim();
}
function literal(value: string) {
  return "'" + value.replaceAll("'", "''") + "'";
}
async function snapshot(request: APIRequestContext): Promise<Snapshot> {
  const response = await request.get('/api/highdarts');
  expect(response.status()).toBe(200);
  return response.json();
}
async function create(request: APIRequestContext, f: FixtureResult) {
  const format = fixtureFormat(f.stage);
  return request.post('/api/matches', {
    data: {
      highdartsFixtureId: f.id,
      playerIds: [f.player_a_id, f.player_b_id],
      startScore: Number(format.startScore),
      finishRule: format.finish,
      legsToWin: 2,
      fairEnding: false,
    },
  });
}
async function playMatch(
  request: APIRequestContext,
  f: FixtureResult,
  winner: string,
) {
  let matchId = f.match_id;
  if (!matchId) {
    const response = await create(request, f);
    expect(response.status(), await response.text()).toBe(201);
    matchId = (await response.json()).matchId;
  }
  if (!matchId) throw new Error('Missing created match');
  const opponent = f.player_a_id === winner ? f.player_b_id : f.player_a_id;
  const format = fixtureFormat(f.stage);
  for (let legNumber = 1; legNumber <= 2; legNumber++) {
    const { data: leg, error } = await db()
      .from('legs')
      .select('*')
      .eq('match_id', matchId)
      .eq('leg_number', legNumber)
      .single();
    expect(error).toBeNull();
    if (leg.winner_player_id) continue;
    const visits =
      format.startScore === '501'
        ? [
            ['T20', 'T20', 'T20'],
            ['T20', 'T20', 'T20'],
            ['T20', 'T19', 'D12'],
          ]
        : format.finish === 'double_out'
          ? [
              ['T20', 'T20', 'T20'],
              ['T20', 'T19', 'D2'],
            ]
          : [
              ['T20', 'T20', 'T20'],
              ['T20', 'T20', 'S1'],
            ];
    async function visit(playerId: string, segments: string[]) {
      let turnId = '';
      let total = 0;
      for (const [i, segment] of segments.entries()) {
        const scored =
          segment === 'Miss'
            ? 0
            : Number(segment.slice(1)) *
              (segment[0] === 'T' ? 3 : segment[0] === 'D' ? 2 : 1);
        total += scored;
        const response = await request.post(`/api/matches/${matchId}/throws`, {
          data: { legId: leg.id, playerId, dartIndex: i + 1, segment, scored },
        });
        expect(response.status(), await response.text()).toBe(200);
        turnId = (await response.json()).turnId;
      }
      const response = await request.patch(
        `/api/matches/${matchId}/turns/${turnId}`,
        { data: { totalScored: total, busted: false } },
      );
      expect(response.status(), await response.text()).toBe(200);
    }
    if (leg.starting_player_id !== winner)
      await visit(opponent!, ['Miss', 'Miss', 'Miss']);
    for (const [i, segments] of visits.entries()) {
      await visit(winner, segments);
      if (i < visits.length - 1)
        await visit(opponent!, ['Miss', 'Miss', 'Miss']);
    }
    const response = await request.post(
      `/api/matches/${matchId}/legs/${leg.id}/complete`,
      { data: { winnerPlayerId: winner } },
    );
    expect(response.status(), await response.text()).toBe(200);
  }
  const result = (await snapshot(request)).fixtures.find(
    (row) => row.id === f.id,
  )!;
  expect(result.match?.winner_player_id).toBe(winner);
  expect(isCompleted(result)).toBe(true);
  return result;
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test.describe('Highdarts native browser → Next API → PostgREST → PostgreSQL', () => {
  test.skip(!native, 'Requires the isolated native Highdarts environment');
  test.beforeAll(() => {
    sql(
      `begin; set session_replication_role=replica; delete from throws; delete from turns; delete from legs; delete from match_players; delete from elo_ratings; delete from elo_ratings_multi; delete from background_jobs; delete from dartiq_source_revisions; delete from matches; delete from highdarts_fixtures where stage<>'group'; update highdarts_fixtures set match_id=null,slack_message_ts=null; set session_replication_role=origin; commit;`,
    );
  });
  test('complete tournament workflow, recovery, permissions, and responsive UI', async ({
    page,
    request,
  }) => {
    page.setDefaultTimeout(15_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await test.step('empty schedule, personal matches, tabs, rules, office filtering and dark sheet', async () => {
      await page.goto('/bengt');
      await expect(
        page.getByText('Your matches', { exact: true }),
      ).toBeVisible();
      expect(await page.getByRole('tab').allTextContents()).toEqual([
        "How's it going",
        'Tabell',
        'Sluttspill',
        'Sheet',
      ]);
      await expect(page.getByText('No results yet')).toBeVisible();
      await page.getByRole('button', { name: 'Rules', exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('Best of 3');
      await page.keyboard.press('Escape');
      const upcoming = page.getByRole('region', { name: 'Upcoming fixtures' });
      await upcoming.getByRole('button', { name: 'Next fixtures' }).click();
      await expect(upcoming).toContainText('7–12 of 30 fixtures');
      await upcoming
        .getByRole('button', { name: 'Sogndal', exact: true })
        .click();
      await expect(upcoming).toContainText('1–6 of 13 fixtures');
      await upcoming
        .getByRole('textbox', { name: 'Search fixtures' })
        .fill('zzznobody');
      await expect(upcoming).toContainText('No fixtures match this search.');
      await page.getByRole('tab', { name: 'Tabell', exact: true }).click();
      await expect(page.locator('table')).toHaveCount(3);
      expect(
        await page
          .locator('table')
          .first()
          .locator('thead th')
          .allTextContents(),
      ).toEqual(['#', 'Player', 'W', 'L', 'AVG', 'Left']);
      const top = await page
        .locator('table')
        .evaluateAll((tables) =>
          tables.map((t) => Math.round(t.getBoundingClientRect().top)),
        );
      expect(new Set(top).size).toBe(1);
      await noOverflow(page);
      await page.getByRole('tab', { name: 'Sluttspill' }).click();
      await expect(page.getByRole('article')).toHaveCount(11);
      await expect(
        page.getByRole('button', { name: 'Lock the draw' }),
      ).toBeDisabled();
      await page.getByRole('tab', { name: 'Sheet', exact: true }).click();
      expect(
        await page
          .locator('iframe')
          .evaluate((frame) => getComputedStyle(frame).filter),
      ).toBe('invert(0.9) hue-rotate(180deg)');
    });
    let primary: FixtureResult;
    await test.step('deep-link setup, fair ending, real browser scoring and undo', async () => {
      primary = (await snapshot(request)).fixtures.find(
        (f) => f.office === 'bergen' && f.fixture_no === 1,
      )!;
      await page.goto(`/new?highdarts=${primary.id}`);
      await expect(
        page.getByRole('switch', { name: 'Highdarts 2026 match' }),
      ).toBeChecked();
      await expect(
        page.getByRole('switch', { name: 'Fair ending', exact: true }),
      ).toBeDisabled();
      await page.getByRole('switch', { name: 'Highdarts 2026 match' }).click();
      await page
        .getByRole('switch', { name: 'Fair ending', exact: true })
        .click();
      await expect(
        page.getByRole('switch', { name: 'Fair ending', exact: true }),
      ).toBeChecked();
      await expect(page.locator('input[readonly]')).toHaveValue('1');
      await page.getByRole('switch', { name: 'Highdarts 2026 match' }).click();
      await expect(
        page.getByRole('switch', { name: 'Fair ending', exact: true }),
      ).not.toBeChecked();
      await expect(page.locator('input[readonly]')).toHaveValue('2');
      const createdResponse = page.waitForResponse(
        (r) =>
          r.url().endsWith('/api/matches') && r.request().method() === 'POST',
      );
      await page
        .getByRole('button', { name: 'Start match', exact: true })
        .click();
      const response = await createdResponse;
      expect(response.status(), await response.text()).toBe(201);
      primary.match_id = (await response.json()).matchId;
      await expect(page).toHaveURL(new RegExp(`/match/${primary.match_id}`));
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(
        page.getByRole('button', { name: 'Triple', exact: true }),
      ).toBeVisible();
      const dart = page.waitForResponse(
        (r) => r.url().endsWith('/throws') && r.request().method() === 'POST',
      );
      await page.getByRole('button', { name: '20', exact: true }).click();
      expect((await dart).status()).toBe(200);
      await expect
        .poll(async () =>
          sql(
            `select count(*) from throws d join turns t on t.id=d.turn_id join legs l on l.id=t.leg_id where l.match_id=${literal(primary.match_id!)}::uuid`,
          ),
        )
        .toBe('1');
      await page.reload();
      await expect(
        page.getByRole('button', { name: /Undo/i }).first(),
      ).toBeVisible();
      const turnReopened = page.waitForResponse(
        (r) => r.url().includes('/turns/') && r.request().method() === 'PATCH',
      );
      const undone = page.waitForResponse(
        (r) => r.url().includes('/throws') && r.request().method() === 'DELETE',
      );
      await page.getByRole('button', { name: /Undo/i }).first().click();
      expect((await undone).status()).toBe(200);
      expect((await turnReopened).status()).toBe(200);
      await expect
        .poll(async () =>
          sql(
            `select count(*) from throws d join turns t on t.id=d.turn_id join legs l on l.id=t.leg_id where l.match_id=${literal(primary.match_id!)}::uuid`,
          ),
        )
        .toBe('0');
      await page.goto('/bengt');
      const duplicate = await create(request, primary);
      expect(duplicate.status()).toBe(409);
      primary = await playMatch(request, primary, primary.player_a_id!);
    });
    await test.step('completed result, personal average, report, daily progress and mobile standings', async () => {
      await page.goto('/bengt');
      await expect(
        page.getByRole('progressbar', {
          name: 'Fixtures completed',
          exact: true,
        }),
      ).toHaveAttribute('aria-valuenow', '1');
      await expect(page.getByText('No results yet')).toHaveCount(0);
      const report = page.locator(
        `a[href="/match/${primary.match_id}/report"]`,
      );
      await expect(report).toContainText('150.50 avg');
      await report.click();
      await expect(page).toHaveURL(/\/report$/);
      await expect(page.locator('body')).toContainText(primary.player_a_name);
      await page.goto('/bengt');
      await page.getByRole('tab', { name: 'Tabell', exact: true }).click();
      await noOverflow(page);
      expect(await page.locator('table tbody tr').count()).toBe(
        await page.locator('table tbody [data-state]').count(),
      );
      await page.setViewportSize({ width: 1440, height: 1000 });
    });
    await test.step('simultaneous fixture claims and standalone rematch isolation', async () => {
      const fixture = (await snapshot(request)).fixtures.find(
        (f) => f.office === 'bergen' && f.fixture_no === 2,
      )!;
      const claims = await Promise.all([
        create(request, fixture),
        create(request, fixture),
      ]);
      expect(claims.map((response) => response.status()).sort()).toEqual([
        201, 409,
      ]);
      fixture.match_id = (
        await claims.find((response) => response.status() === 201)!.json()
      ).matchId;
      expect(
        sql(
          `select count(*) from matches where highdarts_fixture_id=${literal(fixture.id)}::uuid`,
        ),
      ).toBe('1');
      await playMatch(request, fixture, fixture.player_a_id!);
      const rematch = await request.post(
        `/api/matches/${primary.match_id}/rematch`,
      );
      expect(rematch.status(), await rematch.text()).toBe(200);
      const rematchId = (await rematch.json()).newMatchId;
      const { data, error } = await db()
        .from('matches')
        .select('highdarts_fixture_id')
        .eq('id', rematchId)
        .single();
      expect(error).toBeNull();
      expect(data?.highdarts_fixture_id).toBeNull();
      expect(buildStandings(await snapshot(request)).played).toBe(2);
    });
    await test.step('seed remaining group history and a real fourth-bye tie, then resolve it through the admin UI', async () => {
      // Completed-history setup is isolated to this database; the first group game above was scored through the app.
      sql(
        `do $$ declare f record; mid uuid; lid uuid; tid uuid; i integer; pid uuid; n integer; begin for f in select * from highdarts_fixtures where stage='group' and match_id is null loop select id into mid from create_highdarts_match_atomic(f.id,array[f.player_a_id,f.player_b_id],'301','single_out',2,false); select id into lid from legs where match_id=mid; update legs set winner_player_id=f.player_a_id where id=lid; insert into legs(match_id,leg_number,starting_player_id,winner_player_id) values(mid,2,f.player_b_id,f.player_a_id); n:=0; foreach pid in array array[f.player_a_id,f.player_b_id] loop n:=n+1; insert into turns(leg_id,player_id,turn_number,total_scored) values(lid,pid,n,60) returning id into tid; for i in 1..3 loop insert into throws(turn_id,dart_index,segment,scored) values(tid,i,'S20',20); end loop; end loop; update matches set winner_player_id=f.player_a_id,completed_at=now() where id=mid; end loop; end $$;`,
      );
      const current = buildStandings(await snapshot(request));
      for (const [index, office] of current.offices.entries())
        for (const row of office.table) {
          const score = (index === 2 ? 57 : 60) - (row.rank - 1) * 3;
          sql(
            `update throws set scored=${score / 3},segment='S${score / 3}' where turn_id in(select id from turns where player_id=${literal(row.player.id)}::uuid); update turns set total_scored=(select coalesce(sum(scored),0) from throws where turn_id=turns.id) where player_id=${literal(row.player.id)}::uuid;`,
          );
        }
      const before = buildStandings(await snapshot(request));
      expect(before.played).toBe(76);
      expect(before.ties).toHaveLength(1);
      expect(before.ties[0].label).toBe('Fourth bye');
      await page.goto('/bengt');
      await page.getByRole('tab', { name: 'Tabell', exact: true }).click();
      await page
        .getByRole('button', { name: 'Create tie-break', exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await snapshot(request)).fixtures.filter(
              (f) => f.stage === 'tiebreak',
            ).length,
        )
        .toBe(1);
      const tie = (await snapshot(request)).fixtures.find(
        (f) => f.stage === 'tiebreak',
      )!;
      await playMatch(request, tie, tie.player_a_id!);
      expect(buildStandings(await snapshot(request)).ties).toHaveLength(0);
    });
    await test.step('edit, lock, duplicate protection, unlock and re-lock the actual draw', async () => {
      await page.goto('/bengt');
      await page.getByRole('tab', { name: 'Sluttspill', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Lock the draw' }),
      ).toBeEnabled();
      await page.getByRole('button', { name: 'Edit pairings' }).click();
      await expect(page.getByRole('combobox')).toHaveCount(12);
      const first = page.getByRole('combobox', { name: 'Quarterfinal 1 bye' }),
        second = page.getByRole('combobox', { name: 'Quarterfinal 2 bye' });
      const original = await first.inputValue();
      await first.selectOption(await second.inputValue());
      await expect(
        page.getByRole('button', { name: 'Lock the draw' }),
      ).toBeDisabled();
      await first.selectOption(original);
      await expect(
        page.getByRole('button', { name: 'Lock the draw' }),
      ).toBeEnabled();
      await page.getByRole('button', { name: 'Lock the draw' }).click();
      await expect(
        page.getByText('The finals draw', { exact: true }),
      ).toBeVisible();
      const draw = projectFinals(buildStandings(await snapshot(request)));
      const duplicate = await request.post('/api/admin/highdarts/finals/draw', {
        data: draw.selection,
      });
      expect(duplicate.status()).toBe(409);
      expect(
        (await snapshot(request)).fixtures.filter((f) => f.next_fixture_id),
      ).toHaveLength(10);
      await page
        .getByRole('button', { name: 'Unlock draw', exact: true })
        .click();
      await expect(
        page.getByRole('button', { name: 'Lock the draw' }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Lock the draw' }).click();
      await expect(
        page.getByText('The finals draw', { exact: true }),
      ).toBeVisible();
    });
    await test.step('all eleven finals matches: stage formats, winner advancement, bracket results, draw stays locked', async () => {
      for (const stage of ['playoff', 'quarterfinal', 'semifinal', 'final']) {
        const fixtures = (await snapshot(request)).fixtures
          .filter((f) => f.stage === stage)
          .sort((a, b) => a.fixture_no - b.fixture_no);
        for (const fixture of fixtures) {
          expect(fixture.player_a_id).toBeTruthy();
          expect(fixture.player_b_id).toBeTruthy();
          if (stage === 'final') {
            const bad = await request.post('/api/matches', {
              data: {
                highdartsFixtureId: fixture.id,
                playerIds: [fixture.player_a_id, fixture.player_b_id],
                startScore: 301,
                finishRule: 'single_out',
                legsToWin: 2,
                fairEnding: false,
              },
            });
            expect(bad.status()).toBe(400);
          }
          const finished = await playMatch(
            request,
            fixture,
            fixture.player_a_id!,
          );
          if (fixture.next_fixture_id) {
            const next = (await snapshot(request)).fixtures.find(
              (f) => f.id === fixture.next_fixture_id,
            )!;
            expect(
              fixture.next_slot === 'a' ? next.player_a_id : next.player_b_id,
            ).toBe(finished.match?.winner_player_id);
          }
          const unlock = await request.delete(
            '/api/admin/highdarts/finals/draw',
          );
          expect(unlock.status()).toBe(409);
        }
      }
      const final = (await snapshot(request)).fixtures.find(
        (f) => f.stage === 'final',
      )!;
      await page.goto('/bengt');
      await page.getByRole('tab', { name: 'Sluttspill', exact: true }).click();
      await expect(
        page.getByRole('article').filter({ hasText: /^Final 1/ }),
      ).toContainText(final.player_a_name);
      await expect(
        page
          .locator('[aria-label="Finals bracket"]')
          .getByRole('link', { name: 'Match report' }),
      ).toHaveCount(11);
      expect(
        sql(
          "select count(*) from background_jobs where job_type='highdarts_result'",
        ),
      ).toBe('88');
      const anon = createClient(
        'http://127.0.0.1:56558',
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'unset',
      );
      const denied = await anon.rpc('unlock_highdarts_draw_atomic');
      expect(denied.error).not.toBeNull();
      expect(pageErrors).toEqual([]);
    });
  });
});
