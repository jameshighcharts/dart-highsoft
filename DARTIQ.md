## DartIQ

Traditional averages are too blunt. Even the PDC’s own analysis discusses “real averages” and metrics intended to correct the biases of ordinary match averages. PDC stats analysis

Build native advanced metrics:

- Win probability after every dart
- Dart consequence: how much did the probability vector move?
- Pre-dart opportunity: how much could the next dart move it on average?
- Performance relative to personal baseline
- Stolen and thrown-away legs
- Expected checkout percentage
- Descriptive leave impact
- Bogey avoidance
- Last-dart-at-double accuracy
- Opponent pressure created
- “Expected darts remaining”
- Performance above expectation

This becomes the analytical language of your league—not just another stats page.

• Yeah—this is probably the best intersection of hot, useful, and realistically buildable with the data you already collect.

The crucial concept is Win Probability Added, calculated after every dart:

Before dart: player has 34% chance to win
After hitting T20: player has 51%
Dart WPA: +17 percentage points

From that one timeline, most of the DartIQ falls out naturally.

### A strong V1

Ship a post-match “DartIQ Report” containing:

- Win-probability timeline by dart
- Biggest positive and negative swings
- Match turning point
- Highest-pressure checkout
- Stolen leg: won after falling below 20%
- Thrown-away leg: lost after exceeding 80%
- DartIQ performance relative to the player's baseline
- Leave impact: how the resulting score changed the next-visit checkout opportunity
- Bogey mistakes
- Performance versus expectation

The match summary could say:

> Ken stole Leg 3 after falling to 11% win probability. His D16 checkout produced a +43% swing—the most important dart of the match.

That is dramatically more interesting than “82.4 average.”

### How the model works

For every dart, reconstruct this state:

Player scores
Current player
Darts remaining
Finish rule
Leg score
Match score
Opponent checkout threat
Player strength

Then estimate the chance of each player winning from that state.

Use a hierarchical empirical transition model based on the player's score outcome, whether the dart
hit a double, current score, darts remaining, finish rule, and state bucket. Back off through
coarser state classes and the frozen installation population when player evidence is sparse.

When player-specific data is sparse, blend it with league-wide data. As players accumulate darts, their personal model gradually takes over.

Here, “league-wide” currently means the eligible historical player population in this app installation—not a formal league entity. The implemented hierarchy is:

1. The player's completed historical X01 matches for the same finish rule.
2. The installation-wide population for that finish rule.
3. A conservative cold-start fallback when population data is also sparse.

Eligible profiles use completed, non-test, non-ended matches and exclude fair-ending tiebreak turns. Multiplayer history is included because scoring, checkout, and bust samples belong to individual players regardless of field size. Personal estimates are shrunk toward the population, and population estimates are shrunk toward the fallback, preventing tiny samples from producing extreme ratings. Current-match form is then blended on top of that historical prior.

The live client fetches only compact aggregate profiles once per player set and finish rule. It never downloads or rescans a player's raw historical darts after each live throw. If formal clubs, seasons, or leagues are added later, an intermediate league/club baseline can slot between player and installation population without changing the DartIQ API.

This requires no new hardware. Existing match history is enough for V1.

### The metric language

I’d define the metrics carefully:

- Win probability: probability of winning the leg or match from the current state.
- Consequence: total variation in the full probability vector caused by the dart.
- Opportunity: expected absolute probability movement before the dart is thrown.
- WPA: actual probability gained or lost by the dart.
- Outcome rarity: probability or tail position of the realized outcome under the transition model.
- Semantic stakes: checkout, match dart, repeated miss, bust, or story resolution.
- Setup value: change in checkout/leg probability without claiming an inferred optimal target.
- Opponent pressure created: increase in the opponent’s required performance after your visit.
- Expected darts remaining: estimated darts needed to finish from the current score.
- Performance above expectation: actual result minus the player model’s expected result.

### One important distinction

Opportunity, consequence, and performance must remain separate.

A match dart at D16 carries semantic pressure whether it hits or misses. The result determines
consequence and outcome rarity; neither retroactively determines whether the opportunity mattered.

### What requires extra inference

Last-dart-at-double accuracy needs intended target information. The app may later infer attempts from:

- Remaining score
- Checkout route
- Dart position
- Previous darts
- Finish rule

Scolia geometry strengthens the likelihood but does not reveal intent by itself. Ambiguous cases
must retain an aim posterior and confidence rather than pretending certainty.

### The killer presentation

The historical stats screen gets a “Match Pulse” chart:

100% ┤ ╭── Ken wins
75% ┤ ╭──╮ ╭╯
50% ┤────╮ ╭─────╯ ╰───╯
25% ┤ ╰───╯
0% ┤
Leg 1 Leg 2 Leg 3

Clicking a swing reveals:

- Board state before the dart
- Dart thrown
- Probability before and after
- Alternative target
- Commentary explaining its importance
- Scolia impact position
- Optional replay clip later

### Current foundation

The first foundations are in place:

1. A deterministic multiplayer live probability model and compact spectator strip, including the circular player rail for large fields.
2. Deterministic per-dart replay over a behavioral visit/race model, with normalized multiplayer probabilities, WPA, full-field consequence, checkout/setup analysis, bogey classification, turning points, and stolen/thrown-away legs.
3. Versioned DartIQ packets with stable IDs, classified signals, and commentary priorities.
4. Fair-ending phases: provisional checkout waiting, deterministic bounded tiebreak projections, fair-ending signals, and direct worker-triggered Scolia commentary.
5. A server-rendered `/match/[id]/report` surface with a multiplayer Match Pulse, leg boundaries,
   summary facts, and a clickable ranked-dart list linked from completed X01 games.

Historical inputs are frozen atomically when a match is created. A player's eligible completed X01 history and the installation-wide finish-rule population become immutable match evidence, so later games cannot leak backward into a replay or calibration run. The browser fetches that compact evidence rather than raw historical matches.

### Forward plan

Everything described here is unreleased and lands as one coherent PR. There is no product-generation
migration: the heuristic probability engine is replaced in place, its branch-only migrations
are consolidated, and the user-facing surfaces cut over together. Intrinsic schema and envelope
versions remain where independently deployed processes or frozen evidence require them.

The canonical modelling, persistence, delivery order, and acceptance gates are defined in
[DartIQ — decided design and one-PR delivery](#dartiq--decided-design-and-one-pr-delivery).
The realtime architecture below remains the transport and product contract for commentary.

### Future realtime commentary architecture

The current request-per-turn commentary endpoint and separate text-to-speech call are transitional. The target is one persistent GPT-Realtime session in the spectator browser for the duration of a match:

- The server uses the standard OpenAI API key with the unified WebRTC interface: it forwards the browser SDP offer, supplies trusted session configuration, returns the SDP answer, and retains the returned OpenAI call ID for worker sideband control. The standard key and call ID must never be shipped to the browser.
- The browser establishes the persistent WebRTC connection and receives audio directly from the model.
- Every accepted dart produces a compact event containing the dart result, updated game state, and deterministic DartIQ metrics such as match/leg win probability, per-player WPA, total-variation consequence, opportunity, and classified moments.
- The model narrates those facts; it does not calculate or invent the authoritative metrics.
- Feed every dart into the session, but only request speech when the commentary policy calls for it. Ordinary darts preserve context silently while checkouts, lead changes, large swings, pressure misses, and other significant moments can trigger a response.
- Start a session with a compact match/player snapshot, then send event deltas rather than repeatedly sending the entire throw history. Add periodic summaries or checkpoints to keep long multiplayer matches within a predictable context and cost envelope.
- On reconnect, create or restore the session from the current match snapshot plus recent significant moments instead of replaying the full match dart by dart.
- Keep transport-specific Realtime code separate from probability calculation so the same event stream can later drive text commentary, audio commentary, highlights, notifications, and post-match stories.

A useful event contract is `DartIQDartEvent`: stable IDs for deduplication, match/leg/turn/dart position, player and score state, model/config identity, full probability vectors before/after, per-player WPA, consequence, opportunity, semantic stakes, and classified commentary moments. Edits and undos emit explicit correction events so the commentator's persistent view cannot drift from authoritative match state.

#### Latency path

The current audible path is necessarily sequential:

`completed turn → /api/commentary → complete text → /api/tts → complete MP3 blob → playback`

The intended replacement removes that text-to-MP3 waterfall:

`dart detected → worker accepts/persists → DartIQ event over session sideband → streamed WebRTC audio`

When commentary is enabled, establish and warm the output-only WebRTC session before the next dart. Send structured dart events over its data channel; no microphone input is required. Attach the remote audio track directly to browser playback and update written commentary from transcript deltas as they arrive.

Use a very small stable instruction set and cap ordinary calls to roughly 6–15 spoken words. Start with low reasoning effort, then tune against measured latency and commentary quality. Model policy:

- Use `gpt-realtime-2.1` for all live commentary by default because the demo showed materially better persona and instruction-following headroom.
- Keep Mini available only as an explicit latency/cost experiment; do not route ordinary calls to it automatically.

Model routing is an optimization, not part of the event contract. Keep it configurable so model availability, pricing, and measured performance can change without touching match logic.

#### Instant local reaction layer

The zero-latency-feeling layer should not depend on a model. Play small bundled sounds immediately for unambiguous marquee events, then let streamed personalized commentary follow:

- 180: crowd sting or a local “one hundred and eighty” call.
- Bust: a short failure sting.
- Checkout or match win: an immediate celebration hit.

Avoid overlapping two voices. Local assets should either be non-speech stings or explicitly coordinate with the Realtime response so a canned call and generated commentary do not talk over each other.

#### Latest-wins interruption policy

Never preserve a FIFO queue of stale spoken commentary. Assign each event a priority and cancel or truncate an in-progress lower-priority response when a more important event arrives:

- An ordinary throw does not interrupt important commentary.
- A 180, checkout, bust, large pressure swing, or lead change interrupts ordinary chatter.
- A match win interrupts everything.
- Superseded commentary is discarded rather than queued behind newer play.

Feed dart one and dart two silently into the persistent session, and normally issue `response.create` only when commentary policy chooses to speak. This gives the model the entire visit as it unfolds without putting prompt construction or session establishment on the third-dart critical path.

#### Performance targets and instrumentation

Treat these as engineering targets to benchmark, not platform promises:

| Reaction | Initial target |
|---|---:|
| Local sting/call | under 50 ms |
| First streamed model audio | p50 under 500 ms |
| First streamed model audio | p95 under 1 second |
| Stale commentary after the next dart | zero |

Commentary latency instrumentation is deliberately deferred. This PR treats the existing delivery speed as sufficient and instruments model correctness, replayability, and calibration only.

#### Delivery sequence

> **Superseded as delivery sequencing.** These stages record how the realtime transport was
> originally reasoned about. Delivery is defined by
> [One-PR execution order](#one-pr-execution-order) and [Merge gates](#merge-gates); the per-stage
> gates below do not apply.

1. Freeze and version the existing `DartIQDartPacket`, then add provider-neutral commentary envelopes and policy contracts independently of any transport.
2. Prewarm a persistent output-only WebRTC session when commentary is enabled.
3. Send compact deterministic dart events and consume native streamed audio plus transcript deltas.
4. Add local stingers for marquee events.
5. Implement priority cancellation/truncation and strict stale-response suppression.
6. Retain the existing commentary and TTS endpoints temporarily as a fallback behind the same commentary interface.
7. Deferred: tune commentary delivery only if real usage demonstrates a speed problem.

#### Product contract

The commentator is a live presentation layer over authoritative match and DartIQ state. Its job is to notice, prioritize, phrase, and speak. It must not become another game engine.

Goals:

- Begin an immediate reaction while the moment still feels live.
- Preserve the narrative across darts, visits, legs, and a full match.
- Ground every analytical statement in deterministic facts supplied by the app.
- Remain useful with manual scoring, Scolia scoring, scoring corrections, reconnects, and arbitrary multiplayer fields.
- Show the same transcript that was spoken, including partial transcript updates while audio is arriving.
- Degrade cleanly to text-only, the existing request/TTS pipeline, deterministic local lines, or silence.
- Keep the transport provider replaceable and the model configurable.

Non-goals for the first Realtime release:

- Microphone input, conversational user interruption, or voice commands.
- Letting the model query Supabase, mutate a match, call scoring APIs, or choose authoritative statistics.
- Speaking after every dart. Every dart supplies context; significance controls speech.
- Synchronizing one identical generated call across every spectator device. V1 commentary is a per-browser opt-in experience.
- Replacing the post-match DartIQ Report or deterministic highlight classifier.

#### Authority boundaries

Keep these responsibilities explicit:

| Layer | Owns | Must not own |
|---|---|---|
| Match engine | Accepted throws, turns, scores, busts, checkouts, legs, winner | Commentary timing or prose |
| DartIQ | Probability vectors, per-player WPA, consequence, opportunity, checkout/setup facts, classified signals | Persona, voice, jokes, or audio |
| Commentary policy | Whether to speak, priority, interruption, cooldown, local sting selection | Recalculating match or pressure facts |
| Realtime transport | Session/auth lifecycle, event delivery, audio, transcript, cancellation | Event significance or analytics |
| Realtime model | Narrative continuity, concise wording, vocal performance | Correcting supplied facts or inventing missing metrics |
| UI | User controls, connection state, transcript, mute/skip | Hidden match-state reconstruction |

The provider-neutral boundary is the existing `DartIQDartPacket` in `src/lib/dartiq/events.ts`. Realtime-specific code consumes that packet but does not import or invoke the probability model directly.

#### End-to-end live flow

For every accepted dart:

1. The normal match flow persists or accepts the throw. For Scolia, this completes inside `ingestScoliaThrowEvent()` in the persistent worker; it does not wait for Supabase Realtime.
2. The worker reloads canonical post-ingestion rows, reconstructs the matching `DartIQDartPacket`, and creates an idempotent delivery for every active listener session. Manual scoring currently derives the same context in the browser.
3. The commentary policy enriches the packet with display names and lightweight narrative state, then decides `silent`, `ordinary`, `notable`, `marquee`, or `terminal` handling.
4. For Scolia, the worker sends the event as an `input_text` conversation item over an authenticated OpenAI sideband WebSocket attached to the browser's WebRTC call. Manual scoring uses the browser data channel. Silent events still enter context.
5. If the policy chooses speech, it first applies the latest-wins interruption rules and then emits `response.create` with moment-specific brevity and delivery instructions.
6. WebRTC delivers generated audio as a remote media stream. Transcript delta events update `CommentaryDisplay` while the call is being spoken.
7. `response.done`, cancellation, timeout, or transport failure closes the local response lifecycle.

Do not wait for Supabase Realtime when the scoring browser already has the accepted API result and authoritative packet. Spectator browsers use the existing ordered Supabase path, deduplicate by event ID, and produce the same packet after applying the realtime event. This preserves the fastest path for the scorer without weakening spectator correctness.

#### Implemented foundation (September 2026)

- `POST /api/commentary/realtime/session` forwards browser SDP through OpenAI's unified WebRTC interface using the configurable Realtime model (`gpt-realtime-2.1` by default), registers the server-only call ID, and returns the SDP answer. `PUT` advances an idempotent correction epoch and returns a replacement snapshot, `PATCH` heartbeats the listener, and `DELETE` closes its registry entry.
- `RealtimeCommentaryService` owns an output-only `RTCPeerConnection`, remote audio track, streamed transcripts, cancellation, and a user-gesture-resumed `AudioContext`. No microphone or complete audio blob is involved.
- The consolidated `0056_realtime_commentary_sessions.sql` adds server-only active-session,
  correction-epoch, and idempotent per-throw delivery tables.
- `ScoliaRealtimeCommentaryPublisher` attaches an authenticated worker WebSocket to each active browser call, feeds every accepted dart, retries pending sends, and applies latest-wins interruption before `response.create`.
- `CommentaryPolicy` is shared by browser and worker for category cooldowns, repeat memory, visit timing, rapid-sequence silence, ordinary sampling, guaranteed calls, and latest-wins interruption.
- `CommentaryVisitTiming` runs after policy selection in both paths. It holds ordinary completed-visit calls for an 850 ms natural gap, suppresses them if another dart arrives, clears routine audio that runs into the next visit, tightens notable calls when play is moving, and never delays marquee or terminal speech.
- The exact order-independent 1 + 5 + 20 “Nikita special” is an explicit guaranteed marquee signal. The old global two-second commentary debouncer has been removed; policy now owns pacing without delaying accepted completed visits.
- `commentaryNarrative` now turns the full deterministic DartIQ replay into bounded story memory: recurring tendencies, recent exact-double non-conversions, checkout results under high pressure, the largest match-WPA swing, rematch/revenge stakes, and current average versus the shrunk historical baseline. Snapshots carry the same memory across reconnects and corrections. The model is instructed to use at most one relevant thread per call and deliver it playfully with light sass.
- `storyArcDirector` ranks comeback, collapse, underdog, seesaw, punished-miss, checkout-duel, pressure-resilience, revenge, and dominance candidates. Listener-local `BroadcastDirector` commits to one primary angle, retains two reserves, requires a material challenger plus a minimum commitment window before switching, prevents phase regression, budgets story introductions, creates future callback obligations, and forces factual payoff or closure at resolution. Only a started, switched, or resolving arc promotes routine context to notable speech.
- `loadScoliaRealtimeDartEvent()` reconstructs the accepted dart's personalized DartIQ packet directly from canonical rows and profile aggregates, including fair-ending checkout-waiting and tiebreak darts.
- Manual matches use the browser Realtime data channel at completed-turn granularity. Scolia matches use the worker sideband for both ordinary and fair-ending play. The old text plus buffered-TTS waterfall remains available whenever the persistent session is unavailable.
- `npm run commentary:demo` provides a local-only end-to-end broadcast harness. It provisions test players plus a synthetic Scolia board/match, refuses non-loopback Supabase hosts, persists realistic `THROW_DETECTED` payloads, runs canonical ingestion, and calls the production worker-side publisher only after a browser Realtime listener is active. Its valid 301 script exercises the Nikita special, opposing/comeback 180s, a missed double leave, and a bull-checkout story payoff.

Implemented next: new/reconnected sessions receive a compact canonical match snapshot; Scolia snapshots are injected by the worker before sideband deltas and manual snapshots use the browser channel. The browser reconnects with bounded backoff and proactively rotates healthy calls at 50 minutes. The worker cold-loads DartIQ history/profiles once, then appends ordered darts to an in-memory canonical cache and reuses the verified projection prefix; restart, leg transition, correction epoch, or ordering drift falls back to a clean canonical reconstruction. Throw edits/deletes cancel speech immediately, idempotently advance a server-owned listener epoch, clear the browser policy/transcript, and send a versioned authoritative correction envelope with the replacement snapshot. The worker observes epoch changes before the next accepted dart and resynchronizes its sideband plus DartIQ cache.

Still optional: local marquee stings. Per-stage commentary latency telemetry is outside this PR.

#### DartIQ handoff — fair-ending direct commentary implemented

The branch foundation supplies fair-ending and tiebreak packets to the Realtime commentator. The remaining work in this section is incremental-state performance and deeper calibration, not removal of the speech bypass.

**Outcome**

Make fair-ending X01 and its high-round tiebreaks first-class states in the authoritative DartIQ. Every accepted dart must produce a valid, normalized `DartIQDartPacket`, including darts thrown after the first checkout while the round is being completed and darts thrown in a tiebreak. The live/incremental path and a clean historical replay must produce equivalent analytical values for the same state.

Do not build OpenAI, WebRTC, speech policy, or prompt logic in the DartIQ. The commentator consumes provider-neutral packets and treats the engine's probabilities and signals as facts.

**Previous blocker**

The earlier `src/lib/commentary/scoliaRealtimeEvent.ts` path skipped `loadDartIQPacket()` when `matches.fair_ending` was true and forced worker speech to `silent`, because the original engine assumed reaching zero immediately locked the leg winner. The current branch removes that assumption and the bypass: reaching zero can remain provisional, multiple checkout players can enter a high-round tiebreak, and a non-checkout tiebreak dart can authoritatively resolve the leg or match.

**Previous fair-ending fallback path**

Before that fair-ending work, commentary still used the persistent Realtime session when it was healthy. It did **not** fall back to the old generated-text plus buffered-MP3 path merely because fair ending was enabled. What changed was where and when speech was triggered:

Normal Scolia X01 takes the fast worker path:

`Scolia worker accepts dart → builds DartIQ packet → sends it over the OpenAI sideband → browser receives streamed WebRTC audio`

Fair-ending Scolia currently takes a conservative split path:

`Scolia worker accepts dart → sends the dart silently for model context → Supabase Realtime reaches the browser → browser recognizes the completed turn → browser requests speech through its existing WebRTC data channel`

The browser therefore waited for the completed-turn Supabase event and spoke at visit granularity instead of letting the worker trigger significant darts immediately. This added a small latency penalty and prevented per-dart pressure commentary, but preserved correct facts while the original engine lacked checkout-waiting and tiebreak states. Only an unhealthy or unavailable WebRTC session continued onward to the legacy commentary/TTS fallback.

That exception is now removed. The worker uses the same direct per-dart sideband path for fair-ending matches, while the browser-side completed-turn route remains useful for manual scoring and transport recovery.

**Source of truth and shared transition**

Use `computeFairEndingState()` in `src/utils/fairEnding.ts` as the existing rules reference, but move or wrap the necessary state transition so live projection and `reconstructDartIQTimeline()` use one shared implementation. The DartIQ state must carry enough information to advance one dart without rereading or replaying the leg:

- phase: `normal`, `completing_round`, `tiebreak`, or `resolved`;
- normal X01 scores and completed-turn counts for every player;
- IDs of players who checked out during the fair-ending round;
- current tiebreak round and eligible player IDs;
- current tiebreak score and darts thrown for every eligible player;
- play order/current player, legs won, finish rule, and player skill model;
- a monotonic source sequence plus engine/schema version.

The transition accepts exactly one canonical dart plus the minimum turn metadata required to know whether a visit completed or busted. It returns the next immutable state and the event facts used by `createDartIQDartPacket()`. Corrections are handled above this primitive by restoring the nearest safe checkpoint and replaying canonical darts from there.

**Required probability semantics**

- In `normal`, keep the existing X01 model until a player reaches zero.
- Reaching zero in a fair-ending match means `checkedOut: true`; it does **not** mean the leg or match probability becomes `1` unless the fair-ending state is actually `resolved`.
- In `completing_round`, a checked-out player's result is contingent on whether any remaining player also checks out. Model each remaining player's checkout chance from their score, darts left, finish rule, and skill profile. If nobody joins, the existing checked-out player wins; if others join, allocate the probability mass through the tiebreak model.
- Players who have not checked out retain only the probability mass represented by checking out in their remaining darts and then surviving the possible tiebreak. A player who can no longer complete the fair-ending round has zero leg-win probability.
- In `tiebreak`, non-eligible players have zero leg-win probability. For eligible players, completed visits are fixed scores and unplayed/partial visits are score distributions conditioned on their remaining darts and player model. The highest three-dart total wins; tied leaders advance to another round, whose recursively repeated probability must be represented rather than arbitrarily split or discarded.
- In `resolved`, the winner has leg probability `1` and all others `0`. Match probability follows the existing legs-to-win model, becoming `1/0` only when the match is resolved.
- Every projection must be finite, bounded to `[0, 1]`, and sum to `1` within numerical tolerance in every phase. Use deterministic tie-breaking only for numerical stability, never to decide a game outcome.

An exact analytical tiebreak calculation is not required for the first slice. A deterministic bounded approximation is acceptable if its seed/input is stable, it exposes `approximationMode` and confidence, and it stays inside the live latency budget. Never use ambient randomness that makes replay disagree with live output.

**Packet and signal requirements**

Keep `DartIQDartPacket` provider-neutral. Extend it only where the state cannot otherwise be interpreted correctly. The preferred additive field is:

```ts
type DartIQFairEndingContext = {
  enabled: boolean;
  phase: 'normal' | 'completing_round' | 'tiebreak' | 'resolved';
  checkedOutPlayerIds: string[];
  tiebreakRound: number;
  tiebreakPlayerIds: string[];
  tiebreakScores: Record<string, number>;
  winnerId: string | null;
};
```

Add this as an optional `fairEnding` field and bump the packet schema version if consumers cannot safely treat its absence as ordinary X01. Add provider-neutral signals for events the deterministic engine can prove, rather than asking the language model to infer them:

- `fair_ending_checkout`: a player reaches zero but the round remains open;
- `fair_ending_round_complete`: the equal-turn round closes;
- `tiebreak_started`: multiple checkout players advance;
- `tiebreak_lead_change`: the provisional high-round leader changes;
- `tiebreak_tied`: another tiebreak round is required;
- `leg_win` and `match_win`: only when resolution is authoritative.

`checkedOut` remains a dart fact; it must not be overloaded to mean `leg_win`. WPA is always `after - before` from the acting player's perspective, including checkout-waiting and tiebreak darts. Leverage remains prospective: calculate it from the pre-dart state, not from whether the dart happened to succeed.

The engine may classify analytical signals and a base significance. Final `shouldSpeak`, cooldowns, persona, interruption, and wording belong to the commentary policy. This lets the same packet drive the UI, reports, telemetry, and other consumers without speech concerns leaking into the model.

**Implementation touchpoints**

1. `src/lib/dartiq/projection.ts`: represent/project all fair-ending phases and expose model diagnostics.
2. `src/lib/dartiq/replay.ts`: use the shared one-dart transition and emit events throughout completing-round and tiebreak play.
3. `src/lib/dartiq/events.ts`: emit the fair-ending context and new deterministic signals without OpenAI fields.
4. `src/utils/fairEnding.ts`: retain one canonical rules implementation; avoid a second subtly different phase machine.
5. `src/lib/commentary/scoliaRealtimeEvent.ts`: the `match.fair_ending` DartIQ bypass and `allowSpeech: !match.fair_ending` kill switch have been removed; every accepted Scolia dart now uses the DartIQ packet path.

The incremental tracker requested in Phase 1 should be the normal live entry point. The current worker-side whole-leg reconstruction can consume the same transition temporarily, but it is not the desired steady state.

**Acceptance fixtures**

Add deterministic unit fixtures for at least these cases, each asserting live/replay parity after every dart and probability normalization:

1. First checkout occurs before all players have completed the round; the finisher has less than `1.0` probability while waiting.
2. Every remaining player fails to check out; the original finisher resolves the leg on round completion.
3. A second player checks out on dart one, two, and three in separate fixtures; both advance to tiebreak only after the round closes.
4. A player busts while attempting to join the checkout group; scores/turn completion and probabilities remain correct.
5. A two-player tiebreak resolves after one high round.
6. A multiplayer tiebreak eliminates lower scorers while tied leaders advance to round two.
7. A partial tiebreak visit changes provisional probabilities after each dart without prematurely resolving the leg.
8. A tied completed tiebreak round creates the next round and preserves normalized probabilities.
9. The fair-ending leg win also wins the match; only the resolution event emits `match_win` and terminal probabilities.
10. Undo/edit of the first checkout, a joining checkout, and a tiebreak dart rebuilds to the same packets as a clean corrected replay.
11. Sparse-history/fallback profiles and large multiplayer fields produce finite deterministic output within the existing performance budget.
12. Event IDs and sequences remain stable and deduplicable across worker retry and clean replay.

**Commentary handoff status**

Completed:

- The DartIQ emits fair-ending context and deterministic packets during checkout waiting and every tiebreak dart.
- A checkout remains provisional until the equal-turn round resolves; tiebreak resolution can emit `leg_win`/`match_win` without pretending the final dart was a checkout.
- Projection normalization is covered for checkout waiting, partial tiebreak visits, tied next rounds, large fields, busts, and match resolution.
- The worker-side fair-ending bypass is removed without moving rules or probability calculation into the commentary layer.
- The commentator receives the same envelope shape for ordinary X01 and fair ending, and healthy Scolia sessions no longer wait for the browser's completed-turn speech trigger.

Still required for the broader Phase 1 definition of done:

- Replace worker-side whole-leg reconstruction with the shared incremental one-dart tracker and safe checkpoints.
- Add correction/undo envelopes and prove corrected incremental state equals a clean replay.
- Extend fixture coverage across every checkout dart position and more multiplayer elimination permutations.
- Measure the fair-ending worker path against the existing live latency budget under realistic match history sizes.

`loadScoliaRealtimeDartEvent()` now enables the packet for fair ending, the DartIQ maps the new signals into speech priority, and a ready Scolia browser suppresses the slower completed-turn duplicate. No Realtime transport redesign was required. The worker still reconstructs the current leg for each accepted dart; replacing that query/replay with checkpointed incremental state remains a performance optimization.

#### Provider-neutral commentary envelopes

`DartIQDartPacket` remains the compact analytical payload. Add a thin commentary envelope rather than adding OpenAI fields to it:

```ts
type CommentaryFeedEvent =
  | {
      schemaVersion: 1;
      kind: 'match_snapshot';
      epoch: number;
      matchId: string;
      sequence: number;
      generatedAt: string;
      match: CommentaryMatchSnapshot;
      recentMoments: CommentaryMomentSummary[];
    }
  | {
      schemaVersion: 1;
      kind: 'dart';
      epoch: number;
      sequence: number;
      playerName: string;
      packet: DartIQDartPacket;
    }
  | {
      schemaVersion: 1;
      kind: 'correction';
      epoch: number;
      sequence: number;
      invalidatedEventIds: string[];
      replacementSnapshot: CommentaryMatchSnapshot;
    }
  | {
      schemaVersion: 1;
      kind: 'leg_summary' | 'match_summary';
      epoch: number;
      sequence: number;
      facts: CommentaryMomentSummary[];
    };
```

Required invariants:

- `eventId` identifies the underlying accepted dart and is stable across clients.
- `sequence` is monotonic within a match and lets the transport reject duplicate or stale input.
- `epoch` changes after a correction rebuild or authoritative session reset. Events from older epochs can never trigger speech.
- Player names travel in the commentary envelope; the DartIQ continues using stable player IDs.
- Percentages remain normalized decimals in the packet. Formatting into percentages or percentage points happens at the presentation/model boundary.
- Optional facts are omitted rather than fabricated. The prompt explicitly forbids filling in missing values.
- Each client event receives its own correlation ID so an OpenAI error event can be tied to the local match event that caused it.

Snapshots should contain only what the commentator needs: match format and finish rule, ordered players, scores, legs won, current player, current leg/turn/dart, compact personal form, current probabilities, persona, and a bounded list of significant moments. Do not send raw historical throws, Scolia geometry, private profile aggregates, passcodes, or Supabase records.

#### Session bootstrap and configuration

When the user enables audio commentary:

1. Unlock browser audio synchronously from that user gesture.
2. Enter `connecting` and request a short-lived Realtime client secret from a protected Next.js route.
3. Create an `RTCPeerConnection`, an `oai-events` data channel, a receive-only audio transceiver, and an autoplaying audio element using the user's volume setting.
4. Authenticate the browser-to-OpenAI SDP exchange with the short-lived credential. The normal `OPENAI_API_KEY` remains server-only.
5. Wait for the data channel and `session.created` before declaring the transport ready.
6. Send `session.update` with the configured model, voice, low reasoning effort, audio output, no microphone-driven turn detection, concise instructions, and bounded truncation settings.
7. Send the authoritative `match_snapshot` as the first conversation item. Do not ask the model to speak.
8. Enter `ready` and flush any still-current packets collected during connection setup.

The microphone must never be requested. Besides avoiding an irrelevant permission prompt, this prevents room audio from accidentally triggering a model response. The WebRTC spike must verify receive-only negotiation in Chrome, Safari/iOS, and Firefox before the old audio path is retired.

The selected voice is session-scoped. If the user changes voice after audio has begun, close and rebuild the session from a fresh checkpoint; do not pretend the active session changed voice. Apply the same controlled rebuild when persona instructions change materially.

Use `gpt-realtime-2.1` as the quality baseline and compare Mini as the latency/cost candidate on the same frozen event fixtures, including persona fidelity, meta-talk, and repetition. Keep model, voice, reasoning effort, response length, timeout, and truncation settings server-configurable. Do not hard-code routing decisions into `DartIQDartPacket`.

#### Client session state machine

Use an explicit state machine rather than scattered booleans:

```text
disabled
  -> connecting
  -> ready <-> speaking
  -> reconnecting -> ready
  -> fallback
  -> closed
```

State rules:

- `disabled`: no credential, peer connection, timers, or queued provider events.
- `connecting`: buffer only a small latest snapshot plus events newer than that snapshot.
- `ready`: data channel open, audio track attached, snapshot acknowledged, safe to request speech.
- `speaking`: exactly one current response generation and its priority are tracked.
- `reconnecting`: current response is stale; audio is stopped; rebuild from an authoritative checkpoint.
- `fallback`: Realtime is unavailable for this browser session; use the configured fallback without a reconnect loop.
- `closed`: terminal cleanup on match exit, match end timeout, user disable, or component unmount.

Track a monotonically increasing local `generation` for every peer connection. All async callbacks capture their generation and discard work when it no longer matches. This prevents a late event from a closed connection changing the transcript or starting playback.

#### Feeding context and asking for speech

The model receives structured JSON serialized as a short `input_text` item using `conversation.item.create`. The application, not VAD, decides when to speak.

Silent dart path:

```text
DartIQDartPacket -> conversation.item.create -> no response.create
```

Spoken dart path:

```text
DartIQDartPacket -> conversation.item.create -> interruption decision -> response.create
```

The session instruction should establish durable rules once:

- You are a live darts commentator using the selected persona.
- Treat supplied match and DartIQ facts as authoritative.
- Never calculate, revise, or contradict probabilities.
- Keep pre-dart opportunity, realized consequence, outcome rarity, and semantic stakes distinct; never infer pressure merely from success.
- Mention percentages only when the change is meaningful and speak them naturally.
- Prefer what changed and why it matters over repeating the raw score.
- Speak one short line and stop. Do not greet, ask questions, or describe the JSON.
- Do not speak on context-only events.
- Respect corrections and the current epoch; never revive invalidated moments.

Per-response instructions control the moment rather than repeating the full persona prompt. Examples:

- Ordinary: `One restrained line, at most 12 words. Do not force a pressure statistic.`
- Notable: `One line, at most 18 words. Explain the supplied turning point accurately.`
- Marquee: `React immediately, then give one concise consequence. At most 22 words.`
- Terminal: `Announce the winner first, then one decisive DartIQ fact. At most 35 words.`

The transcript shown in the UI comes from audio transcript delta/done events, not a second text-generation call. Hold partial text separately from committed commentary so cancellation cannot leave a half-sentence presented as final.

#### Speech trigger policy

The deterministic policy is testable and runs before the provider call:

| Priority | Default speech behavior | Examples |
|---|---|---|
| `silent` | Feed context only | Dart one/two with no significant signal |
| `ordinary` | Speak only if idle and cooldown allows | Completed routine visit |
| `notable` | Speak unless a marquee/terminal response is active | Favorite change, material consequence, meaningful setup/bogey event, ordinary bust |
| `marquee` | Speak immediately; interrupt ordinary/notable | 180, checkout, directly squandered checkout, multi-dart match opportunity |
| `terminal` | Speak immediately; interrupt everything | Match win |

Policy refinements:

- A priority alone does not guarantee a good call. Deduplicate overlapping signals into one moment—for example, a checkout that is also a favorite change remains one marquee response.
- Add per-category cooldowns, not one global debounce. Routine visits may be spaced out while marquee moments always pass.
- Suppress numerical probability narration for tiny movements even if the score itself is worth mentioning.
- Prefer the most consequential fact in a crowded packet using a stable ordering: match win, authoritative leg resolution, checkout, 180, semantic bust/missed-match-dart sequence, material match/leg consequence, setup/bogey, routine visit.
- Avoid repeated phrasing by sending a bounded list of recent committed transcript summaries in checkpoints, not by letting unlimited raw conversation accumulate.
- If a new dart arrives while ordinary speech is nearly finished, it may complete; if the speech has become factually stale or blocks a higher priority, cancel it.

Thresholds must remain centralized in the provider-neutral policy and covered by fixtures. They should be tunable from observed match cadence, not buried in prompts.

#### Interruption and stale-response suppression

Maintain one `ActiveCommentaryResponse` containing the provider response ID, source event ID, epoch, sequence, priority, output item ID, transcript buffer, start time, and first-audio time.

When a higher-priority event preempts it:

1. Mark the active response cancelled locally before sending any network event.
2. Send `response.cancel` if generation is still in progress.
3. For WebRTC, send `output_audio_buffer.clear` to discard buffered, unplayed audio and truncate it from conversation state.
4. Clear the partial transcript and stop any local sting that is not allowed to overlap.
5. Create the higher-priority response only after cancellation has been issued; do not add it to a FIFO audio queue.

Every transcript/audio callback checks connection generation, epoch, response ID, and source sequence. A late delta or `response.done` from a cancelled response is telemetry only and cannot update visible commentary.

The user-facing Skip action follows the same cancellation path but does not start a replacement response. Muting sets output volume to zero without losing match context; disabling commentary closes the peer connection and clears all ephemeral state.

#### Corrections, undo, and reconciliation

Corrections are an authority problem, not merely another chat message. The model must not continue narrating a timeline that no longer exists.

- A duplicate event ID is ignored.
- A lower sequence in the same epoch is stale and ignored.
- An edit/delete invalidates the affected packet and all derived packets after it until the DartIQ rebuild completes.
- During rebuild, suppress speech and immediately cancel audio sourced from invalidated events.
- Increment `epoch`, cancel/clear speech, and create an authoritative replacement snapshot for any correction that changes score, checkout, winner, probabilities, or classified moments. The current transport can remain warm because subsequent envelopes are epoch-scoped; rebuild the call if resynchronization fails.
- Resume only after the new snapshot is ready. Buffer events from the new epoch, never events from the invalidated epoch.
- A cosmetic player-name change can use a new snapshot without a full restart if no spoken fact becomes false.

If a warm-session correction cannot be acknowledged or the replacement snapshot cannot be delivered, rebuild from that trusted checkpoint rather than trying to prove individual downstream model items were removed.

#### Long matches, checkpoints, and session rotation

Do not use an indefinitely growing conversation as the match database.

- Keep full deterministic history in app state/replay, not inside the model session.
- Send compact dart deltas during a leg.
- At leg completion, construct a deterministic `leg_summary` containing only decisive moments and final facts.
- Periodically replace detailed history with a `match_snapshot` plus a bounded recent-moment list.
- Configure a bounded post-instruction token window and a retention ratio so truncation happens in larger, less frequent steps rather than constantly destroying cache locality.
- Track input/output usage from `response.done` and enforce per-match soft limits. When the limit is reached, keep local stings and deterministic text but suppress routine generated speech.
- Rebuild the connection before the platform's session-duration limit, using the same checkpoint path as reconnect. Schedule rotation early enough that it never happens during a checkout attempt or active response.

Checkpoint contents must be deterministic so reconnect tests can compare exact serialized snapshots. A freshly connected commentator given the latest checkpoint should have enough information to call the next dart correctly without receiving the full historical feed.

#### Reconnect and fallback behavior

Reconnect on failed ICE state, closed data channel, credential/session expiry, provider error, or an application heartbeat timeout.

1. Cancel active speech and detach the old audio stream.
2. Increment connection generation and enter `reconnecting`.
3. Recompute the latest authoritative snapshot and newest accepted sequence.
4. Retry with bounded exponential backoff and jitter while the match page remains active and commentary remains enabled.
5. After the retry budget is exhausted, enter `fallback` for the browser session rather than reconnecting forever.

Fallback order:

1. Realtime native audio and transcript.
2. Existing request-per-turn text plus TTS, while that path remains supported.
3. Existing generated text without audio.
4. Deterministic local commentary line and optional non-speech sting.
5. Silence with a small non-blocking status indicator.

Never replay missed speech after reconnect. Feed the latest checkpoint and continue from live play. A stale call is worse than no call.

#### Local stings and audio mixing

Local assets provide the first perceptual reaction while model audio starts:

- Keep clips short, normalized, and preloaded when commentary audio is enabled.
- Prefer non-speech crowd/impact stings so generated speech can begin over their tail without two voices colliding.
- Map stings deterministically from terminal/marquee signals and test that one dart cannot trigger multiple overlapping clips.
- Duck sting volume as soon as remote speech becomes audible.
- Respect the same mute, volume, reduced-motion/accessibility preferences, and user-gesture audio unlock as Realtime audio.
- Do not add a timestamp cache buster to bundled assets; allow normal browser caching.

The audio coordinator owns both local and remote playback. The old FIFO `TTSService` queue must not remain in front of Realtime output.

#### Session endpoint and security

The narrowly scoped server route uses OpenAI's unified WebRTC interface. It must:

- Read the normal OpenAI API key only on the server.
- Return only the SDP answer and an opaque app-owned session ID. Keep the standard API key and provider call ID server-side.
- Accept an allowlisted model, voice, persona, and match ID; ignore arbitrary client-supplied provider configuration.
- Revalidate that the requested match exists and that commentary is allowed for it.
- Apply origin/CSRF protections appropriate to the app, request-size limits, and rate limiting to prevent credential minting abuse.
- Attach a stable privacy-preserving safety identifier when an authenticated user identity is available; never send a raw email, name, or player ID as that identifier.
- Avoid logging secrets, SDP bodies, full prompts, raw provider payloads, or PII.
- Return cache-control headers that prevent SDP/session responses from being stored.

The browser must treat SDP and its opaque session ID as ephemeral memory: never localStorage, IndexedDB, URL parameters, analytics, or error-reporting context. The server-only call ID may be stored only in the protected session registry so the worker can attach its authenticated sideband.

#### Per-browser versus shared broadcast

V1 uses one session per browser that opts into commentary. This gives the shortest audio path, preserves persona/voice preferences, and avoids building a media relay. It also means different spectators may hear different wording and provider cost grows with the number of listeners.

Measure concurrent listeners and cost before considering a shared broadcast architecture. A future shared producer would require leader election or a persistent server worker, encoded audio distribution, late-join synchronization, and failure transfer. It should not be mixed into the first WebRTC implementation. The DartIQ packet and commentary policy remain reusable if that topology is added later.

Prevent accidental duplicate sessions within one browser by coordinating tabs with `BroadcastChannel`: one active match tab owns audible commentary by default, and another tab must explicitly take over.

#### Proposed repository slices

Names can change during implementation, but preserve these separations:

- `src/app/api/commentary/realtime/session/route.ts`: protected unified WebRTC creation plus registry heartbeat/closure.
- `src/lib/commentary/realtimeTypes.ts`: shared session contracts, model/voice selection, and validation.
- `src/lib/commentary/scoliaRealtimeEvent.ts`: canonical accepted-throw plus DartIQ packet loader and initial policy classification.
- `src/lib/commentary/commentaryPolicy.ts`: deterministic speak/priority/cooldown/interruption decisions.
- `src/services/realtimeCommentaryService.ts`: WebRTC peer/data-channel lifecycle and translation to provider events.
- `src/services/scoliaRealtimeCommentaryPublisher.ts`: worker sideband pool, delivery retry/deduplication, and response interruption.
- `src/services/commentaryAudioCoordinator.ts`: remote stream, stings, mute, volume, autoplay unlock, and skip.
- `src/hooks/useRealtimeCommentary.ts`: React lifecycle, authoritative snapshots, reconnect/fallback orchestration, and UI-facing state.
- `src/lib/dartiq/events.ts`: continue owning the compact DartIQ packet and significance signals.
- Existing `commentaryService.ts` and `ttsService.ts`: fallback adapters until Realtime meets rollout gates.

`useMatchRealtime` should publish accepted provider-neutral packets to the commentary hook rather than containing WebRTC or OpenAI event code. `MatchClient` should orchestrate feature state but not manage peer connections itself. Update `AGENTS.md` as these files and routes are actually added.

#### Testing strategy

Unit tests:

- Packet/envelope serialization, versioning, omission of private fields, and stable event IDs.
- Priority classification, category cooldowns, deduplication, and signal ordering.
- Interruption matrix for every current/next priority pair.
- Epoch/sequence rejection and correction rebuild behavior.
- State-machine transitions, generation guards, retry budgets, and fallback selection.
- Transcript commit/cancel behavior and stale delta suppression.
- Checkpoint determinism and bounded size.

Transport contract tests with a fake peer connection/data channel:

- Session bootstrap sends configuration, then snapshot, in the required order.
- Silent packets never create responses.
- Spoken packets create exactly one response.
- Preemption sends cancel/clear before the replacement response.
- Connection failure detaches audio and cannot leak late callbacks.
- Persona/voice changes rebuild from the newest checkpoint.

Integration tests:

- Manual and Scolia throws produce equivalent feed events.
- Scorer optimistic/accepted path and spectator Supabase path converge on the same event ID and packet.
- Undo/edit/delete during speech cancels the invalid response and resumes from the corrected snapshot.
- Leg transition, fair ending, tiebreak, rematch, early match end, and match win all close or carry session state correctly.
- Multiple tabs do not speak simultaneously without explicit takeover.

Browser/E2E checks:

- Chrome, Firefox, desktop Safari, and iOS Safari receive output-only WebRTC audio without requesting microphone permission.
- Audio unlock, mute, skip, background/foreground, route navigation, and network loss behave correctly.
- Measure detection-to-first-audible latency with a real provider only in an opt-in smoke suite; keep normal CI deterministic with fakes.

Prompt/evaluation fixtures:

- Freeze representative ordinary, notable, marquee, terminal, multiplayer, correction, low-confidence, and fair-ending packets.
- Score factual consistency, brevity, persona fit, repetition, correct pressure-versus-clutch language, and forbidden invention.
- Compare candidate models against identical fixtures before changing the production default.

#### Observability and cost controls

Emit privacy-safe structured metrics keyed by hashed session/match correlation IDs:

- Credential, SDP, ICE, data-channel, and session-ready timings.
- Dart accepted, pressure packet ready, feed event sent/acknowledged, response created, first transcript delta, first remote audio, first audible sample, and response done.
- Warm/cold session, browser/device/network category, model, voice, priority, packet size, transcript words, interruption outcome, and fallback reason.
- Input/output token or audio usage reported by the provider, responses per leg/match, and estimated cost per listener-match.
- Reconnect count, duplicate/stale packet count, cancelled response count, correction rebuilds, and missed-marquee-event count.

Do not store generated audio by default. Store final transcript and event linkage only if a later product requirement explicitly justifies retention and the privacy model is updated.

Initial dashboards should answer:

- Are p50/p95 first-audible targets met for warm sessions?
- How much time is connection setup versus model response versus browser playback?
- Which events are spoken, suppressed, interrupted, or stale?
- Does Mini satisfy factual and persona quality at the desired latency/cost?
- How often does the old fallback activate, and why?

#### Rollout sequence and gates

> **Superseded as delivery sequencing.** These stages record how the realtime transport was
> originally reasoned about. Delivery is defined by
> [One-PR execution order](#one-pr-execution-order) and [Merge gates](#merge-gates); the per-stage
> gates below do not apply.

**Stage 0 — Instrument the transitional path**

- Add the same accepted-dart-to-first-audible timing vocabulary to the existing commentary/TTS path.
- Establish a real baseline before claiming improvement.

**Stage 1 — Transport spike**

- Protected credential route, output-only WebRTC, one hard-coded local test event, native audio, transcript deltas, and cleanup.
- Gate: works on target browsers without microphone permission or API-key exposure.

**Stage 2 — Shadow feed**

- Send real `DartIQDartPacket` context with speech disabled and validate ordering, deduplication, checkpoint size, reconnect, and corrections.
- Gate: no drift between authoritative match state and the last acknowledged commentary snapshot.

**Stage 3 — Internal live commentary**

- Enable deterministic speech policy, Realtime audio/transcript, skip/mute, latest-wins cancellation, and telemetry behind a feature flag.
- Gate: zero stale calls after corrections; no missed terminal events; acceptable factual evals.

**Stage 4 — Hybrid instant reactions**

- Add bundled non-speech stings and coordinated audio ducking for marquee/terminal moments.
- Gate: no double-trigger or voice overlap; local reaction meets the under-50-ms target on representative devices.

**Stage 5 — Limited user rollout**

- Opt-in percentage rollout with automatic fallback and model/config kill switches.
- Gate: warm-session first-audible p50 below 500 ms and p95 below 1 second, fallback rate and cost within agreed budgets, and no regression in match/realtime behavior.

**Stage 6 — Retire transitional TTS**

- Remove the old path only after Realtime is stable across browsers and the fallback decision is revisited explicitly.
- Update API routes, services, tests, deployment documentation, and `AGENTS.md` together.

#### Realtime acceptance criteria

The first production-ready version is complete when:

- The standard OpenAI API key is never present in browser code, storage, logs, or network responses.
- Enabling commentary prewarms one output-only session and never requests microphone access.
- Every accepted dart advances one provider-neutral packet; duplicates and old epochs cannot trigger speech.
- DartIQ values in spoken/transcribed commentary match the source packet exactly.
- Silent darts update context without generating audio.
- Higher-priority moments reliably cancel and clear lower-priority buffered speech.
- Undo/edit/delete cannot leave invalid commentary playing or visible as committed text.
- Reconnect resumes from a bounded authoritative snapshot and never replays missed speech.
- Audio, transcript, mute, skip, persona/voice rebuild, tab ownership, cleanup, and fallbacks work on supported browsers.
- Warm-session latency targets are measured end to end, not inferred from API response time.
- Existing match, Supabase realtime, Scolia, RLS, and DartIQ tests remain green.

#### Official implementation references

Validate event names and request schemas against current official OpenAI documentation during implementation; Realtime APIs and available model/voice settings can evolve:

- [Realtime API with WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc) — browser connection topology, ephemeral credentials, SDP exchange, remote audio, and data-channel events.
- [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations) — session lifecycle, `conversation.item.create`, `response.create`, transcript events, response cancellation, output-buffer clearing, voice constraints, and session duration.
- [Managing Realtime costs](https://developers.openai.com/api/docs/guides/realtime-costs) — truncation, retention ratio, token windows, conversation editing, and Mini tradeoffs.
- [GPT-Realtime-2.1 Mini](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini) — current modality, endpoint, pricing, and model capability reference.

The original recommendation was to begin with post-match analysis, but the delivery order was intentionally changed: the compact live spectator probability strip is the first milestone. The deterministic replay and insight-classification foundations still support later post-match reports and model validation when enough historical data exists.

I’d call the feature DartIQ: DartIQ Report. It could become the app’s signature feature.

---

## DartIQ — decided design and one-PR delivery

**Central product rule**

> DartIQ may approximate, but every approximation is named, versioned where reproduction requires
> it, measurable, and incapable of masquerading as a calibrated fact.

### Why the current engine is being replaced

The current user-facing win probability is a heuristic ranking and must not be treated as a
calibrated probability. Its finish-time buckets create a 170/171 cliff and flat checkout regions;
the temperature softmax gives the same throw advantage at 501, 100, and 40; the invented leverage
index does not measure the expected change in win probability; future legs ignore starter rotation;
and the ideal-route maximum can produce bad user-facing target advice.

Because none of this code is in production, the replacement lands as the DartIQ, not as a
new product generation. Old names may appear in historical discussion, but new code, tables, and
UI must not expose artificial product-generation lineage.

### Production outcome model: `behavioral-v1`

The production-first transition contract is observable and action-free:

```
P((scoreDelta, isDouble) | currentScore, dartsLeft, finishRule, contextBucket)
```

It is a hierarchical categorical model with two independent backoff axes:

1. State evidence backs off from exact state to checkout/score class, then from player to the frozen
   installation population.
2. Sparse outcome cells coarsen score outcomes while retaining exact double outcomes needed for
   legal double-out finishing and bust semantics.

The realized backoff level is persisted as a confidence dimension. The context bucket and raw
sufficient statistics are frozen at match creation, so replay cannot learn from the match it is
evaluating or from future history.

This model predicts how players actually throw from observed states. It deliberately does **not**
infer latent aim, maximize over candidate targets, or offer normative route advice. Visit-start
score, route intent, opponent state, and tactical match situation enter only through the observed
conditioning variables and are otherwise marginalized. `bestSegment` is removed from user-facing
output until an aim-aware model can defend it.

The separation is intentional:

- **Forecasting now:** behavioral transitions learned from actual darts.
- **Normative analysis later:** action-conditioned transitions plus a defensible aim policy.
- **Geometry later:** latent-aim inference from Scolia impact data, evaluated against this behavioral
  baseline before it can replace it.

### Kernel and race architecture

```
full-visit kernel        score → end-of-visit score distribution
partial-visit entry      (visitStartScore, currentScore, dartsLeft) → finish / next-visit distribution
ordered race combiner    player first-finish PMFs + round order → leg probability
match solver             leg probabilities + alternating starters → match probability
```

For a full visit, a three-dart dynamic program produces a sparse score-to-score kernel. A legal
finish is absorbing at zero; an overscore, a leave of one under double-out, or reaching zero without
the required double is a bust self-loop to the visit-start score. Single-out uses its own kernel.

The live entry state is irreducibly
`(visitStartScore, currentScore, dartsLeft)`: a player on 40 with one dart left after opening the
visit on 100 returns to 100 on a bust. Because `behavioral-v1` performs no action maximization, the
partial-visit entry emits a plain distribution rather than an optimized value: busting mass routes
to `visitStartScore` in the end-of-visit distribution, so the outer score dimension never enters a
maximization and the solver stays compact. A dense reachable-state implementation is still built
first as the correctness oracle; optimization is accepted only after benchmarks prove equivalence
within explicit tolerances.

Repeated sparse matrix-vector multiplication yields each player's visit-indexed first-finish PMF
`g_i(v)` and CDF `G_i(v)`. For ordinary play, independence makes the ordered multiplayer race
exact:

```
P(i wins) = Σ_v g_i(v)
  · Π[j before i] (1 − G_j(v))
  · Π[j after i]  (1 − G_j(v−1))
```

The current player's first visit may be partial. Later visits use the full-visit kernel. Future-leg
probabilities use the same model with the actual alternating starter order, and the match solver
combines those leg probabilities rather than applying an average-power heuristic.

Fair ending is not first-past-the-post. Already-finished players remain known tiebreak participants;
pending players have identity-specific probabilities of joining within the round. Enumerate joiner
sets exactly for normal field sizes, and use a deterministic bounded identity-aware approximation
for large fields. The tiebreak solver remains a declared approximation where necessary. Every
bounded path is exposed through `approximationMode`. A count-only Poisson-binomial DP over *how
many* players join is insufficient: it discards *which* players joined, and the tiebreak outcome
depends on their identities whenever tiebreak strengths differ.

Real finish boundaries remain real: 170 can finish in a visit and 171 cannot. The replacement must
remove artificial flat regions and exaggerated cliffs, not smooth away the rules of darts.

### Runtime and ownership

No timing is claimed until benchmarked. Kernels are constructed outside React and cached by frozen
evidence hash, finish rule, outcome-model version, and relevant policy configuration. Cold starts,
partial visits, fair ending, and large fields all receive p50/p95 measurements.

One incremental tracker owns authoritative projection state. It advances exactly once per accepted
dart and rebuilds from the nearest valid checkpoint after correction. Live UI, clean replay,
commentary, and report consume its snapshots; `DartIQLive.tsx` must not independently
reconstruct a projection.

The replay prefix fingerprint includes
`(id, turn_id, dart_index, segment, scored)`, not only the immutable throw ID.

### Significance model — four concepts, no ratio

`WPA / leverage` is removed from product semantics **entirely**, including as a phrasing hint.
Since `E[ |ΔP| / E|ΔP| ] = 1` in every state, the ratio cannot identify which states matter, and
its variance is largest where the denominator is smallest — so `argmax` selects trivia. It is not
an outcome probability, a percentile, a residual standard deviation, or a calibrated rarity
measure. It is a normalized magnitude, and naming it "unexpectedness" would misrepresent it.

The engine emits four separate concepts:

- **Consequence** — total variation `C = ½ Σ_i |P_after,i − P_before,i|`, used universally and
  measured separately for leg and match. For two players this equals acting-player `|WPA|` exactly
  because the probabilities sum to one. For larger fields it also captures probability moving
  among non-actors. The full per-player vector remains attached so the subject is never lost;
  absolute TV floors are bucketed by player count.
- **Opportunity** — `E[|Δ|]` computed pre-dart. The honest name for what the heuristic engine called leverage.
- **Outcome rarity** — probability, percentile, or tail probability of the realized `Δ` under the
  supplied outcome distribution. Never inferred from leverage.
- **Semantic stakes** — match dart, missed double, checkout, bust, repeated failure, story resolution.

Diagnostics also emitted, never used as gates: `μ = Σ q_o Δ_o`, `swingVariance`, and
`z = (Δ_actual − μ) / max(√Var(Δ_o), ε)`.

Note: before/after probabilities are calibratable against outcomes. Their *difference* is
interpretable and testable, but is not independently calibrated the way a 70% prediction is.

#### Gating

Four inputs, none sufficient alone:

1. **Semantic guarantees** — match win, authoritative leg resolution, 180, Nikita special,
   squandered multi-dart match opportunity.
2. **Absolute consequence floors** — separate leg and match thresholds, because early legs of a
   first-to-seven naturally produce small match WPA.
3. **Historical conditional percentiles** — compared against completed darts from similar states:
   race length, current leg score, checkout state, player count, fair-ending phase, confidence tier.
4. **Broadcast cadence** — cooldowns, visit timing, repetition, active story, speech budget.

The gate has a declared cold-start path. Semantic guarantees and absolute leg/match floors work
from day one. Historical conditional percentiles and outcome rarity activate per bucket only after
that bucket reaches the minimum sample count selected by the versioned policy. Missing evidence
degrades to the simpler gate; it never blocks commentary or borrows a threshold from an
incomparable bucket silently.

The **current match's realized WPA quantile must not be the gate.** It is unstable early,
guaranteed to promote something in an uneventful match, capable of suppressing objectively huge
events in a chaotic one, dependent on match duration and path taken, and not comparable between
live and replay unless the policy carefully freezes its prefix state. It may modulate relative
*energy* or select end-of-match highlights; it may not decide whether a meaningful event exists.

#### Visit-level semantics

Three missed match darts is **one marquee completed-visit call**, even when no individual dart is
statistically surprising — the visit carries three match-dart opportunities, a failed visit,
probability surrendered across the visit, an opponent reprieve, and a repeated-miss narrative.
"Expected" is not "uninteresting."

Busts become context-sensitive: a match-losing bull bust is marquee; a bust from 3 after repeated
misses may be ordinary, notable, or deliberately silent. This retires the unconditional promotion
at `src/lib/dartiq/events.ts:176` and the unconditional guarantee at
`src/lib/commentary/commentaryPolicy.ts:214`.

### Evidence shrinkage and confidence dimensions

Retire the fixed shrinkage denominators and the scalar `profileConfidence = max(...)` at
`src/lib/dartiq/evidence.ts:171`. `behavioral-v1` uses hierarchical categorical/Dirichlet
shrinkage from exact player state through coarser state classes and the frozen installation
population. Checkout and bust aggregates remain validation and cold-start evidence, not separate
inputs that double-count behavior already expressed by the transition model.

Expose independent evidence dimensions instead of one magic number: player sample size, state
specificity, outcome coarsening level, population eligibility version, and observed calibration
status. Aim and route-choice confidence do not exist until the geometry model exists.

**Do not ship probability uncertainty bands in this PR.** Ship point predictions and collect
calibration evidence first. Keep outcome randomness (already integrated into the probability),
parameter uncertainty, and model misspecification distinct.

### Geometry — the moat, but intention is latent

Scolia impact coordinates do **not** reveal the intended target. A dart three millimetres inside
S20 might be a missed T20, a deliberate S20, a missed D20, or a setup dart aimed away from the wire.
The model needs `P(aim | impact, score, darts left, opponent state, route tendencies)`:

- Use the normative route policy as an aim prior.
- Use match context to eliminate implausible targets.
- Use geometry as likelihood evidence.
- Retain uncertainty when several aims are credible.
- Learn player bias and covariance relative to *inferred* aim points, with strong population shrinkage.
- Separate target families initially: scoring triples, setup singles, doubles, bull.
- Model systematic bias, radial/angular spread, and possible multimodality — not one global 2D Gaussian.

This is the future `geometry-v1` workstream, not part of the production outcome kernel in this PR.
A normative policy without a physically grounded aim model optimizes against fiction. When the
evidence exists, live forecasting can use a learned route-choice distribution and post-dart grading
can compare an inferred intended-aim posterior with a normative target. It must beat
`behavioral-v1` in walk-forward validation before replacing it.

### Commentary transport

"Speech models are bad JSON readers" is too broad — structured input is valuable. The real defects
are payload size, irrelevant precision, opaque identifiers, and repeated state. Measured today:
**3,788 bytes per dart**, of which **2,232 bytes is narrative memory re-sent in full every dart**,
with 16-significant-digit floats and UUIDs in place of names.

Introduce three presentation functions:

```
renderCommentarySnapshot(...)
renderCommentaryDelta(...)
renderBroadcastDirection(...)
```

A silent dart delta:

```
D84 | Ken | leg 2, visit 9, dart 1
Hit DB for 50: 50 → 0, checkout
Leg 52% → 100%; match 52% → 74% (+22pp)
```

Only changed story memory is appended:

```
STORY STARTED | punished miss
Ken converted after Nikita missed D16 twice last leg.
```

Rules: names only, never UUIDs (retires `src/lib/commentary/broadcastDirector.ts:62`); whole
percentage points, or one decimal only where genuinely useful; provider event IDs stay outside the
spoken context; full snapshot only on connection, correction, rotation, and deliberate checkpoint;
leg summaries replace accumulated dart detail; narrative memory is diffed; and **actual token usage
is measured — byte ratios are not presented as token ratios.** Keep envelope schema/version fields:
the Railway worker, Vercel server, and browser can run adjacent deployments during a rollout even
though the product itself has no public model-generation labels.

### Persistence

Goal: authoritative, replayable, and calibratable. Two findings drive the schema.

#### The delete contradiction

`throws` rows are physically deleted on edit-out in
`src/app/api/matches/[matchId]/throws/[throwId]/route.ts`. A cascading `throw_id` foreign key would
destroy exactly the superseded evidence the schema exists to preserve. Use three columns:

| Column | Kind | Behaviour |
|---|---|---|
| `match_id` | FK | `ON DELETE CASCADE` — whole-match deletion removes its telemetry |
| `throw_id` | nullable FK | `ON DELETE SET NULL` — supports joins while the throw exists |
| `source_throw_id` | copied uuid, no FK | immutable event identity, survives correction |

Both FK columns get indexes. Match → leg → turn → throw already cascades
(`supabase/migrations/0001_init.sql`), and throws carry a direct match FK
(`supabase/migrations/0029_add_match_id_to_turns_and_throws.sql`), so whole-match deletion stays
clean while individual throw correction can no longer erase history.

#### Evidence is not parameters

A model-derived parameter snapshot cannot evaluate a future model if its shrinkage method changes —
the replacement needs the raw evidence the original saw. Conversely a per-dart skill snapshot
barely deduplicates, because current-match form updates parameters after every dart. The
load-bearing frozen artifact is the
**raw historical evidence available before the match influenced it.**

**Leakage confirmed.** `dartiq_player_profiles` and `dartiq_population_profiles` (defined
pre-consolidation in `0055_dartiq_player_profiles.sql`, then superseded by
`0055_dartiq_profiles.sql`) filter on `m.winner_player_id is not null`
with **no time cutoff**, and on `p.is_active = true`. So a completed match becomes part of its own
history, every later match leaks backwards into an earlier prediction, and deactivating a player
retroactively rewrites the population. Replay against the live views is not reproducible. The clean
cutoff is **match creation**. The population may intentionally include only active players, but its
eligibility rule, eligible-player count, and content hash are frozen with the snapshot so later
deactivation cannot rewrite prior evidence.

#### Tables

**`dartiq_model_versions`** — immutable algorithm identity. Implementation/build hash,
configuration JSON and hash, outcome-model version, evidence-schema version, and created timestamp.
These are intrinsic reproducibility fields, not user-facing product generations.

**`dartiq_population_evidence`** — one small content-hashed snapshot per match and finish rule:
raw population sufficient statistics at the creation cutoff, population eligibility rule/version,
eligible-player count, and historical cutoff timestamp.

**`dartiq_player_evidence`** — one raw sufficient-statistics snapshot per match/player/finish rule,
referencing the population evidence. Keep raw evidence separate from parameters so later models can
be evaluated against exactly what production knew at the time.

**`dartiq_skill_snapshots`** *(optional, diagnostic)* — evidence snapshot id, model version id,
derived posterior/configuration, parameter hash. Useful for diagnosing what production used; the
evidence snapshot is the artifact that matters for evaluating a new model.

**`dartiq_projection_events`** — one row per dart projection generation. Match, leg,
`source_throw_id`, nullable `throw_id`, model version, evidence set, epoch/revision, sequence,
pre-state hash, frozen minimal input snapshot, acting player, finish rule, field size, score band,
checkout phase, confidence dimensions, approximation modes, provenance (`live` or
`reconstructed`), live-capture status (`complete`, `partial`, or `not_supported`) plus nullable
cause, `superseded_at`, created and computed timestamps. Absence of manual live capture must not be
mislabelled as complete before the shared tracker write path exists.

```sql
-- partial uniqueness: one live projection per dart per model
create unique index dartiq_projection_events_active_key
  on public.dartiq_projection_events
    (match_id, source_throw_id, model_version_id, provenance)
  where superseded_at is null;
```

**`dartiq_player_projections`** — one child row per projected player: projection event id, player
id, leg probability before/after, match probability before/after, expected finish distribution
summary, player-specific confidence and state buckets. This is better than storing only the acting
player and better than burying the vector in JSONB — it supports normalization checks, multiplayer
calibration, per-player Brier and log-loss, total-variation consequence, and indexable analytical
queries. The full vector may *additionally* be stored as canonical JSON for forensic reproduction,
but never as the only representation.

**`dartiq_projection_resolutions`** — append-only outcomes attach separately to immutable
predictions. Each row has `kind in ('leg', 'match')`, authoritative winner, resolution epoch and
timestamp, and early-ending status where applicable. Corrections supersede predictions and
resolutions; they never mutate frozen probability output.

#### Types, indexes, and policies

- `bigint generated always as identity` primary keys; `timestamptz`; `text` with check constraints.
- `double precision` for computed probabilities — **not** `numeric`. The "use numeric, not float"
  rule targets decimal quantities like money; these values *are* computed IEEE doubles, and a
  numeric conversion would make reproduction harder rather than easier.
- Heavily filtered calibration dimensions as **real columns**, not JSONB — a `->>` filter has no
  usable index.
- **No partitioning.** A few hundred darts × thousands of matches is low single-digit millions of
  rows; the threshold for partitioning is >100M.
- RLS enabled with **no** `anon`/`authenticated` policy — server-written telemetry only.
- Any exposed view sets `security_invoker = true`, re-applied in the same migration on every
  `create or replace view`.
- The final unreleased migration sequence is `0059_dartiq_evidence_views.sql`,
  `0060_realtime_commentary_sessions.sql`, `0061_match_rematch_lineage.sql`,
  `0062_dartiq_telemetry.sql`, `0063_dartiq_evidence_capture.sql`, and
  `0064_atomic_dartiq_projection_replace.sql`. Earlier numbers are occupied by the merged game,
  Slack, and background-job work from `master`; no artificial DartIQ v2/v3 layer is introduced.
- **Bitwise replay is not the product contract.** Code revisions, ordering, math-library behaviour,
  and serialization paths all produce harmless last-bit differences. Use exact hashes for canonical
  inputs and configuration, numerical tolerances for projected outputs, and golden fixtures with
  explicit accepted tolerances.
- **Start indexes minimal**: every FK indexed, the active-projection partial unique index,
  model/time lookup, match/sequence lookup, and child → parent lookup. Then run real calibration
  queries through `EXPLAIN (ANALYZE, BUFFERS)` before adding a wide covering index — at append-heavy
  low millions, unnecessary `INCLUDE` columns cost storage and write amplification.

#### Write path

Shared by manual and Scolia scoring — not a Scolia-only worker path:

```
leg completion
  → canonical replay/finalization service
  → one transaction/batch
  → projection events + player vectors + leg resolution
```

`src/lib/server/completeLeg.ts` is the natural orchestration point; it already centrally rotates
starters and resolves the match. The **evidence snapshot must be captured earlier** — at match
creation, before the first accepted dart, while the current match is still excluded from
completed-history aggregates. Latency telemetry is separate: first-audible measurements must be
emitted live from the browser and cannot wait for leg completion.

### One-PR execution order

The work lands as one PR but remains reviewable through ordered commits. Later commits depend on the
contracts and proofs established earlier. Commentary latency instrumentation is deliberately deferred;
this PR measures DartIQ correctness and calibration rather than optimizing an unobserved speed problem.

#### A. Foundation

1. **Database consolidation** — collapse branch-only migrations `0055`–`0059` into the final
   `0055`–`0058` sequence documented above.
2. **Replay integrity** — replace the ID-only cached-prefix check with the full dart fingerprint and
   prove edit/delete correction equivalence.

#### B. Engine replacement

3. **Outcome contract** — implement `behavioral-v1`, frozen evidence loading, hierarchical backoff,
   and explicit confidence dimensions.
4. **Visit kernels** — implement double-out and single-out full-visit kernels, partial-visit entry,
   and a dense correctness oracle. Validate the oracle against hand-authored categorical outcome
   fixtures with closed-form expected values, not against `behavioral-v1`; agreement between two
   implementations alone does not prove either one correct.
5. **Race and match solver** — produce first-finish PMFs, exact ordered multiplayer race
   probabilities, alternating-starter future legs, and match probabilities.
6. **Fair ending** — add identity-preserving joiners and the declared bounded tiebreak/large-field
   path.
7. **Authoritative tracker** — make one incremental tracker feed live UI, replay, commentary, and
   report; remove the independent React projection.
8. **Metric cleanup** — add total-variation consequence, opportunity, outcome rarity, and semantic
   stakes; remove the invented leverage index, every WPA/leverage ratio, and user-facing
   `bestSegment`.

#### C. Commentary transport and policy

9. **Compact model boundary** — add `renderCommentarySnapshot`,
   `renderCommentaryDelta`, and `renderBroadcastDirection`; use display names, rounded values,
   and narrative diffs. Retain envelope schema/version fields because Railway worker and Vercel
   browser deployments can overlap.
10. **Bust and visit semantics** — change priority assignment, guaranteed-event policy, and
    observation deduplication together. Default busts to notable; promote to marquee only for
    semantic stakes such as a directly squandered checkout or authoritative match-dart sequence.
    Do not tune this policy against old heuristic WPA.

#### D. Frozen evidence and telemetry

11. **Telemetry schema** — add immutable model/config identity, frozen population/player evidence,
    projection events, full per-player vectors, append-only resolutions, provenance, capture status,
    and real calibration columns.
12. **Capture path — completed-leg path shipped** — evidence freezes at match creation and the shared
    `completeLeg()` path batch-persists projection events, full player vectors, realized outcomes,
    and leg/match resolutions for both manual and Scolia play. These rows are explicitly marked
    `not_supported/completed_leg_reconstruction`: no live capture is claimed. Revision replacement
    is serialized and atomic; the database compares a content hash and assigns the monotone revision
    under the same advisory lock, so concurrent or failed corrections cannot create duplicate
    generations, incomplete player vectors, or supersede the prior evidence alone.
13. **Calibration instrumentation** — persist deterministic speak/skip decisions with policy version
    alongside model projections and outcomes. Provider/audio latency instrumentation is out of scope.

#### E. Product surface

14. **Report-lite** — expose the deterministic swing and narrative facts on the existing finished
    match surface first, so the new engine can be inspected immediately.
15. **Full DartIQ Report — shipped foundation** — `/match/[id]/report` is linked from recent games
    and server-loads the canonical replay. Its responsive SVG is server-rendered rather than adding
    a Highcharts client island, keeping the route free of chart hydration and bundle cost.
16. **Report interaction** — add the probability timeline with leg boundaries, scrubber/clickable
    swing list, synchronized Scolia heatmaps, per-player summaries, and a compact shareable story
    whose claims always resolve to deterministic facts.

`analyzeDartIQTimeline()` now drives the report's loading, routing, chart, summary counts, and ranked
dart navigation. Heatmap synchronization, deeper per-player summaries, and sharing remain in the
report-interaction slice of this PR.

#### F. Proof and documentation

17. **Tests and benchmarks** — golden fixtures, property tests, replay/tracker parity, correction
    equivalence, fair-ending normalization, runtime distributions, and commentary renderer/policy
    tests.
18. **Documentation** — update this roadmap, the repository file map/key flows, schema notes, and
    local verification instructions to describe the final implementation only.

### Merge gates

The PR is mergeable only when:

- Every leg and match probability is finite, lies in `[0,1]`, and full vectors sum to one through
  normal play, fair-ending waiting, tiebreaks, and authoritative resolution.
- The incremental tracker, clean replay, live UI, commentary packet, and report agree at every dart
  within an explicit numerical tolerance.
- Recording a corrected match directly produces the same result as recording, then editing or
  deleting, then rebuilding.
- An injected live/reconstructed divergence is detected and recorded rather than silently
  overwritten.
- A match's frozen evidence provably excludes that match and every match created after it, and
  replaying a completed match reproduces the projection production emitted.
- Golden cases cover 501–501, 100–100, 40–40, 40–170, 170–171, partial visits with a different
  visit-start score, ordinary multiplayer order, fair-ending joiners, and tiebreak rounds.
- Cold and warm p50/p95 runtime stay inside the measured live rendering/commentary budget for common
  and deliberately large fields.
- Commentary never receives a player UUID as prose, routine deltas do not resend full narrative
  memory, and corrections cannot leave stale speech or story state alive.
- The full test suite, lint, and production build pass.

### Evidence and claim gates

Merging the machinery does not authorize calibration marketing or automatic tuning:

- Do not call predictions calibrated, publish uncertainty bands, or auto-tune thresholds until the
  frozen evidence reaches predeclared sample requirements and Brier/log-loss calibration results
  support the claim.
- Significance thresholds are versioned policy configuration, never schema, and are evaluated on
  held-out or walk-forward data before tuning.
- A future `geometry-v1` model must beat `behavioral-v1` under walk-forward validation across
  finish rule, field size, score/checkout state, confidence, and Scolia/manual cohorts.
- Model misspecification is reported separately from parameter uncertainty.

This is the one-PR definition of done. Geometry-based aim inference and the normative layer that
depends on it are the deliberately deferred modelling capabilities. That layer is one rung:
latent-aim inference, action-conditioned transitions, target optimization, deadline-aware policy,
and route/setup advice. Probability uncertainty bands are deferred separately, on evidence rather
than modelling. Their interfaces and evidence/version axes land now so they can be added without
corrupting historical evaluation.
