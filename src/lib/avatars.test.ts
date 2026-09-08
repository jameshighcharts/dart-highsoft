import { describe, expect, it } from 'vitest';

import {
  DEFAULT_AVATAR_COUNT,
  DEFAULT_AVATAR_KEYS,
  avatarStoragePathFromUrl,
  avatarFallbackColor,
  defaultAvatarKey,
  defaultAvatarUrl,
  playerInitials,
  renderPlayerAvatarHtml,
  renderPlayerCellHtml,
  resolveAvatarUrl,
} from './avatars';

describe('avatarStoragePathFromUrl', () => {
  it('extracts the object path and strips the cache-bust query', () => {
    expect(avatarStoragePathFromUrl('https://x.supabase.co/storage/v1/object/public/avatars/players/abc.png?v=1')).toBe('players/abc.png');
  });
  it('rejects foreign or malformed urls', () => {
    expect(avatarStoragePathFromUrl(null)).toBeNull();
    expect(avatarStoragePathFromUrl('https://evil.example/avatars/players/abc.png')).toBeNull();
    expect(avatarStoragePathFromUrl('https://x.supabase.co/storage/v1/object/public/avatars/other/abc.png')).toBeNull();
    expect(avatarStoragePathFromUrl('https://x.supabase.co/storage/v1/object/public/avatars/players/../x.png')).toBeNull();
  });
});

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

  it('falls back to the default goblin and escapes names, rejecting unsafe urls', () => {
    const html = renderPlayerCellHtml({ id: 'p1', display_name: '<b>Bo</b>', avatar_url: 'javascript:alert(1)' });
    expect(html).not.toContain('javascript:');
    expect(html).toContain(`<img src="${defaultAvatarUrl('p1')}"`);
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;Bo&lt;/b&gt;');
  });
});

describe('default avatars', () => {
  it('keys all 40 goblins in sheet order', () => {
    expect(DEFAULT_AVATAR_KEYS).toHaveLength(DEFAULT_AVATAR_COUNT);
    expect(DEFAULT_AVATAR_KEYS[0]).toBe('goblin-01');
    expect(DEFAULT_AVATAR_KEYS[39]).toBe('goblin-40');
    expect(new Set(DEFAULT_AVATAR_KEYS).size).toBe(DEFAULT_AVATAR_COUNT);
  });

  it('picks one goblin per player deterministically', () => {
    expect(defaultAvatarKey('p1')).toBe(defaultAvatarKey('p1'));
    expect(DEFAULT_AVATAR_KEYS).toContain(defaultAvatarKey('any-seed'));
    expect(defaultAvatarUrl('p1')).toBe(`/avatars/default/${defaultAvatarKey('p1')}.png`);
    const picked = new Set(Array.from({ length: 400 }, (_, i) => defaultAvatarKey(`player-${i}`)));
    expect(picked.size).toBeGreaterThan(30);
  });

  it('prefers an uploaded picture over the default', () => {
    expect(resolveAvatarUrl({ id: 'p1', avatar_url: 'https://x/y.png' })).toBe('https://x/y.png');
    expect(resolveAvatarUrl({ id: 'p1', avatar_url: null })).toBe(defaultAvatarUrl('p1'));
    expect(resolveAvatarUrl({ display_name: 'Bo' })).toBe(defaultAvatarUrl('Bo'));
  });
});
