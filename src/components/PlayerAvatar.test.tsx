import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlayerAvatar, playerInitials } from './PlayerAvatar';

describe('PlayerAvatar', () => {
  it('derives initials', () => {
    expect(playerInitials('James Haugen')).toBe('JH');
    expect(playerInitials('Andreas')).toBe('AN');
    expect(playerInitials('Anne C')).toBe('AC');
    expect(playerInitials('')).toBe('?');
  });

  it('renders an image when avatar_url is set and initials otherwise', () => {
    const { container, rerender } = render(<PlayerAvatar player={{ id: 'p1', display_name: 'James Haugen', avatar_url: 'https://x/y.png' }} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://x/y.png');
    rerender(<PlayerAvatar player={{ id: 'p1', display_name: 'James Haugen' }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('JH');
  });

  it('is deterministic per player id', () => {
    const a = render(<PlayerAvatar player={{ id: 'p1', display_name: 'A' }} />).container.firstElementChild as HTMLElement;
    const b = render(<PlayerAvatar player={{ id: 'p1', display_name: 'A' }} />).container.firstElementChild as HTMLElement;
    expect(a.style.backgroundColor).toBe(b.style.backgroundColor);
  });
});
