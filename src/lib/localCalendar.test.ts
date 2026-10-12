import { afterEach, describe, expect, it } from 'vitest';
import { calendarIn, isValidTimeZone } from './localCalendar';

const originalTimeZone = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTimeZone;
});

// What the browser code did in its own zone, to compare against.
const native = {
  startOfDay: (date: Date) => { const day = new Date(date); day.setHours(0, 0, 0, 0); return day; },
  addDays: (date: Date, days: number) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; },
};

const INSTANTS = [
  '2026-03-29T00:30:00Z', // the night Europe moves its clocks forward
  '2026-03-28T23:30:00Z',
  '2026-10-25T00:30:00Z', // and back
  '2026-10-25T23:59:59.500Z',
  '2026-03-08T07:30:00Z', // the US moves forward
  '2026-11-01T05:30:00Z',
  '2026-08-12T13:10:00Z',
  '2026-12-31T23:30:00Z',
];

describe('calendarIn', () => {
  for (const timeZone of ['Europe/Oslo', 'America/New_York', 'UTC', 'Asia/Kolkata']) {
    it(`matches the native local-time methods in ${timeZone}`, () => {
      process.env.TZ = timeZone;
      const calendar = calendarIn(timeZone);
      for (const iso of INSTANTS) {
        const date = new Date(iso);
        expect(calendar.startOfDay(date).toISOString(), iso).toBe(native.startOfDay(date).toISOString());
        expect(calendar.dayOfWeek(date), iso).toBe(date.getDay());
        for (const days of [-60, -29, -7, -6, -1, 1, 7]) {
          expect(calendar.addDays(date, days).toISOString(), `${iso} ${days}`).toBe(native.addDays(date, days).toISOString());
          const midnight = native.startOfDay(date);
          expect(calendar.addDays(midnight, days).toISOString(), `${iso} midnight ${days}`)
            .toBe(native.addDays(midnight, days).toISOString());
        }
      }
    });
  }

  it('gives the local date', () => {
    expect(calendarIn('Europe/Oslo').dateKey(new Date('2026-08-12T22:30:00Z'))).toBe('2026-08-13');
    expect(calendarIn('UTC').dateKey(new Date('2026-08-12T22:30:00Z'))).toBe('2026-08-12');
  });

  it('rejects unknown zones', () => {
    expect(isValidTimeZone('Europe/Oslo')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });
});
