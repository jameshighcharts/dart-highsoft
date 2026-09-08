import { describe, expect, it } from 'vitest';

import { parseSlackDartCommand, parseSlackDartTime, describeSlackDartSettings } from './dartTime';

const now = new Date('2026-09-02T10:00:00.000Z');
const opts = { now, timeZone: 'Europe/Oslo' };

function parse(text: string, options = opts) {
  const result = parseSlackDartCommand(text, options);
  if (!result.ok) throw new Error(result.error);
  return result.command;
}

describe('parseSlackDartTime', () => {
  it('interprets a future time in the configured time zone', () => {
    const result = parseSlackDartTime('14:00', opts);
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

describe('parseSlackDartCommand', () => {
  it('defaults to a five-minute window and a one-leg 501 double-out match', () => {
    const command = parse('');
    expect(command.immediate).toBe(true);
    expect(command.scheduledFor.toISOString()).toBe('2026-09-02T10:05:00.000Z');
    expect(command.startScore).toBe('501');
    expect(command.finish).toBe('double_out');
    expect(command.legsToWin).toBe(1);
  });

  it('treats "now" the same as no time', () => {
    const command = parse('now');
    expect(command.immediate).toBe(true);
    expect(command.scheduledFor.toISOString()).toBe('2026-09-02T10:05:00.000Z');
  });

  it('accepts every setting in any order', () => {
    const command = parse('double 2 301 14:00');
    expect(command.immediate).toBe(false);
    expect(command.scheduledFor.toISOString()).toBe('2026-09-02T12:00:00.000Z');
    expect(command.startScore).toBe('301');
    expect(command.finish).toBe('double_out');
    expect(command.legsToWin).toBe(2);
  });

  it('supports the old bot style with settings but no time', () => {
    const command = parse('201 3 single');
    expect(command.immediate).toBe(true);
    expect(command.startScore).toBe('201');
    expect(command.legsToWin).toBe(3);
    expect(command.finish).toBe('single_out');
  });

  it('accepts single-out and double_out spellings and single-digit hours', () => {
    expect(parse('single-out').finish).toBe('single_out');
    expect(parse('double_out').finish).toBe('double_out');
    expect(parse('9:30').scheduledFor.toISOString()).toBe('2026-09-03T07:30:00.000Z');
  });

  it('rejects unknown tokens with usage help', () => {
    const result = parseSlackDartCommand('14:00 tripleout', opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('tripleout');
  });

  it('rejects duplicate or out-of-range settings', () => {
    expect(parseSlackDartCommand('14:00 15:00', opts).ok).toBe(false);
    expect(parseSlackDartCommand('now 14:00', opts).ok).toBe(false);
    expect(parseSlackDartCommand('301 501', opts).ok).toBe(false);
    expect(parseSlackDartCommand('2 3', opts).ok).toBe(false);
    expect(parseSlackDartCommand('single double', opts).ok).toBe(false);
    expect(parseSlackDartCommand('0', opts).ok).toBe(false);
    expect(parseSlackDartCommand('99', opts).ok).toBe(false);
  });
});

describe('describeSlackDartSettings', () => {
  it('formats the settings for humans', () => {
    expect(describeSlackDartSettings({ startScore: '501', finish: 'double_out', legsToWin: 1 }))
      .toBe('501 · 1 leg · double out');
    expect(describeSlackDartSettings({ startScore: '301', finish: 'single_out', legsToWin: 2 }))
      .toBe('301 · 2 legs · single out');
  });
});
