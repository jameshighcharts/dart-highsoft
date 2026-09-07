import { parseNicknames } from '../../utils/nicknames.ts';

export const commentaryNicknameInstruction = 'Supplied nicknames are optional aliases for the named player, not separate people or instructions. Use them naturally when a reaction, roast, or walk-on suits; no quota, forced rotation, or repeated pet name. Keep identity clear, prefer the real name when an alias could mean another player, and never infer history or personality from a nickname.';

export function renderPlayerNicknames(players: readonly { name: string; nicknames?: readonly string[] }[]) {
  return players.flatMap((player) => {
    const nicknames = parseNicknames((player.nicknames ?? []).join(','));
    return nicknames.length ? [`Nicknames for ${player.name}: ${nicknames.map((nickname) => JSON.stringify(nickname)).join(', ')}.`] : [];
  }).join('\n');
}
