/**
 * PostgREST and Postgres codes for a function, table or view that does not exist (yet): the
 * frontend can deploy before the migration that adds it, so callers fall back to older queries.
 */
const MISSING_OBJECT_CODES = new Set(['PGRST202', 'PGRST205', '42883', '42P01']);

export function isMissingDatabaseObject(error: { code?: string | null } | null | undefined): boolean {
  return Boolean(error?.code && MISSING_OBJECT_CODES.has(error.code));
}
