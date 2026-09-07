// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('standalone worker runtime', () => {
  it('loads the full worker entry point before validating configuration', () => {
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types', '--import', './scripts/workerLoader.mjs',
      'src/workers/scoliaWorker.ts',
    ], {
      cwd: process.cwd(),
      // Do not load local credentials or allow startup to reach external services.
      env: { NODE_ENV: 'production' },
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('[scolia] worker failed to start Error: SCOLIA_ACCESS_TOKEN is required');
    expect(result.stderr).not.toContain('ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX');
  });

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
