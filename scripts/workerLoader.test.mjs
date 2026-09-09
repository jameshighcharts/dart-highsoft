import { Worker } from 'node:worker_threads';
// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('standalone worker runtime', () => {
  it('starts the actual commentary analysis thread and serves a health probe without network calls', async () => {
    const worker = new Worker(new URL('../src/workers/scoliaCommentaryAnalysisWorker.ts', import.meta.url), {
      workerData: { supabaseUrl: 'https://unused.invalid', serviceRoleKey: 'test-only' },
      execArgv: ['--experimental-strip-types', '--import', new URL('./workerLoader.mjs', import.meta.url).href],
    });
    try {
      const response = new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
      worker.postMessage({ id: 1, task: { kind: 'ping' } });
      expect(await response).toEqual({ id: 1, result: 'pong' });
    } finally { await worker.terminate(); }
  });
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
