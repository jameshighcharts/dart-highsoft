export const MAX_NICKNAMES = 10;
export const MAX_NICKNAME_LENGTH = 40;

/** "Jimbo, The Hammer ,jimbo" -> ["Jimbo", "The Hammer"] (trimmed, case-insensitive dedupe). */
export function parseNicknames(input: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of input.split(',')) {
    const nickname = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_NICKNAME_LENGTH);
    if (!nickname) continue;
    const key = nickname.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(nickname);
    if (result.length >= MAX_NICKNAMES) break;
  }
  return result;
}

export function formatNicknames(nicknames: readonly string[] | null | undefined): string {
  return (nicknames ?? []).join(', ');
}
