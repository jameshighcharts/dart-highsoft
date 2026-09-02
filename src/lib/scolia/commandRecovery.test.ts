import { describe, expect, it } from 'vitest';

import {
  SCOLIA_COMMAND_ACK_TIMEOUT_MS,
  staleCommandAction,
  staleCommandCutoff,
} from './commandRecovery';

describe('Scolia command recovery', () => {
  it('retries stale commands until the bounded attempt limit', () => {
    expect(staleCommandAction(1)).toBe('retry');
    expect(staleCommandAction(2)).toBe('retry');
    expect(staleCommandAction(3)).toBe('fail');
    expect(staleCommandAction(10)).toBe('fail');
  });

  it('computes the acknowledgement timeout cutoff', () => {
    const now = Date.parse('2026-09-01T12:00:00.000Z');
    expect(staleCommandCutoff(now)).toBe(
      new Date(now - SCOLIA_COMMAND_ACK_TIMEOUT_MS).toISOString()
    );
  });
});
