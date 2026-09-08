import { describe, expect, it } from 'vitest';
import { readRematchPlayers } from './rematchPlayers';

const id = '11111111-1111-1111-1111-111111111111';
function request(body?: string) { return new Request('http://localhost/rematch', { method: 'POST', body }); }
describe('rematch player selection', () => {
  it('preserves the original lineup for an empty request', async () => {
    expect(await readRematchPlayers(request())).toBeNull();
  });
  it('accepts a selected lineup and leaves mode-specific counts to creation', async () => {
    expect(await readRematchPlayers(request(JSON.stringify({ playerIds: [id] })))).toEqual([id]);
    expect(await readRematchPlayers(request('{"playerIds":[]}'))).toEqual([]);
  });
  it.each(['{', 'null', '{}', '{"playerIds":"bad"}', '{"playerIds":[1]}', '{"playerIds":["bad"]}', JSON.stringify({ playerIds: [id, id] })])('rejects malformed or duplicate players: %s', async body => {
    await expect(readRematchPlayers(request(body))).rejects.toThrow();
  });
});
