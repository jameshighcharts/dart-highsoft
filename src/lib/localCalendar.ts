/**
 * Calendar arithmetic in one IANA time zone: what `setHours(0, 0, 0, 0)`, `setDate` and `getDay`
 * do in the browser's own zone, for any zone. The server runs in UTC, so data it computes for a
 * viewer (such as "this week" or per-day counts) needs the viewer's zone passed explicitly.
 */
export type LocalCalendar = {
  timeZone: string;
  /** Local midnight of the day `date` falls on. */
  startOfDay(date: Date): Date;
  /** The same local wall-clock time `days` calendar days later (across DST changes, like `setDate`). */
  addDays(date: Date, days: number): Date;
  /** 0 for Sunday through 6 for Saturday, like `getDay`. */
  dayOfWeek(date: Date): number;
  /** The local date as YYYY-MM-DD. */
  dateKey(date: Date): string;
};

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number; ms: number };

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function calendarIn(timeZone: string): LocalCalendar {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });

  const wallClock = (instant: number): WallClock => {
    const parts: Record<string, number> = {};
    for (const part of format.formatToParts(new Date(instant))) {
      if (part.type !== 'literal') parts[part.type] = Number(part.value);
    }
    return {
      year: parts.year,
      month: parts.month - 1,
      day: parts.day,
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second,
      ms: ((instant % 1000) + 1000) % 1000,
    };
  };
  const asUtc = (wall: WallClock) =>
    Date.UTC(wall.year, wall.month, wall.day, wall.hour, wall.minute, wall.second, wall.ms);
  // How far the zone's wall clock is ahead of UTC at `instant`.
  const offsetAt = (instant: number) => asUtc(wallClock(instant)) - instant;
  // The instant a wall-clock time happens in the zone; Date.UTC normalizes overflowing days.
  const fromWallClock = (wall: WallClock) => {
    const guess = asUtc(wall);
    // The offset at the guess may be on the wrong side of a DST change; the one it leads to is not.
    return new Date(guess - offsetAt(guess - offsetAt(guess)));
  };

  return {
    timeZone,
    startOfDay: (date) => fromWallClock({ ...wallClock(date.getTime()), hour: 0, minute: 0, second: 0, ms: 0 }),
    addDays: (date, days) => {
      const wall = wallClock(date.getTime());
      return fromWallClock({ ...wall, day: wall.day + days });
    },
    dayOfWeek: (date) => {
      const wall = wallClock(date.getTime());
      return new Date(Date.UTC(wall.year, wall.month, wall.day)).getUTCDay();
    },
    dateKey: (date) => {
      const wall = wallClock(date.getTime());
      return new Date(Date.UTC(wall.year, wall.month, wall.day)).toISOString().slice(0, 10);
    },
  };
}
