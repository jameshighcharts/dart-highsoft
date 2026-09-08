import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { defaultAvatarUrl } from '@/lib/avatars';

import { PlayerAvatar, playerInitials } from './PlayerAvatar';

describe('PlayerAvatar', () => {
  it('derives initials', () => {
    expect(playerInitials('James Haugen')).toBe('JH');
    expect(playerInitials('Andreas')).toBe('AN');
    expect(playerInitials('Anne C')).toBe('AC');
    expect(playerInitials('')).toBe('?');
  });

  it('renders the uploaded picture when avatar_url is set and a default goblin otherwise', () => {
    const { container, rerender } = render(<PlayerAvatar player={{ id: 'p1', display_name: 'James Haugen', avatar_url: 'https://x/y.png' }} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://x/y.png');
    rerender(<PlayerAvatar player={{ id: 'p1', display_name: 'James Haugen' }} />);
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/^\/avatars\/default\/goblin-\d{2}\.png$/);
    expect(container.textContent).toBe('');
  });

  it('assigns the same default goblin to the same player id', () => {
    const src = (id: string) => render(<PlayerAvatar player={{ id, display_name: 'A' }} />).container.querySelector('img')?.getAttribute('src');
    expect(src('p1')).toBe(src('p1'));
    expect(src('p1')).toBe(defaultAvatarUrl('p1'));
  });
});
