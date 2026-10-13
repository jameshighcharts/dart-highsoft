// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const committed = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
const source = (file: string) => readFileSync(file, 'utf8');
const isClient = (file: string) => /^\s*['"]use client['"]/.test(source(file));

// Pages, layouts and other components that render on the server (no 'use client'), outside the
// API (whose routes withSession guards) and the server helpers they call.
const serverComponents = committed.filter((file) =>
  /\.tsx$/.test(file) && !file.startsWith('src/app/api/') && !isClient(file));
// Files of Server Actions: anyone can call one, its id is in the page's JavaScript.
const actionFiles = committed.filter((file) => /^\s*['"]use server['"]/.test(source(file)));

// Reading the database, server-only helpers that do, or the shared cache.
const PRIVILEGED = /getSupabaseServerClient|getSupabaseClient|from ['"]@\/lib\/server\/|updateTag\(|revalidateTag\(/;
const CHECKS_SESSION = /requirePageSession\(|getAuthenticatedSession\(/;

describe('server-rendered code', () => {
  it('finds it', () => {
    expect(serverComponents.length).toBeGreaterThan(5);
    expect(actionFiles).toContain('src/lib/shared/purge.ts');
  });

  // No proxy guards pages: anyone can request one (see SignInGate), so server code that reads data
  // or acts must check the session itself.
  it('checks the session before reading data or acting', () => {
    const unchecked = [...serverComponents, ...actionFiles].filter((file) =>
      PRIVILEGED.test(source(file)) && !CHECKS_SESSION.test(source(file)));
    expect(unchecked).toEqual([]);
  });
});
