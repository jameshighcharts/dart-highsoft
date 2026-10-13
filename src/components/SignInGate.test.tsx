import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ pathname: '/stats', signedOut: true }));
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }));
vi.mock('@/lib/supabaseAccessToken', () => ({ isSignedOut: vi.fn(async () => state.signedOut) }));

import { SignInGate } from './SignInGate';

const replace = vi.fn();
Object.defineProperty(window, 'location', {
  value: { origin: 'https://darts.example', pathname: '/stats', search: '?player=a', replace },
  writable: true,
});

afterEach(() => {
  cleanup();
  replace.mockReset();
});

describe('SignInGate', () => {
  it('sends a signed-out visitor to sign in, coming back to the page afterwards', async () => {
    state.pathname = '/stats';
    state.signedOut = true;
    render(<SignInGate />);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('https://darts.example/login?callbackUrl=%2Fstats%3Fplayer%3Da'));
  });

  it('sends admin pages to the admin sign-in', async () => {
    state.pathname = '/admin/players';
    state.signedOut = true;
    render(<SignInGate />);
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/darts\.example\/signin\?callbackUrl=/)));
  });

  it('leaves signed-in members and the sign-in pages alone', async () => {
    state.signedOut = false;
    state.pathname = '/';
    render(<SignInGate />);
    state.signedOut = true;
    state.pathname = '/login';
    render(<SignInGate />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(replace).not.toHaveBeenCalled();
  });
});
