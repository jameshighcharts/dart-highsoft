export type SearchParamValue = string | string[] | undefined;

export function firstValue(value: SearchParamValue) {
  return Array.isArray(value) ? value[0] : value;
}

const SAME_ORIGIN = 'https://same-origin.invalid';

/**
 * Only same-origin paths are accepted; anything else falls back to `fallback`. The path is parsed
 * the way a browser would (it reads `\` as `/`, so `/\evil.example` is another site) and rebuilt
 * from its parts.
 */
export function resolveRedirectTarget(value: SearchParamValue, fallback: string) {
  const resolved = firstValue(value);
  if (!resolved || !resolved.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(resolved)) return fallback;
  let url: URL;
  try {
    url = new URL(resolved, SAME_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== SAME_ORIGIN) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
