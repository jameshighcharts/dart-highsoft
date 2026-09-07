import type {
  DartIQEventPriority,
  DartIQEventSignal,
} from '@/lib/dartiq/events';

export type CommentaryPolicyEvent = {
  eventId: string;
  playerId: string;
  turnId: string;
  dartIndex: number;
  scored: number;
  turnScore: number;
  scoreBefore?: number;
  checkedOut: boolean;
  busted: boolean;
  matchWon: boolean;
  priority: DartIQEventPriority;
  signals: readonly DartIQEventSignal[];
  occurredAtMs?: number;
  storyKey?: string;
};

export type CommentaryPolicyDecision = {
  shouldSpeak: boolean;
  priority: DartIQEventPriority;
  interrupt: boolean;
  guaranteed: boolean;
  observationKey: string;
  reason:
    | 'guaranteed'
    | 'silent-priority'
    | 'visit-in-progress'
    | 'rapid-sequence'
    | 'duplicate-observation'
    | 'cooldown'
    | 'ordinary-sampling'
    | 'active-higher-priority'
    | 'speak';
};

export type CommentaryPolicyOptions = {
  cooldownMs?: Partial<Record<DartIQEventPriority, number>>;
  rapidDartWindowMs?: number;
  repeatWindowMs?: number;
  ordinaryEveryVisits?: number;
  ordinaryQuietWindowMs?: number;
  majorCheckoutMinimum?: number;
};

const PRIORITY_RANK: Record<DartIQEventPriority, number> = {
  silent: 0,
  ordinary: 1,
  notable: 2,
  marquee: 3,
  terminal: 4,
};

const DEFAULT_COOLDOWNS: Record<DartIQEventPriority, number> = {
  silent: 0,
  ordinary: 1_200,
  notable: 600,
  marquee: 0,
  terminal: 0,
};

const SIGNAL_ORDER: readonly DartIQEventSignal[] = [
  'match_win',
  'leg_win',
  'checkout',
  'big_fish',
  'ton_plus_checkout',
  'bull_checkout',
  'nine_darter',
  'nine_dart_pace',
  'break_of_throw',
  'ton_plus_streak',
  'first_nine',
  'one_eighty',
  'back_to_back_t20',
  'one_dart_finish_created',
  'one_dart_finish_unconverted',
  'opponent_checkout_threat',
  'low_scoring_dart',
  'treble_hit',
  'double_hit',
  'missed_board',
  'nikita_special',
  'story_arc',
  'bust',
  'match_finish_chances_unconverted',
  'tiebreak_started',
  'tiebreak_tied',
  'tiebreak_lead_change',
  'favorite_change',
  'large_swing',
  'bogey_created',
  'fair_ending_checkout',
  'fair_ending_round_complete',
];

/**
 * Provider-neutral, listener-local speech policy. Every dart still reaches the
 * model; this class only decides whether that context earns an audio response.
 */
export class CommentaryPolicy {
  private readonly cooldownMs: Record<DartIQEventPriority, number>;
  private readonly rapidDartWindowMs: number;
  private readonly repeatWindowMs: number;
  private readonly ordinaryEveryVisits: number;
  private readonly ordinaryQuietWindowMs: number;
  private readonly majorCheckoutMinimum: number;
  private readonly lastSpokenAtByPriority = new Map<DartIQEventPriority, number>();
  private readonly observations = new Map<string, number>();
  private lastDartAtMs: number | null = null;
  private lastSpokenAtMs: number | null = null;
  private ordinaryVisitsSinceSpeech = 0;
  private activePriority: DartIQEventPriority | null = null;
  private epoch = 0;
  private lastWalkOnAtMs: number | null = null;
  private lastIdleCallAtMs: number | null = null;

  constructor(options: CommentaryPolicyOptions = {}) {
    this.cooldownMs = { ...DEFAULT_COOLDOWNS, ...options.cooldownMs };
    // This only catches duplicate machine bursts; significant human-paced
    // darts may still interrupt a line that is playing.
    this.rapidDartWindowMs = options.rapidDartWindowMs ?? 180;
    this.repeatWindowMs = options.repeatWindowMs ?? 90_000;
    this.ordinaryEveryVisits = Math.max(1, options.ordinaryEveryVisits ?? 1);
    this.ordinaryQuietWindowMs = options.ordinaryQuietWindowMs ?? 10_000;
    this.majorCheckoutMinimum = options.majorCheckoutMinimum ?? 100;
  }

  getEpoch() {
    return this.epoch;
  }

  evaluate(event: CommentaryPolicyEvent, nowMs = event.occurredAtMs ?? Date.now()): CommentaryPolicyDecision {
    this.pruneObservations(nowMs);
    const observationKey = this.observationKey(event);
    const guaranteed = this.isGuaranteed(event);
    const rapid = this.lastDartAtMs !== null && nowMs - this.lastDartAtMs < this.rapidDartWindowMs;
    this.lastDartAtMs = nowMs;

    if (event.priority === 'ordinary' && event.dartIndex >= 3) {
      this.ordinaryVisitsSinceSpeech += 1;
    }

    if (guaranteed) {
      return this.commit(event.priority, observationKey, nowMs, true, 'guaranteed');
    }
    if (event.priority === 'silent') {
      return this.reject(event.priority, observationKey, 'silent-priority');
    }
    if (rapid && PRIORITY_RANK[event.priority] <= PRIORITY_RANK.notable) {
      return this.reject(event.priority, observationKey, 'rapid-sequence');
    }
    if (this.observations.has(observationKey)) {
      return this.reject(event.priority, observationKey, 'duplicate-observation');
    }

    const lastForPriority = this.lastSpokenAtByPriority.get(event.priority);
    if (lastForPriority !== undefined && nowMs - lastForPriority < this.cooldownMs[event.priority]) {
      return this.reject(event.priority, observationKey, 'cooldown');
    }

    if (
      this.activePriority
      && PRIORITY_RANK[event.priority] < PRIORITY_RANK[this.activePriority]
    ) {
      return this.reject(event.priority, observationKey, 'active-higher-priority');
    }

    const significant = PRIORITY_RANK[event.priority] >= PRIORITY_RANK.marquee
      || (event.priority === 'notable' && event.signals.some((signal) => [
        'large_swing', 'bust', 'one_dart_finish_created',
        'one_dart_finish_unconverted', 'back_to_back_t20',
      ].includes(signal)));
    // Routine speech has a playback-length cooldown, not a replacement queue.
    if (this.activePriority && !significant) {
      return this.reject(event.priority, observationKey, 'cooldown');
    }

    if (event.priority === 'ordinary') {
      const hasBeenQuiet = this.lastSpokenAtMs === null
        || nowMs - this.lastSpokenAtMs >= this.ordinaryQuietWindowMs;
      if (
        this.ordinaryEveryVisits > 1
        && !hasBeenQuiet
        && this.ordinaryVisitsSinceSpeech < this.ordinaryEveryVisits
      ) {
        return this.reject(event.priority, observationKey, 'ordinary-sampling');
      }
    }

    return this.commit(event.priority, observationKey, nowMs, false, 'speak');
  }

  responseFinished() {
    this.activePriority = null;
  }

  /** Walk-up banter fills a quiet gap; it never displaces a live reaction. */
  canStartAmbientCall(nowMs = Date.now()) {
    return this.activePriority === null
      && (this.lastSpokenAtMs === null || nowMs - this.lastSpokenAtMs >= this.ordinaryQuietWindowMs);
  }

  /** Takeout supplies a real gap: occasional score-bearing walk-ons fit here. */
  canStartWalkOn(nowMs = Date.now()) {
    return this.activePriority === null
      && (this.lastSpokenAtMs === null || nowMs - this.lastSpokenAtMs >= 2_500)
      && (this.lastWalkOnAtMs === null || nowMs - this.lastWalkOnAtMs >= 25_000);
  }

  recordWalkOn(nowMs = Date.now()) {
    this.lastWalkOnAtMs = nowMs;
    this.recordAmbientCall(nowMs, true);
  }

  canStartIdleCall(nowMs = Date.now()) {
    return this.canStartAmbientCall(nowMs)
      && (this.lastIdleCallAtMs === null || nowMs - this.lastIdleCallAtMs >= 60_000);
  }

  recordIdleCall(nowMs = Date.now()) {
    this.lastIdleCallAtMs = nowMs;
    this.recordAmbientCall(nowMs, true);
  }

  /** Seeds cadence after a non-dart opening call without inventing an observation. */
  recordAmbientCall(nowMs = Date.now(), active = false) {
    this.lastSpokenAtMs = nowMs;
    this.lastSpokenAtByPriority.set('ordinary', nowMs);
    this.ordinaryVisitsSinceSpeech = 0;
    this.activePriority = active ? 'ordinary' : null;
  }

  reset(epoch?: number) {
    this.epoch = epoch ?? this.epoch + 1;
    this.lastSpokenAtByPriority.clear();
    this.observations.clear();
    this.lastDartAtMs = null;
    this.lastWalkOnAtMs = null;
    this.lastIdleCallAtMs = null;
    this.lastSpokenAtMs = null;
    this.ordinaryVisitsSinceSpeech = 0;
    this.activePriority = null;
  }

  private commit(
    priority: DartIQEventPriority,
    observationKey: string,
    nowMs: number,
    guaranteed: boolean,
    reason: CommentaryPolicyDecision['reason']
  ): CommentaryPolicyDecision {
    const interrupt = this.activePriority !== null;
    this.activePriority = priority;
    this.lastSpokenAtMs = nowMs;
    this.lastSpokenAtByPriority.set(priority, nowMs);
    this.observations.set(observationKey, nowMs);
    if (priority === 'ordinary') this.ordinaryVisitsSinceSpeech = 0;
    return { shouldSpeak: true, priority, interrupt, guaranteed, observationKey, reason };
  }

  private reject(
    priority: DartIQEventPriority,
    observationKey: string,
    reason: CommentaryPolicyDecision['reason']
  ): CommentaryPolicyDecision {
    return { shouldSpeak: false, priority, interrupt: false, guaranteed: false, observationKey, reason };
  }

  private isGuaranteed(event: CommentaryPolicyEvent) {
    const signals = new Set(event.signals);
    return event.matchWon
      || signals.has('match_win')
      || signals.has('leg_win')
      || signals.has('one_eighty')
      || signals.has('nine_dart_pace')
      || signals.has('nine_darter')
      || signals.has('nikita_special')
      || (signals.has('bust') && event.priority === 'marquee')
      || (event.checkedOut && (event.scoreBefore ?? 0) >= this.majorCheckoutMinimum);
  }

  private observationKey(event: CommentaryPolicyEvent) {
    const signal = SIGNAL_ORDER.find((candidate) => event.signals.includes(candidate));
    if (
      signal === 'match_win'
      || signal === 'leg_win'
      || signal === 'checkout'
      || signal === 'one_eighty'
      || signal === 'back_to_back_t20'
      || signal === 'one_dart_finish_created'
      || signal === 'one_dart_finish_unconverted'
      || signal === 'low_scoring_dart'
      || signal === 'treble_hit'
      || signal === 'double_hit'
      || signal === 'missed_board'
      || signal === 'opponent_checkout_threat'
      || signal === 'bust'
      || signal === 'nine_dart_pace'
      || signal === 'nine_darter'
      || signal === 'bogey_created'
    ) {
      return `${signal}:${event.eventId}`;
    }
    if (signal === 'story_arc') return `story_arc:${event.storyKey ?? event.playerId}`;
    if (signal) return `${signal}:${event.playerId}`;
    if (event.busted) return `bust:${event.eventId}`;
    return event.dartIndex < 3
      ? `ordinary-dart:${event.eventId}`
      : `ordinary:${event.turnId}`;
  }

  private pruneObservations(nowMs: number) {
    for (const [key, seenAt] of this.observations) {
      if (nowMs - seenAt > this.repeatWindowMs) this.observations.delete(key);
    }
  }
}

export function priorityInstruction(priority: DartIQEventPriority) {
  if (priority === 'terminal') {
    return 'name the supplied winner · strongest payoff';
  }
  if (priority === 'marquee') {
    return 'big moment · react immediately';
  }
  if (priority === 'notable') {
    return 'fresh meaningful reaction';
  }
  return 'optional quick reaction';
}

export function visitScopeInstruction(input: {
  dartIndex: number;
  turnScore: number;
  checkedOut: boolean;
  busted: boolean;
  visitDarts?: readonly { segment: string; scored: number }[];
}) {
  const endedVisit = input.dartIndex >= 3 || input.checkedOut || input.busted;
  if (endedVisit) {
    return 'completed visit';
  }
  return 'mid-visit';
}
