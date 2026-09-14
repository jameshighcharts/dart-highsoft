import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'highdarts.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  reporter: [
    ['list'],
    [
      'html',
      { outputFolder: '/private/tmp/highdarts-e2e-report', open: 'never' },
    ],
  ],
  outputDir: '/private/tmp/highdarts-e2e-results',
  use: {
    baseURL: 'http://127.0.0.1:3017',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
