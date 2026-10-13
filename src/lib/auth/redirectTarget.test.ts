import { describe, expect, it } from 'vitest';

import { resolveRedirectTarget } from './redirectTarget';

describe('resolveRedirectTarget', () => {
  it('keeps same-origin paths with their query and hash', () => {
    expect(resolveRedirectTarget('/stats?player=a#trends', '/')).toBe('/stats?player=a#trends');
    expect(resolveRedirectTarget(['/games', '/other'], '/')).toBe('/games');
  });

  it('falls back for anything that could leave the site', () => {
    for (const target of [
      'https://evil.example', '//evil.example', '/\\evil.example', '\\\\evil.example', '/\\/evil.example',
      '/%09/evil.example'.replace('%09', '\t'), 'javascript:alert(1)', '', undefined,
    ]) {
      expect(resolveRedirectTarget(target, '/'), String(target)).toBe('/');
    }
  });
});
