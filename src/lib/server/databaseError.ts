type SupabaseErrorLike = { message: string; code?: string | null };

/** Postgres/PostgREST codes for failures that clear on their own: timeouts, lock waits, lost connections. */
const TRANSIENT_CODES = new Set([
  '40001', '40P01', // serialization failure, deadlock
  '55P03', '57014', // lock_timeout, statement_timeout
  '53300', '57P01', '57P02', '57P03', // too many connections, admin/crash shutdown, cannot connect now
  'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003', // PostgREST cannot reach or pool the database
]);
const TRANSIENT_STATUSES = new Set([0, 408, 429, 502, 503, 504, 520, 521, 522, 523, 524]);

export class DatabaseError extends Error {
  readonly code: string | null;
  readonly status: number | null;
  constructor(error: SupabaseErrorLike, status?: number | null) {
    super(error.message);
    this.name = 'DatabaseError';
    this.code = error.code || null;
    this.status = status ?? null;
  }
}

/** Keep the PostgREST status and Postgres code so callers can tell an outage from a bad request. */
export function databaseError(error: SupabaseErrorLike, status?: number | null): DatabaseError {
  return new DatabaseError(error, status);
}

/** True when retrying the same request later can succeed; false for errors that will repeat. */
export function isTransientDatabaseError(error: unknown): boolean {
  if (!(error instanceof DatabaseError)) return false;
  if (error.code && TRANSIENT_CODES.has(error.code)) return true;
  if (error.code?.startsWith('08')) return true; // connection exceptions
  return error.status !== null && TRANSIENT_STATUSES.has(error.status);
}
