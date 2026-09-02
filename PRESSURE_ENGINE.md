## Pressure Engine

Traditional averages are too blunt. Even the PDC’s own analysis discusses “real averages” and metrics intended to correct the biases of ordinary match averages. PDC stats analysis

Build native advanced metrics:

- Win probability after every dart
- Dart leverage: how consequential was this dart?
- Clutch score relative to personal baseline
- Stolen and thrown-away legs
- Expected checkout percentage
- Setup quality
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

From that one timeline, most of the Pressure Engine falls out naturally.

### A strong V1

Ship a post-match “Pressure Report” containing:

- Win-probability timeline by dart
- Biggest positive and negative swings
- Match turning point
- Highest-pressure checkout
- Stolen leg: won after falling below 20%
- Thrown-away leg: lost after exceeding 80%
- Clutch rating: performance in high-leverage situations
- Setup quality: whether a dart improved the next checkout opportunity
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

Initially, use simulation based on:

- Player three-dart average
- Score distribution
- Double accuracy
- Checkout conversion
- Bust rate
- Historical performance from each score range

When player-specific data is sparse, blend it with league-wide data. As players accumulate darts, their personal model gradually takes over.

Here, “league-wide” currently means the eligible historical player population in this app installation—not a formal league entity. The implemented hierarchy is:

1. The player's completed historical X01 matches for the same finish rule.
2. The installation-wide population for that finish rule.
3. A conservative cold-start fallback when population data is also sparse.

Eligible profiles use completed, non-test, non-ended matches and exclude fair-ending tiebreak turns. Multiplayer history is included because scoring, checkout, and bust samples belong to individual players regardless of field size. Personal estimates are shrunk toward the population, and population estimates are shrunk toward the fallback, preventing tiny samples from producing extreme ratings. Current-match form is then blended on top of that historical prior.

The live client fetches only compact aggregate profiles once per player set and finish rule. It never downloads or rescans a player's raw historical darts after each live throw. If formal clubs, seasons, or leagues are added later, an intermediate league/club baseline can slot between player and installation population without changing the Pressure Engine API.

This requires no new hardware. Existing match history is enough for V1.

### The metric language

I’d define the metrics carefully:

- Win probability: probability of winning the leg or match from the current state.
- Leverage: how much the next dart could realistically change that probability.
- WPA: actual probability gained or lost by the dart.
- Pressure index: leverage combined with opponent threat and match importance.
- Clutch rating: WPA achieved on high-pressure darts compared with the player’s normal expectation.
- Setup quality: resulting checkout probability minus the best realistically available checkout probability.
- Opponent pressure created: increase in the opponent’s required performance after your visit.
- Expected darts remaining: estimated darts needed to finish from the current score.
- Performance above expectation: actual result minus the player model’s expected result.

### One important distinction

Pressure and clutch must remain separate.

A match dart at D16 is high pressure whether it hits or misses. Hitting it is clutch; missing it is not. Otherwise the system merely labels successful darts “high pressure” after the fact.

### What requires extra inference

Last-dart-at-double accuracy needs intended target information. The app can infer most attempts from:

- Remaining score
- Checkout route
- Dart position
- Previous darts
- Finish rule

Scolia geometry makes that inference much stronger. Ambiguous cases could be marked with a confidence score rather than pretending certainty.

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

The first three foundations are in place:

1. A deterministic multiplayer live probability model and compact spectator strip, including the circular player rail for large fields.
2. Deterministic per-dart replay with WPA, leverage, checkout probability, expected darts, setup quality, bogey classification, turning points, and stolen/thrown-away legs.
3. Versioned pressure-event packets with stable IDs, normalized prospective leverage, classified signals, and commentary priorities.

Historical skill inputs are also live. A player's completed X01 history is blended into an installation-wide finish-rule baseline, with conservative fallbacks and sample-size confidence. The browser fetches compact aggregates rather than raw historical matches.

### Forward plan

#### Phase 1 — Make the live engine authoritative

This is the immediate next engineering milestone.

- Replace whole-leg replay on each commentary event with an incremental pressure state machine that advances exactly once per accepted dart.
- Make the live state machine and the post-match replay use the same transition function so they cannot disagree.
- Add deterministic correction handling for edited and deleted darts. A correction must invalidate superseded events and rebuild from the nearest safe checkpoint.
- Model fair endings explicitly: a player who has checked out but is waiting for the rest of the round, multiple players checking out in the same round, and the resulting tiebreak rounds.
- Preserve full multiplayer support. Probabilities must remain normalized for arbitrary player counts and the bounded large-field path must stay fast enough for the spectator screen.
- Expose model version, input confidence, history sample size, and approximation mode alongside every projection for diagnostics, without cluttering the TV UI.

Acceptance criteria:

- The live engine and a clean replay produce the same packet for every dart.
- Undo/edit followed by replay produces the same result as if the corrected match had been recorded that way originally.
- Probabilities sum to 100% through normal play, checkout waiting states, tiebreaks, and match completion.
- A live dart does not trigger a database history scan or a replay of the entire leg.
- Large multiplayer matches remain within the spectator rendering budget.

#### Phase 2 — Ship the post-match Pressure Report

Turn recent games into the main doorway for exploring finished matches. A game row/card should open a dedicated match report containing:

- A match-level probability timeline with leg boundaries and one point per dart.
- A scrubber or clickable swing list that selects the exact before/after board state.
- Biggest gain, biggest miss, turning point, lead changes, stolen legs, and thrown-away legs.
- Per-player pressure summaries: WPA, high-leverage performance, checkout expectation, setup quality, bogey avoidance, and expected versus actual finishing.
- Existing Scolia heatmaps, with the selected player and moment synchronized with the report where geometry exists.
- Honest labels for inferred targets and low-confidence conclusions.
- A compact shareable match story generated from deterministic facts; model-written prose may explain the facts but must never replace them.

This should be the first full expression of **DartIQ: Pressure Report** and the next major user-visible milestone after the live probability strip.

#### Phase 3 — Start collecting calibration evidence

Do not claim the model is calibrated yet, and do not spend time on a historical backtest while the useful dataset is still small. Add the plumbing now so every new match improves the evidence base:

- Record or reproducibly derive the model version, pre-dart projection, actual outcome, finish rule, player count, state bucket, and confidence tier.
- Build diagnostics for calibration buckets, Brier score, log loss, sample counts, and prediction drift.
- Split diagnostics by single/double out, field size, score range, checkout state, and personal-history confidence.
- Keep model versions comparable. A newer model must be evaluated against the same frozen match inputs rather than silently rewriting what the old model predicted.
- Establish minimum sample thresholds before showing calibration claims or automatically tuning coefficients.

Once enough real matches exist, run walk-forward validation: train only on matches that occurred before the match being evaluated. Never let future player history leak into an old prediction.

#### Phase 4 — Complete the advanced metric language

Build the remaining metrics from the shared replay rather than inventing separate formulas in each screen:

- **Clutch score:** pressure-weighted performance relative to that player's own baseline, with a visible confidence band.
- **Performance above expectation:** actual scoring and finishing value minus the state-aware expectation.
- **Opponent pressure created:** how much a visit worsened the opponents' combined winning position or forced a higher-quality reply.
- **Last-dart-at-double accuracy:** inferred only when the intended target is defensible, with stronger confidence for Scolia geometry.
- **Route quality:** compare the played route with credible alternatives, not merely the mathematically highest immediate score.
- **Pressure profile:** show whether a player improves, holds, or declines across leverage bands without overreacting to tiny samples.

Avoid collapsing everything into one unexplained magic number. Each headline rating should be inspectable down to the darts that produced it.

#### Phase 5 — Let the Pressure Engine drive the experience

After the authoritative engine and Pressure Report are trustworthy:

- Feed its event stream into persistent Realtime commentary.
- Generate automatic highlight reels from the highest-value pressure moments.
- Add live records and context such as “highest-pressure checkout this season,” once formal seasons exist.
- Add player tendencies and matchup notes based on stable, adequately sampled patterns.
- Support formal club/league/season baselines between the player and installation-wide population when those entities are introduced.
- Explore simulation-based or learned state models only when they demonstrably beat the deterministic model on held-out matches while meeting the live latency budget.

### Recommended next slice

Build Phase 1 in this order: shared state transition, incremental tracker, edit/undo reconciliation, then fair-ending and tiebreak states. After that, move directly into the recent-game Pressure Report while calibration events accumulate in the background. The persistent commentator stays compatible with the same event contract, but it no longer blocks progress on the core analytics.

### Future realtime commentary architecture

The current request-per-turn commentary endpoint and separate text-to-speech call are transitional. The target is one persistent GPT-Realtime session in the spectator browser for the duration of a match:

- The server uses the standard OpenAI API key only to mint short-lived client credentials. The standard key must never be shipped to the browser.
- The browser establishes the persistent WebRTC connection and receives audio directly from the model.
- Every accepted dart produces a compact, structured event containing the dart result, updated game state, and deterministic Pressure Engine metrics such as match/leg win probability, WPA, leverage, and classified moments.
- The model narrates those facts; it does not calculate or invent the authoritative metrics.
- Feed every dart into the session, but only request speech when the commentary policy calls for it. Ordinary darts preserve context silently while checkouts, lead changes, large swings, pressure misses, and other significant moments can trigger a response.
- Start a session with a compact match/player snapshot, then send event deltas rather than repeatedly sending the entire throw history. Add periodic summaries or checkpoints to keep long multiplayer matches within a predictable context and cost envelope.
- On reconnect, create or restore the session from the current match snapshot plus recent significant moments instead of replaying the full match dart by dart.
- Keep transport-specific Realtime code separate from pressure calculation so the same event stream can later drive text commentary, audio commentary, highlights, notifications, and post-match stories.

A useful eventual event contract is `PressureDartEvent`: stable IDs for deduplication, match/leg/turn/dart position, player and score state, engine version, probability before/after, WPA, leverage, and zero or more classified commentary moments. Edits and undos should emit explicit correction events so the commentator's persistent view does not drift from the authoritative match state.

#### Latency path

The current audible path is necessarily sequential:

`completed turn → /api/commentary → complete text → /api/tts → complete MP3 blob → playback`

The intended replacement removes that text-to-MP3 waterfall:

`dart detected → immediate local reaction + persistent WebRTC event → streamed model audio`

When commentary is enabled, establish and warm the output-only WebRTC session before the next dart. Send structured dart events over its data channel; no microphone input is required. Attach the remote audio track directly to browser playback and update written commentary from transcript deltas as they arrive.

Use a very small stable instruction set and cap ordinary calls to roughly 6–15 spoken words. Start with low reasoning effort, then tune against measured latency and commentary quality. Initial model candidates are:

- `gpt-realtime-2.1-mini` for routine live commentary because it is the faster, lower-cost model.
- `gpt-realtime-2.1` for higher-value moments or recaps only if measurement shows a worthwhile quality gain without unacceptable delay.

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

Instrument a correlated timestamp trail from persisted/detected throw through event dispatch, `response.create`, first transcript delta, first received audio packet, and first audible browser sample. Track p50/p95 by device, browser, network, model, event type, and warm/cold session state. Perceived speed is the product metric; server response time alone is insufficient.

#### Delivery sequence

1. Freeze and version the existing `PressureDartPacket`, then add provider-neutral commentary envelopes and policy contracts independently of any transport.
2. Prewarm a persistent output-only WebRTC session when commentary is enabled.
3. Send compact deterministic dart events and consume native streamed audio plus transcript deltas.
4. Add local stingers for marquee events.
5. Implement priority cancellation/truncation and strict stale-response suppression.
6. Retain the existing commentary and TTS endpoints temporarily as a fallback behind the same commentary interface.
7. Add end-to-end latency telemetry and tune model, reasoning effort, response length, and trigger thresholds from real measurements.

#### Product contract

The commentator is a live presentation layer over authoritative match and Pressure Engine state. Its job is to notice, prioritize, phrase, and speak. It must not become another game engine.

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
- Replacing the post-match Pressure Report or deterministic highlight classifier.

#### Authority boundaries

Keep these responsibilities explicit:

| Layer | Owns | Must not own |
|---|---|---|
| Match engine | Accepted throws, turns, scores, busts, checkouts, legs, winner | Commentary timing or prose |
| Pressure Engine | Probability, WPA, prospective leverage, checkout/setup analysis, classified signals | Persona, voice, jokes, or audio |
| Commentary policy | Whether to speak, priority, interruption, cooldown, local sting selection | Recalculating match or pressure facts |
| Realtime transport | Session/auth lifecycle, event delivery, audio, transcript, cancellation | Event significance or analytics |
| Realtime model | Narrative continuity, concise wording, vocal performance | Correcting supplied facts or inventing missing metrics |
| UI | User controls, connection state, transcript, mute/skip, latency diagnostics | Hidden match-state reconstruction |

The provider-neutral boundary is the existing `PressureDartPacket` in `src/utils/pressureEvents.ts`. Realtime-specific code consumes that packet but does not import or invoke the probability model directly.

#### End-to-end live flow

For every accepted dart:

1. The normal match flow persists or accepts the throw and updates the canonical client state.
2. The incremental Pressure Engine advances once and emits one deduplicated `PressureDartPacket`.
3. The commentary policy enriches the packet with display names and lightweight narrative state, then decides `silent`, `ordinary`, `notable`, `marquee`, or `terminal` handling.
4. The transport sends the event as an `input_text` conversation item over the WebRTC data channel, even when the event is silent.
5. If the policy chooses speech, it first applies the latest-wins interruption rules and then emits `response.create` with moment-specific brevity and delivery instructions.
6. WebRTC delivers generated audio as a remote media stream. Transcript delta events update `CommentaryDisplay` while the call is being spoken.
7. `response.done`, cancellation, timeout, or transport failure closes the local response lifecycle and records latency/outcome telemetry.

Do not wait for Supabase Realtime when the scoring browser already has the accepted API result and authoritative packet. Spectator browsers use the existing ordered Supabase path, deduplicate by event ID, and produce the same packet after applying the realtime event. This preserves the fastest path for the scorer without weakening spectator correctness.

#### Provider-neutral commentary envelopes

`PressureDartPacket` remains the compact analytical payload. Add a thin commentary envelope rather than adding OpenAI fields to it:

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
      packet: PressureDartPacket;
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
- Player names travel in the commentary envelope; the Pressure Engine continues using stable player IDs.
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

Start with `gpt-realtime-2.1-mini` as the latency/cost candidate, but first compare it against `gpt-realtime-2.1` on the same frozen event fixtures. Keep model, voice, reasoning effort, response length, timeout, and truncation settings server-configurable. Do not hard-code routing decisions into `PressureDartPacket`.

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
PressureDartPacket -> conversation.item.create -> no response.create
```

Spoken dart path:

```text
PressureDartPacket -> conversation.item.create -> interruption decision -> response.create
```

The session instruction should establish durable rules once:

- You are a live darts commentator using the selected persona.
- Treat supplied match and Pressure Engine facts as authoritative.
- Never calculate, revise, or contradict probabilities.
- Never call a successful result “high pressure” merely because it succeeded; pressure is pre-dart leverage, while clutch describes performance under it.
- Mention percentages only when the change is meaningful and speak them naturally.
- Prefer what changed and why it matters over repeating the raw score.
- Speak one short line and stop. Do not greet, ask questions, or describe the JSON.
- Do not speak on context-only events.
- Respect corrections and the current epoch; never revive invalidated moments.

Per-response instructions control the moment rather than repeating the full persona prompt. Examples:

- Ordinary: `One restrained line, at most 12 words. Do not force a pressure statistic.`
- Notable: `One line, at most 18 words. Explain the supplied turning point accurately.`
- Marquee: `React immediately, then give one concise consequence. At most 22 words.`
- Terminal: `Announce the winner first, then one decisive Pressure Engine fact. At most 35 words.`

The transcript shown in the UI comes from audio transcript delta/done events, not a second text-generation call. Hold partial text separately from committed commentary so cancellation cannot leave a half-sentence presented as final.

#### Speech trigger policy

The deterministic policy is testable and runs before the provider call:

| Priority | Default speech behavior | Examples |
|---|---|---|
| `silent` | Feed context only | Dart one/two with no significant signal |
| `ordinary` | Speak only if idle and cooldown allows | Completed routine visit |
| `notable` | Speak unless a marquee/terminal response is active | Favorite change, large WPA, high leverage, great/poor setup, bogey creation |
| `marquee` | Speak immediately; interrupt ordinary/notable | 180, bust, checkout |
| `terminal` | Speak immediately; interrupt everything | Match win |

Policy refinements:

- A priority alone does not guarantee a good call. Deduplicate overlapping signals into one moment—for example, a checkout that is also a favorite change remains one marquee response.
- Add per-category cooldowns, not one global debounce. Routine visits may be spaced out while marquee moments always pass.
- Suppress numerical probability narration for tiny movements even if the score itself is worth mentioning.
- Prefer the most consequential fact in a crowded packet using a stable ordering: match win, checkout, 180, bust, favorite change, large match WPA, high leverage outcome, setup/bogey, routine visit.
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
- An edit/delete invalidates the affected packet and all derived packets after it until the Pressure Engine rebuild completes.
- During rebuild, suppress speech and immediately cancel audio sourced from invalidated events.
- Increment `epoch`, create an authoritative replacement snapshot, and restart the Realtime session for any correction that changes score, checkout, winner, probabilities, or classified moments.
- Resume only after the new snapshot is ready. Buffer events from the new epoch, never events from the invalidated epoch.
- A cosmetic player-name change can use a new snapshot without a full restart if no spoken fact becomes false.

Restarting after material correction is intentionally conservative. Although individual conversation items can be deleted, rebuilding from one trusted checkpoint is easier to reason about and test than proving every downstream model item was removed.

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

#### Credential endpoint and security

Add a narrowly scoped server route for Realtime session creation/client secrets. It must:

- Read the normal OpenAI API key only on the server.
- Return only the short-lived credential/session material needed by the browser.
- Accept an allowlisted model, voice, persona, and match ID; ignore arbitrary client-supplied provider configuration.
- Revalidate that the requested match exists and that commentary is allowed for it.
- Apply origin/CSRF protections appropriate to the app, request-size limits, and rate limiting to prevent credential minting abuse.
- Attach a stable privacy-preserving safety identifier when an authenticated user identity is available; never send a raw email, name, or player ID as that identifier.
- Avoid logging secrets, SDP bodies, full prompts, raw provider payloads, or PII.
- Return cache-control headers that prevent client-secret responses from being stored.

The browser must treat the credential as ephemeral memory: never localStorage, IndexedDB, URL parameters, Supabase, analytics, or error-reporting context.

#### Per-browser versus shared broadcast

V1 uses one session per browser that opts into commentary. This gives the shortest audio path, preserves persona/voice preferences, and avoids building a media relay. It also means different spectators may hear different wording and provider cost grows with the number of listeners.

Measure concurrent listeners and cost before considering a shared broadcast architecture. A future shared producer would require leader election or a persistent server worker, encoded audio distribution, late-join synchronization, and failure transfer. It should not be mixed into the first WebRTC implementation. The Pressure Engine packet and commentary policy remain reusable if that topology is added later.

Prevent accidental duplicate sessions within one browser by coordinating tabs with `BroadcastChannel`: one active match tab owns audible commentary by default, and another tab must explicitly take over.

#### Proposed repository slices

Names can change during implementation, but preserve these separations:

- `src/app/api/commentary/realtime/session/route.ts`: protected short-lived credential/session creation.
- `src/lib/commentary/realtimeTypes.ts`: provider-neutral envelopes, session states, response metadata, and telemetry types.
- `src/lib/commentary/commentaryPolicy.ts`: deterministic speak/priority/cooldown/interruption decisions.
- `src/services/realtimeCommentaryService.ts`: WebRTC peer/data-channel lifecycle and translation to provider events.
- `src/services/commentaryAudioCoordinator.ts`: remote stream, stings, mute, volume, autoplay unlock, and skip.
- `src/hooks/useRealtimeCommentary.ts`: React lifecycle, authoritative snapshots, reconnect/fallback orchestration, and UI-facing state.
- `src/utils/pressureEvents.ts`: continue owning the compact Pressure Engine packet and significance signals.
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

**Stage 0 — Instrument the transitional path**

- Add the same accepted-dart-to-first-audible timing vocabulary to the existing commentary/TTS path.
- Establish a real baseline before claiming improvement.

**Stage 1 — Transport spike**

- Protected credential route, output-only WebRTC, one hard-coded local test event, native audio, transcript deltas, and cleanup.
- Gate: works on target browsers without microphone permission or API-key exposure.

**Stage 2 — Shadow feed**

- Send real `PressureDartPacket` context with speech disabled and validate ordering, deduplication, checkpoint size, reconnect, and corrections.
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
- Pressure Engine values in spoken/transcribed commentary match the source packet exactly.
- Silent darts update context without generating audio.
- Higher-priority moments reliably cancel and clear lower-priority buffered speech.
- Undo/edit/delete cannot leave invalid commentary playing or visible as committed text.
- Reconnect resumes from a bounded authoritative snapshot and never replays missed speech.
- Audio, transcript, mute, skip, persona/voice rebuild, tab ownership, cleanup, and fallbacks work on supported browsers.
- Warm-session latency targets are measured end to end, not inferred from API response time.
- Existing match, Supabase realtime, Scolia, RLS, and Pressure Engine tests remain green.

#### Official implementation references

Validate event names and request schemas against current official OpenAI documentation during implementation; Realtime APIs and available model/voice settings can evolve:

- [Realtime API with WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc) — browser connection topology, ephemeral credentials, SDP exchange, remote audio, and data-channel events.
- [Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations) — session lifecycle, `conversation.item.create`, `response.create`, transcript events, response cancellation, output-buffer clearing, voice constraints, and session duration.
- [Managing Realtime costs](https://developers.openai.com/api/docs/guides/realtime-costs) — truncation, retention ratio, token windows, conversation editing, and Mini tradeoffs.
- [GPT-Realtime-2.1 Mini](https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini) — current modality, endpoint, pricing, and model capability reference.

The original recommendation was to begin with post-match analysis, but the delivery order was intentionally changed: the compact live spectator probability strip is the first milestone. The deterministic replay and insight-classification foundations still support later post-match reports and model validation when enough historical data exists.

I’d call the feature DartIQ: Pressure Report. It could become the app’s signature feature.
