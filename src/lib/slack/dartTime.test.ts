import { describe, expect, it } from 'vitest';

import { parseSlackDartTime } from './dartTime';

describe('parseSlackDartTime', () => {
  it('interprets a future time in the configured time zone', () => {
    const result = parseSlackDartTime('14:00', {
      now: new Date('2026-09-02T10:00:00.000Z'),
      timeZone: 'Europe/Oslo',
    });

    expect(result?.toISOString()).toBe('2026-09-02T12:00:00.000Z');
  });

  it('schedules the following day when the requested time has passed', () => {
    const result = parseSlackDartTime('dart 14:00', {
      now: new Date('2026-09-02T13:00:00.000Z'),
      timeZone: 'Europe/Oslo',
    });

    expect(result?.toISOString()).toBe('2026-09-03T12:00:00.000Z');
  });

  it('uses the winter offset when daylight saving time is inactive', () => {
    const result = parseSlackDartTime('14:00', {
      now: new Date('2026-01-02T10:00:00.000Z'),
      timeZone: 'Europe/Oslo',
    });

    expect(result?.toISOString()).toBe('2026-01-02T13:00:00.000Z');
  });

  it('rejects malformed or impossible times', () => {
    expect(parseSlackDartTime('2pm')).toBeNull();
    expect(parseSlackDartTime('25:00')).toBeNull();
    expect(parseSlackDartTime('14:90')).toBeNull();
  });
});
