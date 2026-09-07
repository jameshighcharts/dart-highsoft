// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('standalone worker runtime', () => {
  it('loads the worker dependency graph without a bundler or temporary loader', () => {
    const cwd = process.cwd();
    const output = execFileSync(process.execPath, [
      '--experimental-strip-types', '--import', './scripts/workerLoader.mjs',
      '--input-type=module', '-e',
      'await import("./src/services/scoliaRealtimeCommentaryPublisher.ts"); console.log("loaded");',
    ], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(output.trim()).toBe('loaded');
  });
});
