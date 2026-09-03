const TIME_PATTERN = /^(?:dart\s+)?([01]\d|2[0-3]):([0-5]\d)$/i;

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function partsInTimeZone(date: Date, timeZone: string): DateParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return parts as DateParts;
}

function localPartsToUtc(parts: DateParts, timeZone: string): Date {
  const desiredUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let candidate = desiredUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = partsInTimeZone(new Date(candidate), timeZone);
    const actualUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    candidate += desiredUtc - actualUtc;
  }
  return new Date(candidate);
}

export function parseSlackDartTime(
  input: string,
  options?: { now?: Date; timeZone?: string },
): Date | null {
  const match = TIME_PATTERN.exec(input.trim());
  if (!match) return null;

  const now = options?.now ?? new Date();
  const timeZone = options?.timeZone ?? 'Europe/Oslo';
  const today = partsInTimeZone(now, timeZone);
  const requested: DateParts = {
    ...today,
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: 0,
  };
  let scheduledFor = localPartsToUtc(requested, timeZone);

  if (scheduledFor.getTime() <= now.getTime()) {
    const nextDate = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
    scheduledFor = localPartsToUtc(
      {
        year: nextDate.getUTCFullYear(),
        month: nextDate.getUTCMonth() + 1,
        day: nextDate.getUTCDate(),
        hour: requested.hour,
        minute: requested.minute,
        second: 0,
      },
      timeZone,
    );
  }

  return scheduledFor;
}
