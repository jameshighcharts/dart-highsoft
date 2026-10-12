import { describe, expect, it } from 'vitest';
import { databaseError, isTransientDatabaseError } from './databaseError';

describe('isTransientDatabaseError', () => {
  it.each([
    ['network failure', { message: 'TypeError: fetch failed', code: '' }, 0],
    ['gateway error', { message: 'Bad Gateway' }, 502],
    ['lock timeout', { message: 'canceling statement due to lock timeout', code: '55P03' }, 500],
    ['deadlock', { message: 'deadlock detected', code: '40P01' }, 500],
    ['pool exhausted', { message: 'Timed out acquiring connection', code: 'PGRST003' }, 504],
    ['connection exception', { message: 'connection failure', code: '08006' }, 503],
  ])('retries a %s', (_name, error, status) => {
    expect(isTransientDatabaseError(databaseError(error, status))).toBe(true);
  });

  it.each([
    ['constraint violation', { message: 'duplicate key', code: '23505' }, 409],
    ['raised exception', { message: 'Match is not active', code: 'P0001' }, 400],
    ['SQL bug', { message: 'column does not exist', code: '42703' }, 400],
  ])('gives up on a %s', (_name, error, status) => {
    expect(isTransientDatabaseError(databaseError(error, status))).toBe(false);
  });

  it('does not treat plain errors as transient', () => {
    expect(isTransientDatabaseError(new Error('fetch failed'))).toBe(false);
  });
});
