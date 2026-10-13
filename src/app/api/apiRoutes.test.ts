// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { PUBLIC_API_ROUTES } from '@/lib/auth/publicApiRoutes';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// Committed routes; work in progress that isn't committed yet is checked once it is.
const routeFiles = execFileSync('git', ['ls-files', 'src/app/api'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => file.endsWith('/route.ts'));
const routeOf = (file: string) => file.slice('src/app/api/'.length, -'/route.ts'.length);

describe('API routes', () => {
  it('finds the routes', () => {
    expect(routeFiles.length).toBeGreaterThan(40);
    for (const route of PUBLIC_API_ROUTES) expect(routeFiles.map(routeOf)).toContain(route);
  });

  // There is no proxy in front of requests, so a route is only protected by its own check.
  it('checks the session in every route that is not explicitly public', () => {
    const unprotected: string[] = [];
    for (const file of routeFiles) {
      if ((PUBLIC_API_ROUTES as readonly string[]).includes(routeOf(file))) continue;
      const source = readFileSync(file, 'utf8');
      for (const method of METHODS) {
        const declared = new RegExp(`^export (async )?function ${method}\\b`, 'm').test(source);
        const exported = new RegExp(`^export const ${method}\\b`, 'm').test(source)
          || new RegExp(`^export const \\{[^}]*\\b${method}\\b`, 'm').test(source);
        const wrapped = new RegExp(`^export const ${method} = withSession\\(`, 'm').test(source);
        if (declared || (exported && !wrapped)) unprotected.push(`${routeOf(file)} ${method}`);
      }
    }
    expect(unprotected).toEqual([]);
  });
});
