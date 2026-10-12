import { describe, expect, it } from 'vitest';
import { ApiError } from './apiClient';
import { shouldRetryQuery } from './queryRetry';

describe('shouldRetryQuery', () => {
  it.each([
    ['a network failure', new TypeError('Failed to fetch')],
    ['a 503 from an API route', new ApiError('Highdarts is unavailable', 503)],
    ['a rate limit', new ApiError('Slow down', 429)],
    ['PostgREST losing the database', { code: 'PGRST001', message: 'Database client error' }],
    ['a statement timeout', { code: '57014', message: 'canceling statement' }],
  ])('retries %s once', (_name, error) => {
    expect(shouldRetryQuery(0, error)).toBe(true);
    expect(shouldRetryQuery(1, error)).toBe(false);
  });

  it.each([
    ['a missing table', { code: 'PGRST205', message: 'Could not find the table' }],
    ['a missing function', { code: 'PGRST202', message: 'Could not find the function' }],
    ['an undefined column', { code: '42703', message: 'column does not exist' }],
    ['an unauthorized API call', new ApiError('Unauthorized', 401)],
    ['a bad request', new ApiError('Invalid', 400)],
  ])('never retries %s', (_name, error) => {
    expect(shouldRetryQuery(0, error)).toBe(false);
  });
});
