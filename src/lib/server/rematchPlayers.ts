/** An empty request retains the original lineup for existing callers. */
export async function readRematchPlayers(request: Request): Promise<string[] | null> {
  if (request.body === null) return null;
  const text = await request.text();
  if (!text.trim()) return null;
  const body: unknown = JSON.parse(text);
  if (!body || typeof body !== 'object' || !('playerIds' in body)
    || !Array.isArray(body.playerIds)
    || !body.playerIds.every((id): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    || new Set(body.playerIds).size !== body.playerIds.length) {
    throw new Error('Choose a valid list of unique players');
  }
  return body.playerIds;
}
