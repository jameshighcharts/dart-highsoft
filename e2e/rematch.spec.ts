import { test, expect, TEST_PLAYERS } from './fixtures';

for (const spectator of [false, true]) {
  for (const mode of ['x01', 'cricket', 'killer', 'shanghai', 'around_the_clock']) {
    test(`${mode}: ${spectator ? 'spectator' : 'scorer'} can keep or edit rematch players`, async ({ page, request, supabase, createMatch, cleanupMatch }) => {
      test.setTimeout(120_000);
      const { matchId } = await createMatch({ startScore: 301, finish: 'single_out', fairEnding: true });
      let sourceId = matchId;
      const isX01 = mode === 'x01';
      const api = isX01 ? 'matches' : 'games';
      const route = isX01 ? 'match' : 'game';
      if (isX01) {
        const result = await supabase.from('matches').update({ winner_player_id: TEST_PLAYERS.ONE, completed_at: new Date().toISOString() }).eq('id', sourceId);
        expect(result.error).toBeNull();
        await supabase.from('legs').update({ winner_player_id: TEST_PLAYERS.ONE }).eq('match_id', sourceId);
      } else {
        const response = await request.post('/api/games', { data: { mode, config: {}, playerIds: [TEST_PLAYERS.ONE, TEST_PLAYERS.TWO] } });
        expect(response.ok()).toBeTruthy();
        sourceId = (await response.json()).gameId;
        const result = await supabase.from('game_sessions').update({ status: 'completed', winner_player_id: TEST_PLAYERS.ONE, completed_at: new Date().toISOString() }).eq('id', sourceId);
        expect(result.error).toBeNull();
      }
      const table = isX01 ? 'matches' : 'game_sessions';
      const membershipTable = isX01 ? 'match_players' : 'game_session_players';
      const key = isX01 ? 'match_id' : 'session_id';
      const { data: source } = await supabase.from(table).select('*').eq('id', sourceId).single();
      const newIds: string[] = [];
      const newName = `Rematch ${mode} ${spectator} ${Date.now()}`;
      const extraName = `${newName} existing`;
      const extraResponse = await request.post('/api/players', { data: { displayName: extraName, location: 'sogndal' } });
      expect(extraResponse.ok()).toBeTruthy();
      const extraId = (await extraResponse.json()).player.id;
      try {
        for (const edit of [false, true]) {
          await page.goto(`/${route}/${sourceId}${spectator ? '?spectator=true' : ''}`);
          await page.getByRole('button', { name: 'Rematch', exact: true }).last().click();
          const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Ready for a rematch?' }) });
          await expect(dialog).toBeVisible();
          if (edit) {
            await dialog.getByRole('button', { name: 'Edit players', exact: true }).click();
            await page.getByRole('button', { name: 'Remove E2E Player Two', exact: true }).click();
            if (['x01', 'cricket', 'killer'].includes(mode)) await expect(page.getByRole('button', { name: 'Start rematch', exact: true })).toBeDisabled();
            await page.getByRole('searchbox', { name: 'Search players' }).fill(extraName);
            await page.getByRole('button', { name: 'Sogndal', exact: true }).click();
            await expect(page.getByRole('checkbox', { name: extraName, exact: true })).toHaveCount(0);
            await page.getByRole('button', { name: 'Sogndal', exact: true }).click();
            await page.getByRole('checkbox', { name: extraName, exact: true }).check();
            await page.getByRole('textbox', { name: 'New player name' }).fill(newName);
            await page.getByRole('button', { name: 'Add new player', exact: true }).click();
            await expect(page.getByRole('button', { name: `Remove ${newName}`, exact: true })).toBeVisible();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
            if (spectator && mode === 'cricket') await page.screenshot({ path: test.info().outputPath('edit-rematch.png') });
          }
          const responsePromise = page.waitForResponse(response => response.url().endsWith(`/api/${api}/${sourceId}/rematch`) && response.request().method() === 'POST');
          await page.getByRole('button', { name: edit ? 'Start rematch' : 'Same players', exact: true }).click();
          const response = await responsePromise;
          expect(response.ok()).toBeTruthy();
          const payload = await response.json();
          const newId = isX01 ? payload.newMatchId : payload.newGameId;
          newIds.push(newId);
          await expect(page).toHaveURL(new RegExp(`/${route}/${newId}$`));
          await expect(page.getByRole('button', { name: 'Rematch', exact: true })).toHaveCount(0);
          const { data: created } = await supabase.from(table).select('*').eq('id', newId).single();
          expect(created.mode).toBe(source.mode);
          if (isX01) {
            for (const setting of ['start_score', 'finish', 'legs_to_win', 'fair_ending']) expect(created[setting]).toEqual(source[setting]);
          } else {
            for (const setting of Object.keys(source.config).filter(key => key !== 'assignedNumbers')) expect(created.config[setting]).toEqual(source.config[setting]);
          }
          const { data: seats } = await supabase.from(membershipTable).select('player_id').eq(key, newId);
          expect(seats).toHaveLength(edit ? 3 : 2);
          expect(seats?.map(row => row.player_id)).toContain(TEST_PLAYERS.ONE);
          if (edit) {
            expect(seats?.map(row => row.player_id)).not.toContain(TEST_PLAYERS.TWO);
            expect(seats?.map(row => row.player_id)).toContain(extraId);
          }
          const { data: oldSeats } = await supabase.from(membershipTable).select('player_id').eq(key, sourceId);
          expect(oldSeats?.map(row => row.player_id).sort()).toEqual([TEST_PLAYERS.ONE, TEST_PLAYERS.TWO].sort());
        }
      } finally {
        for (const id of newIds) {
          if (isX01) await cleanupMatch(id);
          else await supabase.from('game_sessions').delete().eq('id', id);
        }
        if (!isX01) await supabase.from('game_sessions').delete().eq('id', sourceId);
        await supabase.from('players').delete().in('display_name', [newName, extraName]);
      }
    });
  }
}
