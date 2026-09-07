import type { DartIQDartEvent } from '@/lib/dartiq/replay';
import type { FinishRule } from '@/utils/x01';
import {
  rankCommentaryStoryArcs,
  type CommentaryStoryArc,
  type CommentaryStoryArcKind,
} from './storyArcDirector.ts';

export type BroadcastArcTransition =
  | 'none'
  | 'started'
  | 'continued'
  | 'switched'
  | 'payoff_due'
  | 'closure_due';

export type BroadcastCallbackTrigger =
  | 'probability_reversal'
  | 'next_checkout_chance'
  | 'next_pressure_conversion'
  | 'leg_resolution'
  | 'match_resolution';

export type BroadcastCallbackObligation = {
  arcKey: string;
  trigger: BroadcastCallbackTrigger;
  status: 'watching' | 'payoff_due' | 'closure_due' | 'response_completed';
};

export type BroadcastDirection = {
  schemaVersion: 1;
  sequence: number;
  activeStoryArc: CommentaryStoryArc | null;
  backgroundStoryArcs: CommentaryStoryArc[];
  transition: BroadcastArcTransition;
  callback: BroadcastCallbackObligation | null;
  shouldPromote: boolean;
  lifecycleEvents: BroadcastArcLifecycleEvent[];
};

export type BroadcastArcLifecycleEvent = {
  type: 'opened' | 'switched_in' | 'payoff_due' | 'closure_due' | 'closed';
  arcKey: string;
  arc: CommentaryStoryArc;
  callbackTrigger: BroadcastCallbackTrigger;
  closeReason?: 'superseded' | 'unsupported';
};

export type BroadcastStoryBeat = {
  sequence: number;
  dartId: string;
  legNumber: number;
  arcKey: string;
  arc: CommentaryStoryArc;
  transition: Extract<BroadcastArcTransition, 'started' | 'switched' | 'payoff_due' | 'closure_due'>;
  callbackTrigger: BroadcastCallbackTrigger | null;
};

type ActiveStory = {
  arc: CommentaryStoryArc;
  key: string;
  startedAtSequence: number;
  unsupportedEvents: number;
};

const PHASE_RANK = { developing: 0, established: 1, payoff: 2 } as const;
const SWITCH_MARGIN = 0.18;
const MIN_COMMIT_DARTS = 3;
const UNSUPPORTED_GRACE_DARTS = 3;
const STORY_MENTION_GAP_DARTS = 6;

export function storyArcKey(arc: CommentaryStoryArc) {
  return `${arc.kind}:${arc.subjectPlayerId ?? 'match'}:${arc.counterpartPlayerId ?? 'none'}`;
}

export function callbackTriggerForArcKind(kind: CommentaryStoryArcKind): BroadcastCallbackTrigger {
  if (kind === 'finish_chance_punished' || kind === 'checkout_duel') return 'next_checkout_chance';
  if (kind === 'pressure_resilience') return 'next_pressure_conversion';
  if (kind === 'rematch_revenge' || kind === 'underdog_rising') return 'match_resolution';
  if (kind === 'comeback' || kind === 'collapse' || kind === 'seesaw_match') {
    return 'probability_reversal';
  }
  return 'leg_resolution';
}

function withMonotonicPhase(previous: CommentaryStoryArc, next: CommentaryStoryArc) {
  if (PHASE_RANK[next.phase] >= PHASE_RANK[previous.phase]) return next;
  return { ...next, phase: previous.phase };
}

/**
 * Stateful listener-local producer. DartIQ proposes stories; this class
 * protects continuity, keeps reserves, and owns callback/payoff obligations.
 */
export class BroadcastDirector {
  private active: ActiveStory | null = null;
  private callback: BroadcastCallbackObligation | null = null;
  private readonly lastMentionAt = new Map<string, number>();

  direct(input: {
    sequence: number;
    candidates: readonly CommentaryStoryArc[];
    matchWinnerId?: string | null;
    observedTriggers?: readonly BroadcastCallbackTrigger[];
    triggerPlayerId?: string | null;
  }): BroadcastDirection {
    const candidates = input.candidates.slice(0, 3);
    const proposal = candidates[0] ?? null;
    let transition: BroadcastArcTransition = 'none';
    let activatedThisCall = false;
    const lifecycleEvents: BroadcastArcLifecycleEvent[] = [];

    if (!this.active && proposal) {
      this.activate(proposal, input.sequence);
      activatedThisCall = true;
      transition = 'started';
      lifecycleEvents.push(this.lifecycle('opened'));
    } else if (this.active) {
      const supported = candidates.find((arc) => storyArcKey(arc) === this.active?.key);
      if (supported) {
        this.active.arc = withMonotonicPhase(this.active.arc, supported);
        this.active.unsupportedEvents = 0;
      } else {
        this.active.unsupportedEvents += 1;
      }

      if (proposal && storyArcKey(proposal) !== this.active.key) {
        const committedFor = input.sequence - this.active.startedAtSequence;
        const challengerEarnedSwitch = proposal.phase === 'payoff'
          || (
            committedFor >= MIN_COMMIT_DARTS
            && proposal.strength >= this.active.arc.strength + SWITCH_MARGIN
          )
          || this.active.unsupportedEvents >= UNSUPPORTED_GRACE_DARTS;
        if (challengerEarnedSwitch) {
          lifecycleEvents.push(this.lifecycle('closed', 'superseded'));
          this.activate(proposal, input.sequence);
          activatedThisCall = true;
          transition = 'switched';
          lifecycleEvents.push(this.lifecycle('switched_in'));
        }
      } else if (!proposal && this.active.unsupportedEvents >= UNSUPPORTED_GRACE_DARTS) {
        lifecycleEvents.push(this.lifecycle('closed', 'unsupported'));
        this.active = null;
        this.callback = null;
      }

      if (this.active && transition === 'none') transition = 'continued';
    }

    const winnerId = input.matchWinnerId ?? null;
    const callbackObserved = Boolean(
      !activatedThisCall
      && this.callback
      && input.observedTriggers?.includes(this.callback.trigger)
    );
    if (
      this.active
      && this.callback?.status !== 'response_completed'
      && (this.active.arc.phase === 'payoff' || winnerId || callbackObserved)
    ) {
      const resolvingPlayerId = winnerId ?? input.triggerPlayerId ?? null;
      const storySucceeded = !resolvingPlayerId
        || !this.active.arc.subjectPlayerId
        || resolvingPlayerId === this.active.arc.subjectPlayerId;
      transition = storySucceeded ? 'payoff_due' : 'closure_due';
      if (this.callback) {
        this.callback = {
          ...this.callback,
          status: storySucceeded ? 'payoff_due' : 'closure_due',
        };
      }
      lifecycleEvents.push(this.lifecycle(storySucceeded ? 'payoff_due' : 'closure_due'));
    }

    const activeArc = this.active?.arc ?? null;
    const activeKey = this.active?.key ?? null;
    const lastMention = activeKey ? this.lastMentionAt.get(activeKey) : undefined;
    const mentionGapOpen = lastMention === undefined
      || input.sequence - lastMention >= STORY_MENTION_GAP_DARTS;
    const shouldPromote = Boolean(
      activeArc
      && (
        transition === 'payoff_due'
        || transition === 'closure_due'
        || (
          mentionGapOpen
          && (
            transition === 'started'
            || transition === 'switched'
            || (transition === 'continued' && lastMention === undefined)
          )
        )
      )
    );
    const backgroundStoryArcs = candidates
      .filter((arc) => storyArcKey(arc) !== activeKey)
      .slice(0, 2);

    return {
      schemaVersion: 1,
      sequence: input.sequence,
      activeStoryArc: activeArc,
      backgroundStoryArcs,
      transition,
      callback: this.callback,
      shouldPromote,
      lifecycleEvents,
    };
  }

  markMentioned(direction: BroadcastDirection) {
    const arc = direction.activeStoryArc;
    if (!arc) return;
    this.lastMentionAt.set(storyArcKey(arc), direction.sequence);
  }

  /** Stops retrying a due callback after the provider produced a completed transcript. */
  markResponseCompleted(direction: BroadcastDirection) {
    this.markMentioned(direction);
    const completedArcKey = direction.activeStoryArc
      ? storyArcKey(direction.activeStoryArc)
      : null;
    const completedCurrentCallback = Boolean(this.callback?.arcKey === completedArcKey && (
      direction.transition === 'payoff_due' || direction.transition === 'closure_due'
    ));
    if (completedCurrentCallback && this.callback) {
      this.callback = { ...this.callback, status: 'response_completed' };
    }
    return completedCurrentCallback;
  }

  reset(seed?: { sequence: number; candidates: readonly CommentaryStoryArc[] }) {
    this.active = null;
    this.callback = null;
    this.lastMentionAt.clear();
    if (seed) this.direct({ sequence: seed.sequence, candidates: seed.candidates });
  }

  private activate(arc: CommentaryStoryArc, sequence: number) {
    const key = storyArcKey(arc);
    this.active = { arc, key, startedAtSequence: sequence, unsupportedEvents: 0 };
    const trigger = callbackTriggerForArcKind(arc.kind);
    this.callback = {
      arcKey: key,
      trigger,
      status: arc.phase === 'payoff' ? 'payoff_due' : 'watching',
    };
  }

  private lifecycle(
    type: BroadcastArcLifecycleEvent['type'],
    closeReason?: BroadcastArcLifecycleEvent['closeReason']
  ): BroadcastArcLifecycleEvent {
    if (!this.active || !this.callback) throw new Error('Cannot emit a story lifecycle without an active story');
    return {
      type,
      arcKey: this.active.key,
      arc: this.active.arc,
      callbackTrigger: this.callback.trigger,
      ...(closeReason ? { closeReason } : {}),
    };
  }
}

/**
 * Replays the same director over canonical match events for the report. This
 * is intentionally report-only: prefix ranking is quadratic and never runs
 * on the live dart path.
 */
export function buildBroadcastStoryTimeline(input: {
  events: readonly DartIQDartEvent[];
  finishRule: FinishRule;
  rematch?: Parameters<typeof rankCommentaryStoryArcs>[0]['rematch'];
}): BroadcastStoryBeat[] {
  const director = new BroadcastDirector();
  const prefix: DartIQDartEvent[] = [];
  const beats: BroadcastStoryBeat[] = [];
  for (const event of input.events) {
    prefix.push(event);
    const winnerId = event.legResolution?.matchWon
      ? event.legResolution.winnerPlayerId
      : null;
    const direction = director.direct({
      sequence: event.sequence,
      candidates: rankCommentaryStoryArcs({
        events: prefix,
        finishRule: input.finishRule,
        rematch: input.rematch,
      }),
      matchWinnerId: winnerId,
      observedTriggers: observedBroadcastTriggers(event),
      triggerPlayerId: event.legResolution?.winnerPlayerId ?? event.playerId,
    });
    if (
      direction.activeStoryArc
      && (
        direction.transition === 'started'
        || direction.transition === 'switched'
        || direction.transition === 'payoff_due'
        || direction.transition === 'closure_due'
      )
    ) {
      beats.push({
        sequence: event.sequence,
        dartId: event.dartId,
        legNumber: event.legNumber,
        arcKey: storyArcKey(direction.activeStoryArc),
        arc: direction.activeStoryArc,
        transition: direction.transition,
        callbackTrigger: direction.callback?.trigger ?? null,
      });
    }
    if (direction.shouldPromote) director.markResponseCompleted(direction);
  }
  return beats;
}

export function observedBroadcastTriggers(event: Pick<
  DartIQDartEvent,
  'checkedOut' | 'legResolution' | 'semanticStakes' | 'before' | 'after'
>): BroadcastCallbackTrigger[] {
  const triggers = new Set<BroadcastCallbackTrigger>();
  const favorite = (state: DartIQDartEvent['before']) => state.projections.reduce(
    (best, player) => player.matchWinProbability > best.probability
      ? { id: player.id, probability: player.matchWinProbability }
      : best,
    { id: '', probability: -1 }
  ).id;
  if (favorite(event.before) !== favorite(event.after)) triggers.add('probability_reversal');
  if (event.checkedOut || event.semanticStakes.oneDartFinishAvailable) {
    triggers.add('next_checkout_chance');
  }
  if (event.checkedOut) triggers.add('next_pressure_conversion');
  if (event.legResolution) triggers.add('leg_resolution');
  if (event.legResolution?.matchWon) triggers.add('match_resolution');
  return [...triggers];
}

export function broadcastDirectionInstruction(direction: BroadcastDirection | null | undefined) {
  if (!direction?.activeStoryArc) return '';
  if (direction.transition === 'payoff_due' || direction.transition === 'closure_due') {
    return 'Pay off the supplied earlier thread with this new result.';
  }
  if (!direction.shouldPromote) {
    return '';
  }
  return 'Use the newly supplied match pattern once, in fresh natural language.';
}
