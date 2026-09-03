import type { CommentaryStoryArc, CommentaryStoryArcKind } from './storyArcDirector.ts';

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
  status: 'watching' | 'payoff_due' | 'closure_due' | 'fulfilled';
  instruction: string;
};

export type BroadcastDirection = {
  schemaVersion: 1;
  sequence: number;
  activeStoryArc: CommentaryStoryArc | null;
  backgroundStoryArcs: CommentaryStoryArc[];
  transition: BroadcastArcTransition;
  callback: BroadcastCallbackObligation | null;
  shouldPromote: boolean;
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

function callbackTrigger(kind: CommentaryStoryArcKind): BroadcastCallbackTrigger {
  if (kind === 'miss_punished' || kind === 'checkout_duel') return 'next_checkout_chance';
  if (kind === 'pressure_resilience') return 'next_pressure_conversion';
  if (kind === 'rematch_revenge' || kind === 'underdog_rising') return 'match_resolution';
  if (kind === 'comeback' || kind === 'collapse' || kind === 'seesaw_match') {
    return 'probability_reversal';
  }
  return 'leg_resolution';
}

function callbackInstruction(arc: CommentaryStoryArc, trigger: BroadcastCallbackTrigger) {
  const subject = arc.subjectPlayerId ?? 'the match';
  if (trigger === 'match_resolution') {
    return `Hold ${arc.kind} as an open story for ${subject}; pay it off or explicitly close it when the match resolves.`;
  }
  if (trigger === 'probability_reversal') {
    return `Watch whether ${subject}'s ${arc.kind} continues or reverses; call the resolution, not every fluctuation.`;
  }
  if (trigger === 'next_checkout_chance') {
    return `Save the callback for the next supplied checkout consequence involving ${subject}.`;
  }
  if (trigger === 'next_pressure_conversion') {
    return `Return to this only when ${subject} gets another supplied high-pressure outcome.`;
  }
  return `Resolve this story at the next supplied leg result involving ${subject}.`;
}

function withMonotonicPhase(previous: CommentaryStoryArc, next: CommentaryStoryArc) {
  if (PHASE_RANK[next.phase] >= PHASE_RANK[previous.phase]) return next;
  return { ...next, phase: previous.phase };
}

/**
 * Stateful listener-local producer. Pressure proposes stories; this class
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
  }): BroadcastDirection {
    const candidates = input.candidates.slice(0, 3);
    const proposal = candidates[0] ?? null;
    let transition: BroadcastArcTransition = 'none';

    if (!this.active && proposal) {
      this.activate(proposal, input.sequence);
      transition = 'started';
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
          this.activate(proposal, input.sequence);
          transition = 'switched';
        }
      } else if (!proposal && this.active.unsupportedEvents >= UNSUPPORTED_GRACE_DARTS) {
        this.active = null;
        this.callback = null;
      }

      if (this.active && transition === 'none') transition = 'continued';
    }

    const winnerId = input.matchWinnerId ?? null;
    if (
      this.active
      && this.callback?.status !== 'fulfilled'
      && (this.active.arc.phase === 'payoff' || winnerId)
    ) {
      const storySucceeded = !winnerId || winnerId === this.active.arc.subjectPlayerId;
      transition = storySucceeded ? 'payoff_due' : 'closure_due';
      if (this.callback) {
        this.callback = {
          ...this.callback,
          status: storySucceeded ? 'payoff_due' : 'closure_due',
          instruction: storySucceeded
            ? `Pay off the established ${this.active.arc.kind} story now using the supplied result.`
            : `Close the established ${this.active.arc.kind} story now: it did not resolve for its subject.`,
        };
      }
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
    };
  }

  markMentioned(direction: BroadcastDirection) {
    const arc = direction.activeStoryArc;
    if (!arc) return;
    this.lastMentionAt.set(storyArcKey(arc), direction.sequence);
    if (
      this.callback
      && (direction.transition === 'payoff_due' || direction.transition === 'closure_due')
    ) {
      this.callback = { ...this.callback, status: 'fulfilled' };
    }
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
    const trigger = callbackTrigger(arc.kind);
    this.callback = {
      arcKey: key,
      trigger,
      status: arc.phase === 'payoff' ? 'payoff_due' : 'watching',
      instruction: arc.phase === 'payoff'
        ? `Pay off the supplied ${arc.kind} story now.`
        : callbackInstruction(arc, trigger),
    };
  }
}

export function broadcastDirectionInstruction(direction: BroadcastDirection | null | undefined) {
  if (!direction?.activeStoryArc) return '';
  if (direction.transition === 'payoff_due' || direction.transition === 'closure_due') {
    return 'Story: resolve the named active story in the latest match brief now.';
  }
  if (!direction.shouldPromote) {
    return 'Story: keep the named active story in memory for this call.';
  }
  return 'Story: connect this moment to the named active story in the latest match brief.';
}
