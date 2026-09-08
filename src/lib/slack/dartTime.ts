const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const START_SCORES = ['201', '301', '501'] as const;
const MAX_LEGS = 21;
export const IMMEDIATE_POLL_MINUTES = 5;

export type SlackStartScore = (typeof START_SCORES)[number];
export type SlackFinishRule = 'single_out' | 'double_out';

export type SlackDartCommand = {
  scheduledFor: Date;
  /** True when no clock time was given and the poll closes after a short window. */
  immediate: boolean;
  startScore: SlackStartScore;
  finish: SlackFinishRule;
  legsToWin: number;
};

export type SlackDartCommandResult =
  | { ok: true; command: SlackDartCommand }
  | { ok: false; error: string };

export const SLACK_DART_USAGE =
  'Use `/dart [HH:MM|now] [201|301|501] [legs] [single|double]`, for example ' +
  '`/dart 14:00`, `/dart now 301 2 double` or `/dart 301 single`. ' +
  `Without a time the poll closes after ${IMMEDIATE_POLL_MINUTES} minutes. ` +
  'Defaults: 501, 1 leg, double out.';

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

function nextOccurrence(hour: number, minute: number, now: Date, timeZone: string): Date {
  const today = partsInTimeZone(now, timeZone);
  const requested: DateParts = { ...today, hour, minute, second: 0 };
  let scheduledFor = localPartsToUtc(requested, timeZone);

  if (scheduledFor.getTime() <= now.getTime()) {
    const nextDate = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
    scheduledFor = localPartsToUtc(
      {
        year: nextDate.getUTCFullYear(),
        month: nextDate.getUTCMonth() + 1,
        day: nextDate.getUTCDate(),
        hour,
        minute,
        second: 0,
      },
      timeZone,
    );
  }

  return scheduledFor;
}

/**
 * Parses the text after `/dart`. Every part is optional and order does not
 * matter: a clock time (or `now`), a start score, a number of legs, and a
 * finish rule. Returns a usage error when a token cannot be understood or the
 * same setting is given twice.
 */
export function parseSlackDartCommand(
  input: string,
  options?: { now?: Date; timeZone?: string },
): SlackDartCommandResult {
  const now = options?.now ?? new Date();
  const timeZone = options?.timeZone ?? 'Europe/Oslo';

  const tokens = input.trim().split(/\s+/).filter(Boolean);
  if (tokens[0]?.toLowerCase() === 'dart') tokens.shift();

  let time: { hour: number; minute: number } | null = null;
  let immediate = false;
  let startScore: SlackStartScore | null = null;
  let legsToWin: number | null = null;
  let finish: SlackFinishRule | null = null;

  for (const raw of tokens) {
    const token = raw.toLowerCase();
    const timeMatch = TIME_PATTERN.exec(token);

    if (timeMatch) {
      if (time || immediate) return { ok: false, error: `Only one start time can be given. ${SLACK_DART_USAGE}` };
      time = { hour: Number(timeMatch[1]), minute: Number(timeMatch[2]) };
    } else if (token === 'now') {
      if (time || immediate) return { ok: false, error: `Only one start time can be given. ${SLACK_DART_USAGE}` };
      immediate = true;
    } else if ((START_SCORES as readonly string[]).includes(token)) {
      if (startScore) return { ok: false, error: `Only one start score can be given. ${SLACK_DART_USAGE}` };
      startScore = token as SlackStartScore;
    } else if (/^\d+$/.test(token)) {
      const legs = Number(token);
      if (legs < 1 || legs > MAX_LEGS) {
        return { ok: false, error: `Legs must be between 1 and ${MAX_LEGS}. ${SLACK_DART_USAGE}` };
      }
      if (legsToWin !== null) return { ok: false, error: `Only one legs count can be given. ${SLACK_DART_USAGE}` };
      legsToWin = legs;
    } else if (/^(single|double)([-_]?out)?$/.test(token)) {
      if (finish) return { ok: false, error: `Only one finish rule can be given. ${SLACK_DART_USAGE}` };
      finish = token.startsWith('single') ? 'single_out' : 'double_out';
    } else {
      return { ok: false, error: `I did not understand \`${raw}\`. ${SLACK_DART_USAGE}` };
    }
  }

  const scheduledFor = time
    ? nextOccurrence(time.hour, time.minute, now, timeZone)
    : new Date(now.getTime() + IMMEDIATE_POLL_MINUTES * 60 * 1000);

  return {
    ok: true,
    command: {
      scheduledFor,
      immediate: !time,
      startScore: startScore ?? '501',
      finish: finish ?? 'double_out',
      legsToWin: legsToWin ?? 1,
    },
  };
}

/** Backwards-compatible helper: parses a bare `HH:MM` and nothing else. */
export function parseSlackDartTime(
  input: string,
  options?: { now?: Date; timeZone?: string },
): Date | null {
  const result = parseSlackDartCommand(input, options);
  if (!result.ok || result.command.immediate) return null;
  return result.command.scheduledFor;
}

export function describeSlackDartSettings(settings: {
  startScore: SlackStartScore | string;
  finish: SlackFinishRule | string;
  legsToWin: number;
}): string {
  const legs = `${settings.legsToWin} ${settings.legsToWin === 1 ? 'leg' : 'legs'}`;
  const finish = settings.finish === 'single_out' ? 'single out' : 'double out';
  return `${settings.startScore} · ${legs} · ${finish}`;
}
