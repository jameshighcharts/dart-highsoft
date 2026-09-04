import { describe, expect, it } from 'vitest';

import { avatarStoragePathFromUrl } from './avatars';

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
