import { describe, expect, it } from 'vitest';

import {
  selectPendingMigrations,
  validateMigrationFiles,
} from './supabase-migrations.mjs';

const baseline = '0055_game_sessions';
const legacyNames = new Set([
  '0055_game_sessions',
  '0055_pause_matches',
  '0056_game_session_integrity',
]);
const files = [...legacyNames].map((name) => `${name}.sql`);

describe('Supabase migration selection', () => {
  it('tracks applied migrations by full name instead of a shared numeric prefix', () => {
    const pending = selectPendingMigrations({
      files,
      legacyNames,
      baseline,
      history: [
        { version: '0055', name: '0055_game_sessions' },
        { version: '20260903072826', name: '0056_game_session_integrity' },
      ],
    });

    expect(pending).toEqual(['0055_pause_matches.sql']);
  });

  it('accepts a unique timestamp migration after the numbered legacy set', () => {
    expect(() => validateMigrationFiles({
      files: [...files, '20260904123000_add_match_column.sql'],
      legacyNames,
      baseline,
    })).not.toThrow();
  });

  it('rejects new numbered migrations even when their number is below the baseline', () => {
    expect(() => validateMigrationFiles({
      files: [...files, '0042_silently_skipped.sql'],
      legacyNames,
      baseline,
    })).toThrow(/must use a unique UTC timestamp name/);
  });

  it('rejects duplicate timestamp versions', () => {
    expect(() => validateMigrationFiles({
      files: [
        ...files,
        '20260904123000_first.sql',
        '20260904123000_second.sql',
      ],
      legacyNames,
      baseline,
    })).toThrow(/used more than once/);
  });
});
