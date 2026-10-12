import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Shared data normally comes from the app's own server (`/api/shared`), which tests don't run:
// load it in the test like a browser does when that request fails.
vi.mock('@/lib/shared/fetchShared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shared/fetchShared')>()),
  fetchShared: <T>(_name: string, _params: unknown, fallback: () => Promise<T>) => fallback(),
  expireSharedData: async () => {},
}));

// Route tests exercise the handlers; withSession's sign-in check has its own tests
// (src/lib/auth/withSession.test.ts), and src/app/api/apiRoutes.test.ts checks every route uses it.
vi.mock('@/lib/auth/withSession', () => ({
  withSession: <Args extends unknown[]>(handler: (...args: Args) => Response | Promise<Response>) => handler,
}));
