import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Shared data normally comes from the app's own server (`/api/shared`), which tests don't run:
// load it in the test like a browser does when that request fails.
vi.mock('@/lib/shared/fetchShared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/shared/fetchShared')>()),
  fetchShared: <T>(_name: string, _params: unknown, fallback: () => Promise<T>) => fallback(),
  expireSharedData: async () => {},
}));
