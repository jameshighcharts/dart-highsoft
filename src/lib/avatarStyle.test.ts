import { describe, expect, it } from 'vitest';

import { avatarFallbackColor, playerInitials, renderPlayerAvatarHtml, renderPlayerCellHtml } from './avatarStyle';

describe('avatarStyle', () => {
  it('is deterministic per seed', () => {
    expect(avatarFallbackColor('p1')).toBe(avatarFallbackColor('p1'));
    expect(playerInitials('James Haugen')).toBe('JH');
  });

  it('renders an img for pictures and escapes attributes', () => {
    const html = renderPlayerAvatarHtml({ id: 'p1', display_name: 'A', avatar_url: 'https://x/y.png?a=1&b="2"' });
    expect(html.startsWith('<img')).toBe(true);
    expect(html).toContain('&amp;b=&quot;2&quot;');
  });

  it('falls back to initials and escapes names, rejecting unsafe urls', () => {
    const html = renderPlayerCellHtml({ id: 'p1', display_name: '<b>Bo</b>', avatar_url: 'javascript:alert(1)' });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;Bo&lt;/b&gt;');
  });
});
