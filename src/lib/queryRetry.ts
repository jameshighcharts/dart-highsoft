/** PostgREST and Postgres codes for failures that can clear on their own. */
const TRANSIENT_DATABASE_CODES = new Set([
  '40001', '40P01', // serialization failure, deadlock
  '55P03', '57014', // lock_timeout, statement_timeout
  '53300', '57P01', '57P02', '57P03', // too many connections, shutdown, cannot connect now
]);

function isTransient(error: unknown): boolean {
  const { status, code } = (error ?? {}) as { status?: unknown; code?: unknown };
  if (typeof status === 'number') return status >= 500 || status === 408 || status === 429;
  if (typeof code === 'string' && code !== '') {
    // PGRST0xx: PostgREST cannot reach the database. Anything else (a missing table or function,
    // a bad filter, a constraint) fails the same way every time.
    return code.startsWith('PGRST0') || code.startsWith('08') || TRANSIENT_DATABASE_CODES.has(code);
  }
  // No status or code: a network failure (fetch rejected), worth one more try.
  return true;
}

/**
 * Retry a failed query once, and only when the failure can clear on its own. React Query's default
 * of three retries with backoff kept a skeleton up for about seven seconds before showing an error,
 * even for errors that can never succeed.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  return failureCount < 1 && isTransient(error);
}
