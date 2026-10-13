// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Committed pages and layouts that render on the server (no 'use client').
const serverFiles = execFileSync('git', ['ls-files', 'src/app'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => /\/(page|layout)\.tsx$/.test(file))
  .filter((file) => !/^\s*['"]use client['"]/.test(readFileSync(file, 'utf8')));

// Reading the database, or server-only helpers that do.
const READS_DATA = /getSupabaseServerClient|getSupabaseClient|from ['"]@\/lib\/server\//;
const CHECKS_SESSION = /requirePageSession\(|getAuthenticatedSession\(/;

describe('server-rendered pages', () => {
  it('finds them', () => {
    expect(serverFiles.length).toBeGreaterThan(5);
  });

  // No proxy guards pages: anyone can request one (see SignInGate), so a page that reads data on
  // the server must check the session itself before it does.
  it('check the session before reading data', () => {
    const unchecked = serverFiles.filter((file) => {
      const source = readFileSync(file, 'utf8');
      return READS_DATA.test(source) && !CHECKS_SESSION.test(source);
    });
    expect(unchecked).toEqual([]);
  });
});
