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
  ordinary: 12_000,
  notable: 5_000,
  marquee: 1_500,
  terminal: 0,
};

const SIGNAL_ORDER: readonly DartIQEventSignal[] = [
  'match_win',
  'leg_win',
  'checkout',
  'one_eighty',
  'nikita_special',
  'story_arc',
  'bust',
  'tiebreak_started',
  'tiebreak_tied',
  'tiebreak_lead_change',
  'favorite_change',
  'large_swing',
  'great_setup',
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

  constructor(options: CommentaryPolicyOptions = {}) {
    this.cooldownMs = { ...DEFAULT_COOLDOWNS, ...options.cooldownMs };
    this.rapidDartWindowMs = options.rapidDartWindowMs ?? 650;
    this.repeatWindowMs = options.repeatWindowMs ?? 90_000;
    this.ordinaryEveryVisits = Math.max(1, options.ordinaryEveryVisits ?? 3);
    this.ordinaryQuietWindowMs = options.ordinaryQuietWindowMs ?? 20_000;
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
    const earnedMidVisitReaction = event.priority === 'notable'
      && event.signals.includes('large_swing');
    if (
      (event.priority === 'ordinary' || event.priority === 'notable')
      && event.dartIndex < 3
      && !event.checkedOut
      && !event.busted
      && !earnedMidVisitReaction
    ) {
      return this.reject(event.priority, observationKey, 'visit-in-progress');
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

    if (event.priority === 'ordinary') {
      const hasBeenQuiet = this.lastSpokenAtMs === null
        || nowMs - this.lastSpokenAtMs >= this.ordinaryQuietWindowMs;
      if (!hasBeenQuiet && this.ordinaryVisitsSinceSpeech < this.ordinaryEveryVisits) {
        return this.reject(event.priority, observationKey, 'ordinary-sampling');
      }
    }

    return this.commit(event.priority, observationKey, nowMs, false, 'speak');
  }

  responseFinished() {
    this.activePriority = null;
  }

  reset(epoch?: number) {
    this.epoch = epoch ?? this.epoch + 1;
    this.lastSpokenAtByPriority.clear();
    this.observations.clear();
    this.lastDartAtMs = null;
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
      || signal === 'bogey_created'
    ) {
      return `${signal}:${event.eventId}`;
    }
    if (signal === 'story_arc') return `story_arc:${event.storyKey ?? event.playerId}`;
    if (signal) return `${signal}:${event.playerId}`;
    if (event.busted) return `bust:${event.playerId}`;
    return `ordinary:${event.playerId}:${Math.round(event.turnScore / 10) * 10}`;
  }

  private pruneObservations(nowMs: number) {
    for (const [key, seenAt] of this.observations) {
      if (nowMs - seenAt > this.repeatWindowMs) this.observations.delete(key);
    }
  }
}

export function priorityInstruction(priority: DartIQEventPriority) {
  if (priority === 'terminal') {
    return 'Moment: match ending. Name the winner and land the strongest supplied payoff.';
  }
  if (priority === 'marquee') {
    return 'Moment: marquee. React immediately and make the stakes feel big.';
  }
  if (priority === 'notable') {
    return 'Moment: notable. Call what changed with personality.';
  }
  return 'Moment: ordinary. Drop a casual reaction; a fresh joke matters more than formal analysis.';
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
    return 'Scope: react to the completed visit as one beat. Focus on the final dart only when it caused the checkout, bust, or decisive leave.';
  }
  return 'Scope: react to this decisive dart; the visit is still underway.';
}
