# Repository Guidelines

> **Keep this file up to date.** When you add, remove, or rename files, routes, hooks, utils, or components, update the relevant sections of this file (especially the File Map and Key Flows). This ensures future agents can navigate the codebase without exploring from scratch.

## Goal
Help make small, correct changes in a TypeScript Next.js + Supabase dart scoring app without breaking auth, RLS, realtime, or build.

## Project Structure & Module Organization
- `src/app`: Next.js app router (routes, layout, styles). Example: `src/app/api/matches`.
- `src/components`: Feature components (PascalCase). `src/components/ui`: shadcn/ui primitives (lowercase files).
- `src/utils`: Game logic and helpers (e.g., `x01.ts`, `eloRating.ts`).
- `src/lib`: Client initializers and shared libs.
- `src/hooks`: React hooks for match state, actions, realtime, and commentary.
- `src/services`: External service clients (commentary API, TTS audio).
- `src/workers`: Long-running backend processes (Scolia board WebSocket connections).
- `scripts`: Local operational and demo harnesses; `commentaryDemo.ts` provisions and drives test-only synthetic Scolia matches.
- `scripts/workerLoader.mjs` and `scripts/workerResolve.mjs`: Standalone Node TypeScript loader for the worker/demo; resolves repository aliases and server-only imports without temporary files.
- `scripts/workerLoader.test.mjs`: Native Node runtime checks for the commentary publisher and full worker entry point; startup stops at missing configuration without contacting external services. Worker dependencies must use erasable TypeScript syntax (no constructor parameter properties).
- `src/test-utils`: Test factories, mock Supabase client.
- `public`/`favicon`: Static assets.
- `e2e`: Playwright E2E tests and fixtures.
- `supabase`: SQL migrations and local config.
- `supabase/tests`: SQL regression tests for migration-level invariants and RPCs.
- `scripts/supabase-migrations.mjs`: Exact-name migration validation, deployment, and production verification.
- `supabase-test`: Separate Supabase config for E2E tests (port 56XXX).
- `.github/workflows/test.yml`: Required CI check for lint, unit tests, build, and Lighthouse performance budgets.
- `.lighthouserc.json`: Mobile Lighthouse workload and performance limits for the home page.
- `DEPLOYMENT.md`: Beginner-friendly production deployment guide for Vercel + Supabase.
- `DARTIQ.md`: Product and modeling roadmap for DartIQ probabilities, consequence, checkout analysis, commentary, and reports.
- `Dockerfile.scolia-worker`: Production container for the separate persistent Scolia worker.
- `railway.json`: Railway config-as-code for the single-replica Scolia worker service.
- `docs/SCOLIA_SOCIAL_API.md`: Markdown reference for the complete Scolia Social API v1.2 protocol.

## File Map

- `src/lib/auth/requireAdmin.test.ts`: Verifies mapped Google self-service access, unmatched-user refusal, and unchanged admin authorization.
- `src/components/profile/ProfileClient.test.tsx`: Verifies retry and direct Slack sign-in from the profile identity error state.
- `src/auth.ts` and `src/auth.test.ts`: Slack is the primary player identity. Google sessions map verified work emails through the configured Slack workspace, retry unresolved identities after one minute, and revalidate resolved identities after five minutes. Provider changes clear previous identity claims.
- `src/lib/slack/members.test.ts`: Covers exact email/workspace matching, inactive/bot/guest rejection, malformed responses, configuration failures, and cached lookup recovery.

- `src/proxy.ts`: Accepts authenticated Slack and Google sessions with email and workspace identity, including Google users without a Slack link. `src/proxy.test.ts` covers redirect-loop prevention and anonymous access restrictions.

### Pages (`src/app`)
| Path | Purpose |
|------|---------|
| `globals.css` | Shared theme tokens and subtle default borders for cards, tables, dialogs, and dividers, with cyan focus accents and separate light-surface colors |
| `layout.tsx` | Shared site navigation with a subtle cyan/blue/violet gradient bottom border, expanded desktop link hit areas that preserve spacing/header height, and a shared gradient underline that slides between desktop nav items on hover/focus with brighter, visually heavier text/icons |
| `page.tsx` | Home — leaderboard grid with neutral dark action cards that reveal cyan/blue, violet/pink, and emerald/teal gradients only on hover for New Match, New Tournament, and Practice; gradient outer borders that thicken on hover without shifting content, hover glow and icon scaling, and reduced-motion support |
| `tournament/[id]/TournamentClient.tsx` | Bracket and standings; clicking a match safely claims the preferred board, requests TV fullscreen, and opens spectator/commentary URL preferences with visible conflict errors |
| `tournament/[id]/TournamentClient.test.tsx` | TV/commentary navigation and busy-board failure regression checks |
| `tournament/new/page.test.tsx` | Hydration regression tests for saved location filters, including empty selections and preserving preferences during mount |
| `tournament/new/page.tsx` | New Tournament restores location/board/commentary preferences after hydration, offers ready Scolia board selection and persisted per-tournament commentary, and uses the New Match desktop layout: full-height scrolling settings, styled fair-ending switch, inline player heading/location/search toolbar with an Add player dialog matching the shared rematch modal and a persisted No location filter and selected players retained through filters in their original sort order, large player tiles, and fixed gradient start action with removable avatar lineup using the same entry bounce, staggered pulse, and start-hover hops as New Match (respects reduced motion) |
| `new/page.tsx` | New X01 or party-game form with a top-row Add player dialog matching the shared rematch modal, a persisted No location filter, selected players retained through location/search filters in their original sort order without filter-driven deselection, and a saved optional Bull-off toggle below fair ending with a bullseye icon that is slate when off and cyan when on and styled fair-ending and saved spectator-commentary switches (carried into the match URL), locally remembered rules, party options, and ordered active-player lineup; stacked game cards with blue/cyan gradient selection outlines in a narrow full-height independently scrolling desktop settings column within a viewport-height desktop layout alongside a full-width, scrollable player grid with four columns from xl, large avatar/name tiles, and most-played-first ordering (X01 plus party-game participation counts, then alphabetical) and a fixed bottom bar with a half-width start action and centered avatar lineup that overlaps to fit, with entry bounces, staggered reduced-motion-aware pulses, excited hops on Start hover/focus, and click-to-remove, with optional ready Scolia board selection; opens new games in spectator mode when browser-local TV mode is enabled |
| `match/[id]/page.tsx` | Match page (server component) |
| `match/[id]/MatchClient.tsx` | Main match client — orchestrates all hooks, switches scoring/spectator/history stats view; development performance overlay is opt-in via `perf=true`; bull-off handoff preloads spectator UI and waits for the confirmed order/starter before switching, retaining the commentary connection and issuing one game-opening call unless scoring already started |
| `match/[id]/report/page.tsx` | Server-rendered DartIQ replay data, deterministic match story, player baseline/WPA breakdowns, and initial URL-selected dart hydration for the client-local report explorer |
| `game/[id]/page.tsx` | Party-game page (server component) |
| `game/[id]/GameClient.tsx` | Party-game scoring and spectator client |
| `games/page.tsx` | Player-searchable X01 and party-game history with paginated loading, daily activity filtering, completed X01 stats links, and development-only dummy data at `?preview=1` |
| `players/page.tsx` | Player management (list non-test players, create, edit location) |
| `boards/page.tsx` | Scolia board management (connectivity, availability, active match/game links, connect/disconnect) and browser-local TV mode toggle with the shared cyan switch-card styling |
| `stats/page.tsx` | Stats and leaderboards |
| `leaderboards/page.tsx` | Detailed X01, Elo, party-mode and Top 10 Bullers leaderboards; bullers rank by unrounded average inches ascending with measured-dart and miss counts |
| `elo-multi/page.tsx` | Multiplayer Elo leaderboard |
| `practice/page.tsx` | Practice mode (select player) |
| `practice/[playerId]/page.tsx` | Practice session for a player |

### API Routes (`src/app/api`)
| Route | Methods | Purpose |
|-------|---------|---------|
| `tournaments/` | POST | Create a tournament with validated board and commentary preferences; bracket matches initially remain unassigned |
| `tournaments/[id]/matches/[matchId]/open/` | POST | Verify bracket membership, claim the preferred board for the active match using database occupancy guards, and return the persisted commentary preference; route tests cover conflicts, manual and completed matches |
| `matches/` | POST | Create a new match, optionally with a pre-game Bull-off |
| `matches/[matchId]/bull-off/` | POST | Revision-checked manual bull-off distance/miss recording and dart-removal handoff; hardware matches reject manual entry |
| `matches/[matchId]/` | DELETE | Passcode-protected permanent deletion of a standalone match and its dependent game data |
| `matches/[matchId]/throws/` | POST, DELETE | Record or delete a dart throw |
| `matches/[matchId]/throws/[throwId]/` | PATCH, DELETE | Edit or delete a specific throw |
| `matches/[matchId]/turns/` | POST | Create a turn |
| `matches/[matchId]/turns/[turnId]/` | PATCH, DELETE | Finish a turn (score, bust); auto-resolves leg on fair ending |
| `matches/[matchId]/legs/[legId]/complete/` | POST | Complete a leg (set winner, create next leg or finalize match + Elo) |
| `matches/[matchId]/end/` | PATCH | End match early |
| `matches/[matchId]/pause/` | PATCH | Pause or resume an active match |
| `matches/[matchId]/rematch/` | POST | Create a rematch |
| `matches/[matchId]/players/` | POST | Add player to match |
| `matches/[matchId]/players/new/` | POST | Create new player and add to match |
| `matches/[matchId]/players/[playerId]/` | DELETE | Remove player from match |
| `matches/[matchId]/players/reorder/` | PATCH | Reorder players |
| `matches/[matchId]/dartiq/evidence/` | GET | Load the match's frozen, server-authoritative DartIQ player and population evidence |
| `elo/update/` | POST | Update 1v1 Elo ratings |
| `elo-multi/update/` | POST | Update multiplayer Elo ratings |
| `players/` | GET, POST | List or create players |
| `players/[playerId]/` | PATCH | Update a player's location |
| `games/` | POST | Create a Cricket, Killer, Shanghai, or Around the Clock session |
| `games/[id]/` | GET | Load a party-game session, players, throws, and derived state |
| `games/[id]/throws/` | POST, DELETE | Record or undo a party-game dart |
| `games/[id]/end/` | PATCH | End a party game early |
| `games/[id]/rematch/` | POST | Create a party-game rematch |
| `scolia/boards/` | GET, PUT | List/connect Scolia boards and merge worker plus active-match status |
| `scolia/boards/available/` | GET | List safe board status and availability for match selection |
| `scolia/boards/[serialNumber]/` | DELETE | Disconnect a board from the Scolia service account |
| `practice/sessions/` | POST | Create practice session |
| `practice/sessions/[id]/end/` | PATCH | End practice session |
| `practice/sessions/[id]/throws/` | POST | Record practice throw |
| `around-world/sessions/` | POST | Create Around the World session |
| `commentary/` | POST | Generate AI commentary via LLM |
| `commentary/realtime/session/` | POST, PUT, PATCH, DELETE | Create an output-only OpenAI Realtime WebRTC call, advance its correction epoch, record versioned browser speak/skip decisions, heartbeat it, or close it |
| `tts/` | POST | Text-to-speech for commentary |
| `slack/darts/` | POST | Verify Slack slash commands/button actions and create dart polls |
| `auth/[...nextauth]/` | GET, POST | Auth.js (next-auth v5) Sign in with Slack handlers; `auth/slack/callback` aliases the callback URL |
| `admin/players/` | GET, POST | Admin-only: players with Slack links plus workspace directory; create player |
| `admin/players/[playerId]/` | PATCH | Admin-only: rename, edit nicknames, relocate, or (de)activate a player |
| `admin/players/[playerId]/slack-link/` | PUT, DELETE | Admin-only: link/unlink a player and a Slack user in `slack_player_links` |
| `admin/slack/sync/` | POST | Admin-only: import workspace members as players (first name / `First L`) and link them |
| `me/` | GET, PATCH | Signed-in member's own player (via `slack_player_links`); edit nicknames/location |
| `me/link/` | POST | Claim an unclaimed player or create one and link it to my Slack identity |
| `me/avatar/` | POST, DELETE | Upload/remove my own profile picture |
| `background-jobs/` | POST | Authenticate Supabase job batches and run typed background handlers |

### Utils (`src/utils`) — Pure Business Logic
| File | Purpose |
|------|---------|
| `x01.ts` | Core X01 game engine: `applyThrow()`, `calculate3DartAverage()` |
| `fairEnding.ts` | Fair ending state machine plus current-phase pending-player selection for incremental DartIQ projections |
| `dartboard.ts` | Dartboard geometry: `computeHit()` from SVG coordinates, `segmentFromSelection()` |
| `eloRating.ts` | 1v1 Elo: `calculateNewEloRatings()`, leaderboard/stats queries |
| `eloRatingMultiplayer.ts` | Multiplayer Elo: `updateMatchEloRatingsMultiplayer()`, stats queries |
| `checkoutSuggestions.ts` | DFS checkout combinations for a remaining score |
| `checkoutTable.ts` | Pre-computed double-out checkout lookup table |
| `legScoreCalculator.ts` | Calculate remaining scores from turns/throws |
| `matchStats.ts` | Live spectator scores, round stats |
| `nikitaSpecial.ts` | Exact order-independent detector for the marquee 1 + 5 + 20 visit |
| `haptics.ts` | Mobile haptic feedback via `navigator.vibrate` |

### Hooks (`src/hooks`)
| File | Purpose |
|------|---------|
| `useMatchData.ts` | All match state loading: `loadAll()`, `loadAllSpectator()`, per-entity loaders |
| `useMatchActions.ts` | Player actions: `handleBoardClick`, `undoLastThrow`, `endLegAndMaybeMatch`, rematch, player management. Serializes concurrent throws via queue. |
| `useMatchRealtime.ts` | Connects Supabase realtime events to state; uses spectator reducer for incremental updates |
| `useRealtime.ts` | Low-level Supabase channel subscription, DOM custom events, connection lifecycle |
| `useCommentary.ts` | Commentary state, persona selection, TTS, preferences and bounded, deduplicated completed-call history; one-tap Verse audio activation with synchronous gesture unlock and actual Realtime status, plus one-time spectator auto-start from the new-match preference |
| `useRealtimeCommentary.ts` | Owns the persistent output-only browser WebRTC commentary connection and fallback lifecycle |
| `useMatchEloChanges.ts` | Fetches Elo changes after match completion |
| `useScoliaBoardRealtime.ts` | Pushes sanitized board status and match-occupancy changes into board UIs |
| `useDartIQ.ts` | Fetches match-frozen DartIQ evidence and builds cached per-player outcome models |
| `useDartIQWorker.ts` | Browser worker lifecycle: single-flight/latest-wins live analysis, stale-result rejection, bounded restart, and off-thread spectator fallback commentary |
| `useGameData.ts` | Loads party-game rows, derives client state, and reconciles Supabase realtime changes |
| `useGameActions.ts` | Queues party-game throws, undo, early ending, and rematch actions |

### Lib (`src/lib`)
| Path | Purpose |
|------|---------|
| `dartiq/projection.ts` | Live leg/match probability projection, expected visits, exact standard-play next-dart opportunity enumeration, fair-ending, tiebreak, and future-leg race semantics |
| `dartiq/checkout.ts` | Behavioral live-visit checkout probability, descriptive leave impact, and bogey-leave evaluation |
| `dartiq/evidence.ts` | Typed historical evidence normalization and hierarchical player skill models |
| `dartiq/replay.ts` | Single-pass canonical dart replay with before/after projections, WPA, and full-field consequence |
| `dartiq/tracker.ts` | Correction-safe verified replay-prefix owner used by live UI and the Scolia commentary worker |
| `dartiq/liveWorker.ts` | Serializable live-worker protocol and worker-owned model/tracker processor; regression tests cover protocol lifecycle and canonical replay parity |
| `dartiq/insights.ts` | Turning points, lead changes, stolen/thrown-away legs, and ranked commentary moments |
| `dartiq/events.ts` | Compact provider-neutral dart packets plus deterministic editorial classification; match-win signals require explicit resolution, and fair-ending packets retain pending players |
| `dartiq/calibration.ts` | Pure full-vector calibration metrics, chronological match-level temperature fitting/validation, and geometry coverage diagnostics; never promotes models automatically |
| `dartiq/model/{outcomes,visit,race}.ts` | Behavioral outcomes, double-out visit transitions, and ordered multiplayer race math |
| `dartiq/model/training.ts` | Bounded empirical behavioural fitting, scoring-only spatial smoothing, fixed-artifact follow-up validation, adaptive inference, and regression monitoring |
| `match/bullOff.ts` | Pure one-dart bull-off state machine, 0.1 mm measurement precision, repeated tied-position rethrows, takeout gating, inch-mark display formatting, and provisional live ranking; colocated regression tests |
| `server/bullOff.ts` | Service-only atomic compare-and-swap bull-off transitions and Scolia event deduplication |
| `commentary/bullOff.ts` | Authoritative bull-off distance/order briefs with inches reactions and explicit separation from X01 results; colocated tests |
| `match/types.ts` | Core types: `Player`, `MatchRecord`, `LegRecord`, `TurnRecord`, `ThrowRecord` |
| `match/selectors.ts` | Pure selectors: `selectCurrentPlayer`, `selectPlayerStats`, `canEditPlayers`, etc. |
| `match/loadMatchData.ts` | Parallel fetch of match + players + legs + turns from Supabase |
| `match/realtime.ts` | `PendingThrowBuffer`, realtime payload helpers |
| `match/spectatorRealtimeReducer.ts` | Pure reducer for spectator state from realtime events |
| `server/matchGuards.ts` | API route guards: `loadMatch()`, `isMatchActive()` |
| `server/completeLeg.ts` | Idempotent leg completion: winner, next leg creation, Elo RPC |
| `server/turnLifecycle.ts` | Race-tolerant turn creation, `resolveOrCreateTurnForPlayer()` |
| `server/recomputeLegTurns.ts` | Recomputes turn scores from raw throws after edits |
| `server/dartiqEvidence.ts` | Captures and loads immutable per-match DartIQ evidence without future-history leakage |
| `server/dartiqTelemetry.ts` | Persists queued live and reconstructed DartIQ revisions, full probability vectors, authoritative resolutions, and live/replay divergence checks; `DartIQTelemetryBatch` uses database source revisions and verified replay checkpoints to avoid unchanged downloads and repeated projection work |
| `server/dartiqCalibration.ts` | Daily temperature reports plus separate trained-artifact fitting, validation, compare-and-swap activation, and rollback orchestration |
| `server/createMatch.ts` | Creates X01 matches, ordered players, and the first leg through one transaction |
| `server/backgroundJobs.ts` | Validates claimed jobs, dispatches Slack and DartIQ capture handlers, and records completion/retry/failure |
| `server/rematchPlayers.ts` | Validates optional rematch lineups while retaining empty-request compatibility |
| `server/createGameSession.ts` | Validates configuration and creates party-game sessions with ordered players |
| `server/gameGuards.ts` | Loads typed party-game rows and checks active-session state |
| `server/gameThrowLifecycle.ts` | Owns transactional party-game append, undo, and completion mutations |
| `server/gameScoliaIngestion.ts` | Maps persisted Scolia detections into party-game throw lifecycle operations |
| `server/scoliaBoardTarget.ts` | Resolves whether a board is assigned to an active X01 match or party game |
| `server/scoliaCommands.ts` | Enqueues current-round Scolia correction/deletion notifications for the worker WebSocket |
| `server/scoliaThrowIngestion.ts` | Idempotently maps persisted Scolia detections into the active app match and completes turns/legs |
| `games/types.ts` | Shared party-game modes, session state, engine, configuration, and event contracts |
| `games/presentation.ts` | Validates typed party-game views and derives mode-specific turn targets and rule guidance |
| `games/registry.ts` | Maps party-game modes to their replay engines |
| `games/replay.ts` | Shared turn grouping, player rotation, and configuration parsing helpers |
| `games/segment.ts` | Converts canonical dart segments into scores and multipliers |
| `games/labels.ts` | Party-game labels, configuration controls, and UI defaults |
| `games/engines/*.ts` | Pure replay engines for Cricket, Killer, Shanghai, and Around the Clock |
| `commentary/personas.ts` | Chad and Bob commentary personas (retired IDs fall back to Chad) and shared voice instructions for nicknames and signature-event celebrations |
| `commentary/promptBuilder.ts` | Builds LLM prompts from game context |
| `commentary/realtimePrompt.ts` | Builds compact labeled Realtime session prompts and per-call briefs, with provisional fair-ending and forecast-expiry rules |
| `commentary/realtimePlayback.ts` | Tracks generation separately from audible playback, recognizes GA `output_audio` and legacy `audio` content, and ignores stale stop events after interruptions |
| `commentary/realtimeResponseQueue.ts` | Serializes latest-wins Realtime response replacement across asynchronous provider cancellation |
| `commentary/commentaryPolicy.ts` | Listener-local deterministic speech policy: loose office-match cooldowns, observation memory, live reaction windows, guaranteed calls, and major-event interruption while notable observations preserve ongoing speech |
| `commentary/commentaryVisitTiming.ts` | Shared visit-gap coordinator with worker speech-expiry windows: suppresses stale pending calls, lets ongoing lines finish across routine darts, expires live anticipation on the next dart, nudges once per waiting visit after 12 seconds from takeout, and recovers stuck responses with a 30-second watchdog |
| `commentary/commentaryNarrative.ts` | Builds bounded factual story memory from DartIQ replay: tendencies, unconverted finish history, biggest swing, rematch stakes, baseline performance, and deterministic frozen-history rivalry selection |
| `commentary/storyArcDirector.ts` | Scores competing factual match arcs, selects one broadcast angle, and assigns analysis/sass/callback/closing treatment |
| `commentary/broadcastDirector.ts` | Stateful listener-local producer plus canonical report replay: arc hysteresis, lifecycle events, reserve stories, editorial budgets, and verified payoff/closure obligations; persistent listener-local rivalry beats and playback-confirmed callback memory |
| `commentary/commentaryDemoScenario.ts` | Deterministic six-player 301 double-out office broadcast demo with scrappy scoring, isolated trebles/doubles, clustered finish tension, and a D16 payoff, with synthetic Ada/Ben rivalry evidence for the local demo |
| `commentary/realtimeTypes.ts` | Shared Realtime session/correction-envelope contracts, model default, UUID validation, and legacy-to-Realtime voice mapping |
| `commentary/realtimeSnapshot.ts` | Builds compact authoritative match snapshots for new, reconnected, and rotated Realtime sessions |
| `commentary/scoliaRealtimeEvent.ts` | Shares canonical replay/model construction with listener-triggered cache preparation; loads an accepted Scolia throw and its turn/leg/match/player facts in one joined canonical read, attaches its deterministic DartIQ packet, adds coordinate-verified ring proximity, current-visit grouping distances, and frozen-model before/next-dart landing forecasts, and classifies speech priority without waiting for Supabase Realtime |
| `avatars.ts` | Shared avatar sizes, default goblin icon assignment (`public/avatars/default`, keyed `goblin-01..40`, picked per player id), escaped grid HTML, and storage URL parsing |
| `tvMode.ts` | Browser-local TV mode preference and click-triggered fullscreen request for new-game spectator navigation; fullscreen denial never blocks starting a game |
| `supabaseClient.ts` | Browser-side Supabase client (cached) |
| `supabaseServer.ts` | Server-side Supabase client (API routes) |
| `apiClient.ts` | Typed fetch wrapper: `apiRequest<T>()` |
| `scolia/access.ts` | Development-only board-management guard pending production admin auth |
| `scolia/availability.ts` | Pure live-heartbeat and ready-state checks for match assignment |
| `scolia/client.ts` | Server-only Scolia REST client for board registration |
| `scolia/commandRecovery.ts` | Pure acknowledgement timeout and bounded-retry policy for outbound board commands |
| `scolia/orderedWorkQueue.ts` | Cohesive worker scheduling: ordered head retries, bounded concurrency across independent matches, and coalesced board/session-specific notification wake-ups |
| `scolia/protocol.ts` | Pure Scolia message/throw parsing, board-state mapping, and reconnect timing |
| `scolia/types.ts` | Shared Scolia board response types |
| `slack/dartPollService.ts` | Creates polls, records votes, links Slack users to players, and finalizes matches |
| `slack/members.ts` | Lists full, active, human workspace members via `users.list`; validates Google email mappings with bounded, shared `users.lookupByEmail` requests |
| `slack/playerLinks.ts` | Typed client for atomic Slack identity claim, replacement, and unlink RPCs |
| `slack/playerImport.ts` | Plans and applies the Slack member → player import with the first-name / `First L` naming rule; synchronizes linked names atomically while preserving old names as nicknames |
| `auth/slackWorkspace.ts` | Pure Slack sign-in gate helpers (team id, verified email, allowed domains, admin list) |
| `auth/requireAdmin.ts` | Session guard for `/api/admin` routes |
| `slack/dartTime.ts` | Parses the `/dart` command (optional time or `now`, start score, legs, finish rule) in the configured IANA time zone |
| `slack/messages.ts` | Builds accessible Slack Block Kit poll messages |
| `slack/signature.ts` | Verifies Slack request signatures and rejects replayed requests |

### Components (`src/components`)
| File | Purpose |
|------|---------|
| `profile/ProfileClient.tsx` | Own profile and stats, with admin-only player nickname editing |
| `profile/AdminNicknameEditor.tsx` | Admin player picker and nickname form using the protected admin API; regression tests cover saving, clearing, and failures |
| `match/BullOffRound.tsx` | Pre-game manual/Scolia Bull-off view with a full-screen navigation-free spectator shell: a large centered gradient Bull-off heading, viewport-centered expanded layout, provisional sorted cards, muted pending states, a bright cyan pulsing current-player card with Your throw/Remove dart badges instead of a separate status box, impact pops and rank movement, a minimal shared animated distance ruler with inch marks, takeout controls and commentary; reduced-motion support and UI regression tests |
| `match/MatchScoringView.tsx` | Active scoring view — scores, dartboard/keypad, actions |
| `match/MatchSpectatorView.tsx` | Read-only spectator view |
| `match/SpectatorLiveMatchCard.tsx` | Responsive live player scoreboard grid with a compact inline match header, compact viewport-aware tile heights, container-scaled avatars, names, and larger scores with correction-safe impact motion, on-throw light sweeps, reduced-motion support, bold names, lime on-throw tiles, dart indicators, and compact stats with a chunkier responsive AVG value and average-rating emojis, retaining small Last/Best labels without a separate current-turn header; desktop grid fills the stretched card, with overflow scrolling and larger collapsed-board tiles sized for balanced six- and eight-player layouts |
| `match/DartIQLive.tsx` | DartIQ broadcast strip directly above the spectator Score Progress chart, with per-dart leg/match probabilities, large-field circular rail, and gated top-three next-dart landing predictions from the shared tracker |
| `match/MatchPlayersCard.tsx` | Player list with scores, averages, legs won |
| `match/LiveScoliaBoard.tsx` | Read-only spectator dartboard with live Scolia impact positions and detected dart orientation, plus a chunky current-player avatar left of the name that follows visit/takeout handoffs; lower-right collapse toggle remembers its state in browser-local storage across matches and reloads, hides the board, stacks a larger avatar above the centered player name, and stacks dart scores in a narrow one-fifth-width desktop column while expanding the responsive player grid, with a smooth column resize, board shrink/fade, borderless ghost toggle with press feedback, and reduced-motion support; viewport-height card scales the SVG and readouts to fit, without resize work in the dart-processing path |
| `match/ScoliaMatchHeatmaps.tsx` | Whole-match per-player Scolia impact density boards for spectator mode |
| `match/DartIQReportExplorer.tsx` | Client-local chart, scrubber, selected-dart facts, ranked moments, and Scolia impact synchronization without report navigation or replay |
| `match/HistoricalMatchOverview.tsx` | Completed-match hero, whole-match KPIs, player performance, top visits, and Elo summary |
| `match/EditThrowsModal.tsx` | Edit recorded throws in current leg |
| `match/EditPlayersModal.tsx` | Add/remove/reorder players |
| `match/EloChangesDisplay.tsx` | Elo rating changes after match |
| `games/GameActivityHeatmap.tsx` | GitHub-style daily game activity from September 1, 2026 through today, Monday-first weeks with aligned Mon/Wed/Fri labels, filtered by player search, with selectable dates |
| `games/SelectedPlayerLineup.tsx` | Shared New Match/Tournament avatar lineup with entry bounce, staggered pulse, start-hover hops and shrink/fade exits; selection updates immediately, rapid re-selection cancels removal, and reduced motion skips exit delay; colocated tests cover removal, rapid re-selection, and reduced motion |
| `games/NewGameOptions.tsx` | Party-game picker and per-mode configuration controls, including cyan switch cards for Killer and Around the Clock rules |
| `games/GamePlayerCard.tsx` | Shared X01-style party-game player tiles with current/last-visit darts and mode-specific scores |
| `games/GameHeader.tsx` | Party-game title, status, round, and same-tab spectator navigation |
| `games/GameControls.tsx` | Party-game undo, end confirmation, and rematch controls |
| `games/RematchPanel.tsx` | Shared rematch dialog with location filters, searchable avatar rows, and selected-player chips for scorer and spectator views |
| `games/GameResults.tsx` | Party-game result and rematch display |
| `games/CricketBoard.tsx` | Cricket targets, marks, and points display |
| `games/KillerBoard.tsx` | Killer numbers, lives, and elimination display |
| `games/ShanghaiBoard.tsx` | Shanghai targets, rounds, and scores display |
| `games/ClockBoard.tsx` | Around the Clock progress display |
| `leaderboard/BullersLeaderboard.tsx` | Top 10 Bullers card with average inch-mark distances, sample/miss counts, clear loading/empty/error states and colocated UI tests |
| `leaderboard/GameModeLeaderboardItem.tsx` | Player row for party-mode leaderboard statistics |
| `SiteChrome.tsx` | Shared page shell and a single measured desktop nav underline that slides between links, responds to keyboard focus/resizing, and respects reduced motion |
| `PlayerAvatar.tsx` | Shared avatar rendering; falls back to the player's assigned default goblin icon |
| `PlayerAvatarById.tsx` | Avatar lookup for ID-only rows, with one shared cached player query |
| `Dartboard.tsx` | SVG interactive dartboard (desktop) |
| `MobileKeypad.tsx` | Touch number pad (mobile) |
| `GridLeaderboard.tsx` | Home page leaderboard grid with dark slate table and KPI backgrounds matching game settings and a centered eligibility notice between the filters on the same desktop row; players and their Elo appear after 3 completed X01 matches, excluding early endings |
| `EloLeaderboard.tsx` | 1v1 Elo leaderboard |
| `MultiEloLeaderboard.tsx` | Multiplayer Elo leaderboard |
| `AroundTheWorldGame.tsx` | Around the World game UI |
| `CommentaryDisplay.tsx` | AI commentary text display |
| `CommentarySettings.tsx` | Persona, voice, and audio controls with a visible per-match list of recent completed commentary calls |
| `match/CommentaryQuickToggle.tsx` | Dartboard-card Verse audio toggle with amber connecting ripples, green live breathing glow, accessible status, and reduced-motion support |
| `ScoreProgressChart.tsx` | Score progression chart |
| `TurnsHistoryCard.tsx` | Scrollable turns history for a leg |

### Workers (`src/workers`)
| File | Purpose |
|------|---------|
| `scoliaWorker.test.ts` | Board-status/scoring overlap, ordered completion, status-only retry, and persistence-failure regression tests |
| `scoliaWorker.ts` | Persistent Scolia worker: maintains board WebSockets, persists events/status, queues throw ingestion/recovery, and publishes accepted throws directly to active Realtime commentary sidebands |
| `dartiqLiveWorker.ts` | Browser Web Worker entry point for model construction, live replay, and optional completed-turn commentary facts |

### Services (`src/services`)
| File | Purpose |
|------|---------|
| `commentaryService.ts` | Transitional request-per-turn text commentary client and debounce helper |
| `ttsService.ts` | Transitional buffered MP3 commentary playback fallback |
| `realtimeCommentaryService.ts` | Browser WebRTC audio/data-channel transport, transcript streaming, audio-context unlock, heartbeat, skip, and teardown |
| `scoliaRealtimeCommentaryPublisher.ts` | Worker-side OpenAI sideband connection pool, idempotent delivery/retry with insert-returned delivery rows, background listener cache preparation, and latest-wins response triggering |

### Static Assets (`public`)

| Path | Purpose |
|------|---------|
| `game-icons/*.png` | Glossy 3D artwork for game-mode pickers and the home-page play menu |

### Test Utilities (`src/test-utils`)
| File | Purpose |
|------|---------|
| `factories.ts` | Test data factories: `createMockPlayer`, `createMockMatch`, `createMockLeg`, `createMockTurn`, `createMockThrow`, `createTwoPlayerGameSetup` |
| `mockSupabase.ts` | In-memory mock Supabase client with query builder operating on JS arrays |
| `gameFixtures.ts` | Party-game session, player, and throw factories |
| `gameSupabaseMock.ts` | In-memory Supabase and RPC mock for party-game lifecycle tests |

### Release Tooling
| Path | Purpose |
|------|---------|
| `scripts/supabase-migrations.mjs` | Validates timestamped names, deploys migrations by exact name, verifies production migration history, and prints the bounded rollback SQL for the Slack settings regression with `slack-settings-sql` |
| `scripts/supabase-migrations.test.mjs` | Regression tests for exact-name selection and migration filename policy |
| `supabase/migrations/legacy-numbered-migrations.txt` | Immutable allowlist for the repository's historical numbered migrations |
| `supabase/migrations/20260909140000_bull_off_leaderboard.sql` | RLS-preserving aggregate view over completed bull-offs for non-test players; includes measured rethrows and reports misses separately; matching rollback-only SQL regression |
| `supabase/migrations/20260909120000_x01_bull_off.sql` | Atomic optional Bull-off creation/transitions, immutable per-dart `bull_off_throws` history for future buller leaderboards, service-only event deduplication, scoring/lineup guards and final order handoff; matching rollback-only SQL regression |
| `supabase/migrations/20260908180500_tournament_board_preferences.sql` | Persist tournament board/commentary preferences; matching SQL regression test checks exclusive board assignment and reuse after completion |
| `supabase/migrations/20260904091825_verify_match_creation_and_throw.sql` | Production database smoke migration that verifies `matches.paused_at`, creates an X01 match and throw, then removes its test rows |

## Build, Test, and Development Commands
- `npm run dev`: Start local dev server (Turbopack) at `http://localhost:3000`.
- `npm run build`: Create optimized production build.
- `npm start`: Run the built app in production mode.
- `npm run lint`: Lint with Next.js + ESLint config.
- `npm test`: Run tests in watch mode (interactive).
- `npm run test:run`: Run all tests once (for CI/CD).
- `npm run test:performance`: Run five Lighthouse audits against the production build and enforce the committed median performance budgets.
- `npm run test:ui`: Open visual test interface.
- `npm run test:coverage`: Generate and display coverage report.
- `npm run commentary:demo -- preview|prepare|run <match-id>|cleanup <match-id>`: Preview, provision, play/resume, or safely clean a test-only local synthetic Scolia commentary match. `run` waits for an active browser Realtime listener and skips an already-accepted canonical scenario prefix.
- `npm run test:e2e`: Run Playwright E2E tests (requires test Supabase instance).
- `npm run test:e2e:ui`: Run E2E tests with visual UI.
- `npm run test:e2e:headed`: Run E2E tests in a headed browser.
- `npm run supabase:test:start`: Start test Supabase instance (port 56XXX).
- `npm run supabase:test:stop`: Stop test Supabase instance.
- `npm run supabase:test:reset`: Reset test database.

## Coding Style & Naming Conventions
- **Language**: TypeScript (strict), React 19, Next.js 15.
- **Formatting/Linting**: ESLint (`next/core-web-vitals`, `next/typescript`). Keep imports ordered and unused code removed.
- **Components**: PascalCase files in `src/components` (e.g., `ScoreProgressChart.tsx`).
- **UI Primitives**: lower-kebab files in `src/components/ui` (e.g., `button.tsx`).
- **Utilities**: concise camelCase filenames in `src/utils` (e.g., `eloRating.ts`).
- **Styling**: Tailwind CSS; prefer utility classes over inline styles.
- **Typing**: Avoid using types like Any or Unknown when possible.
- **Next.js**: Prefer Server Components by default; use `"use client"` only when needed (interactivity, hooks, browser APIs).
- **Diffs**: Keep changes small and focused. No new dependencies without asking first.
- **Module cohesion**: Prefer extending an existing, relevant module over introducing another tiny file. Keep closely related helpers and their tests together; do not create one-helper wrappers, barrel files, or abstractions for a single caller without a clear benefit. Add a file when it establishes a meaningful responsibility or reusable boundary, not merely to shorten another file. Avoid unrelated consolidation during feature work.
- **Concurrent work**: Before editing, inspect the current working tree and preserve other agents' changes. Keep infrastructure/performance work separate from commentary wording, pacing, persona, and editorial-policy work when another contributor owns that area. If a shared file must change, limit edits to the relevant methods and re-read it before patching.

## Testing Guidelines

### Unit Tests (Vitest)
- **Framework**: Vitest with TypeScript support, configured in `vitest.config.ts`.
- **Test Files**: Colocate tests with source files using `*.test.ts` or `*.test.tsx` (e.g., `x01.test.ts` next to `x01.ts`).
- **Naming**: Use descriptive test names with `describe()` and `it()` blocks.
- **Coverage**: Aim for high coverage on utility functions (90%+), moderate on components (70%+).
- **Best Practices**:
  - Keep tests deterministic; mock Supabase and network calls.
  - Test edge cases, boundary conditions, and error scenarios.
  - See `src/utils/x01.test.ts` for examples of comprehensive test coverage.
- **Running Tests**: Always run `npm run test:run` before committing to ensure all tests pass.

### E2E Tests (Playwright)
- **Framework**: Playwright, tests live in the `e2e/` directory.
- **Fixtures**: `e2e/fixtures.ts` provides Supabase client and test data helpers.
- **Test Supabase**: E2E tests use a separate Supabase instance (port 56XXX) to avoid conflicts with dev (port 554XX). Start it with `npm run supabase:test:start` before running E2E tests.
- **Running E2E Tests**: `npm run test:e2e` (headless), `npm run test:e2e:headed` (browser visible), `npm run test:e2e:ui` (visual UI).

## Commit & Pull Request Guidelines
- **Commits**: Short, imperative, and focused (e.g., `add elo leaderboard`, `fix build error`).
- **Branches**: `feature/<slug>`, `fix/<slug>`, `chore/<slug>`.
- **PRs**: Include concise description, rationale, screenshots for UI changes, and any Supabase schema notes. Link issues and note breaking changes.
- Ensure `npm run lint` and a successful local run before requesting review.

## Security & Configuration Tips
- Store secrets in `.env.local`; never commit keys. Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Use Supabase RLS; avoid exposing privileged operations to the client.
- Be mindful of client bundles: don’t log secrets and avoid leaking PII.

## Architecture Notes
- Real-time and persistence via Supabase; charts via Highcharts React.
- Core game logic lives in `src/utils` and is shared across app routes and components.

### Key Flows

**Throw recording:**
`handleBoardClick` (useMatchActions) → optimistic local state → `POST /api/matches/:id/throws` → `resolveOrCreateTurnForPlayer` (turnLifecycle.ts) → insert throw → enqueue durable DartIQ live capture → on 3rd dart: `PATCH /api/matches/:id/turns/:id` → if fair ending: `computeFairEndingState` → if resolved: `completeLeg` → Elo RPC + completed-leg DartIQ job. Capture/replay work runs outside the scoring response path.

**Match pause:**
`Pause game` (MatchScoringView) → `PATCH /api/matches/:id/pause` → `matches.paused_at` → existing matches realtime refreshes scoring and spectator clients; throw/turn/leg-completion APIs reject new scoring while paused.

**Spectator realtime:**

Prioritize dart/score paint. Unknown-turn recovery starts immediately, is match-scoped and single-flight per turn, and reapplies intervening throw updates (including impact corrections) over the fetched row. Charts/heatmaps consume deferred inputs. Spectator `useDartIQ` fetches raw frozen evidence without constructing models. `WorkerDartIQLive` sends serializable canonical snapshots to a browser worker, which owns model construction and the correction-safe tracker. Only one calculation and the newest pending snapshot are retained; evidence is sent only on change/restart. Results must match the current input/evidence identity. Failures get one bounded restart, never a synchronous UI-thread fallback. Healthy Scolia commentary skips duplicate browser replay entirely; spectator completed-turn fallback analysis also runs in a worker. These browser workers are unrelated to the persistent Railway Scolia worker.
`useRealtime` subscribes to Supabase channel → dispatches DOM custom events → `useMatchRealtime` listens → `applyThrowChange/applyTurnChange` (spectatorRealtimeReducer) updates state incrementally → on `needsReconcile`: `loadAll()` full refresh.

Each incremental spectator throw updates a correction-safe `DartIQTracker` over canonical match turns. The tracker reuses the verified replay prefix and exposes the exact latest replay state, including the partial visit's true starting score. `DartIQLive` is presentation-only: it renders that shared state rather than independently deriving scores, form, fair-ending context, or probabilities. While the browser worker refreshes, keep the last completed card mounted for the same match/players/evidence so the board below does not jump. Mark it busy and hide on-throw checkout, tension, and next-dart forecasts with layout-preserving visibility; never accept obsolete worker replies as fresh results. The Scolia commentary worker uses the same tracker/prefix owner. The compact header also shows the on-throw player's checkout probability and a provisional calm/live/big/huge tension band driven by exact standard-play pre-dart opportunity.

DartIQ replay evaluates each dart through `evaluateDartSetup()` → uses the same player-specific behavioral visit kernel to estimate checkout probability before/after, the resulting next-visit chance, and the next opponent's fresh-visit checkout danger, while tracking bogey creation/avoidance without inferring aim or grading an imaginary optimal route. A cached all-score first-finish table makes standard-play next-dart enumeration cheap enough to derive opportunity as expected full-vector total variation and direction-aware/magnitude outcome tails; candidate vectors are transient and never retained. Fair-ending matches expose no opportunity until their provisional checkout continuation can be modeled with equal honesty. The live strip reports expected visits remaining—the quantity supported by the visit-indexed PMF—not falsely precise dart counts. Projection approximation modes survive replay into packets and telemetry. These facts flow into compact `DartIQDartPacket` signals and deterministic commentary moments.

The match report reconstructs its DartIQ timeline once on the server. `DartIQReportExplorer` hydrates from the optional `?dart=` selection, then owns chart, scrubber, selected facts, ranked-dart, and Scolia-impact selection locally; interactions do not navigate or trigger another server replay.

**DartIQ personalization:**
Migration `0059_dartiq_evidence.sql` derives finish-rule-specific player/population profiles and behavioral outcome counts from completed, non-test, non-ended X01 history, excluding tiebreak turns. Match creation calls `capture_dartiq_match_evidence()` in the same transaction, freezing those inputs before the first dart. The population snapshot also freezes a bounded generalized `historicalFacts` list for the current participants: one personal record per player and one shared-history record per pair, each with support/confidence and structured scoring, bust, bogey, record, and close-loss evidence. Facts carry the current match's creation-time cutoff separately from the evidence capture timestamp. Direct two-player records stay distinct from multiplayer meetings where someone else won. `useDartIQ()` loads that immutable evidence once → `createDartIQSkillModel()` and `createBehavioralOutcomeModel()` build the live projection inputs. Realtime snapshots render at most twelve named office-lore lines from those facts; raw historical matches never enter the live dart path. This prevents future matches from leaking backward into replay, commentary, or calibration.

**DartIQ calibration evidence:**

`DartIQOutcomeModel.predictLanding` is supplied by a qualified frozen adaptive artifact. The tracker evaluates it once per changed canonical state for the current player, never inside projection outcome enumeration. `selectDartIQNextDartForecast` requires an artifact ID, passed validation, high model confidence, and a finite normalized canonical-segment vector; a high predicted segment probability alone is not confidence. DartIQLive displays up to three landing segments with original probabilities (not renormalized), with no placeholders/warnings while unavailable. Corrections, player changes, and undo refresh it through the existing tracker. Tiebreak/no-dart states suppress forecasts; the UI also suppresses completed matches. Legacy behavioural models supply no landing forecast. `DartIQLive.test.tsx` covers display, absence, and completed-match suppression.

**Automatic model lifecycle:** migration `0065_dartiq_model_training.sql` schedules the separate `dartiq_training` job daily at 02:27 UTC with default pg_cron settings. One snapshot reads 180 days / 400 completed non-test matches / 60 deterministic darts per match, with pre-dart scores reconstructed before sampling. Fitting requires 30 matches / 500 darts. An immutable pending artifact is tested only on matches started after its actual creation time; activation requires another 30 matches / 500 darts. Later artifacts must improve match-balanced next-dart Brier by at least 0.001 without log-loss regression, with supported-player regression checks. First fitted behavioural counts use a same-training-evidence non-regression baseline; this is not proof of improvement over the legacy all-history model. Initial geometry is a 5mm-smoothed empirical landing model above score 170, not latent-aim inference. It contributes 50% of transitions only for player/finish-rule/darts-left keys with 100 training impacts and 100 validation darts across 20 later matches, improving both outcome and segment losses. Other contexts retain behavioural predictions.

`commit_dartiq_training` serializes registry changes with a generation compare-and-swap. A before-insert population-evidence trigger pins the active deployment into `raw_evidence.modelDeployment` only when activation predates match creation; personal counts/geometry are restricted to participants. UI, report, Realtime snapshot, worker replay, and telemetry share `createAdaptiveDartIQModel`. Telemetry versions include trained-artifact identity. Supported post-activation regressions against the predecessor (or same-evidence behavioural baseline for the first artifact) retire the active model for new matches and reject its pending replacement; existing frozen matches do not change. Pending candidates expire after 90 days. Parameter payloads never update, and browser/service direct registry writes are revoked. No fitting or database access occurs inside runtime prediction. Training tests and SQL lifecycle tests cover these boundaries. Preserve the v1 artifact interpreter when adding future training versions.

The separate temperature evaluator follows the first qualifying frozen temperature artifact for each model/evaluator version. Its follow-up uses only matches created strictly after that report was saved; later fits cannot replace it or reuse earlier validation games as fresh evidence. Artifact identity enters report deduplication. These transformed predictions are calculated in the daily job, not emitted live. Temperature reports do not activate models; the trained-outcome lifecycle above owns activation.

Migration `0064_continuous_dartiq_calibration.sql` schedules the separate temperature evaluator daily at 02:17 UTC (default pg_cron timezone). At most four model versions are sampled independently over 90 days / 200 completed non-test matches / 40 deterministic predictions per match. Only active complete live vectors recorded before match completion qualify; reconstruction, correction, superseded, ended-early and future-evidence rows are excluded. The oldest 60% of matches fit a temperature grid, then later-starting matches validate it with match-balanced losses and sample/regression gates. Reports are private and deduplicated by source/configuration. Temperature reports remain observation-only; `0065` owns trained behavioural/spatial activation. Neither loop fits models in scoring or commentary.

DartIQ keeps calibration status, evidence support, and approximation provenance internally; the user prefers a clean live strip and report without calibration disclaimers or thin-evidence warnings. Do not reintroduce those surface disclosures unless requested. Outcome backoff pools are disjoint by global/class/exact state, and population counts exclude overlapping personal observations before applying personal layers. Established outcome support requires exact-state personal samples, not merely a large scoring history. The versioned outcome configuration records this evidence-partition change. Report stolen legs require a low point below `min(20%, 0.4 / playerCount, openingProbability / 2)`; a small opening share in a large field is not a comeback. Weighted tiebreak forecasts retain internal approximation metadata and assign zero to players who cannot physically catch the highest recorded total. Do not market these safeguards or passing unit tests as empirical calibration.
Accepted throws enqueue durable live capture after scoring succeeds; edits and undos enqueue a canonical replay whose active rows are replaced atomically once for the affected leg. Correction-derived rows are labelled `partial/correction_replay`, never passed off as independent live evidence, and prior legs are untouched. Shared `completeLeg()` enqueues reconstruction of the authoritative finished leg for both manual and Scolia matches. Reconstructed rows remain explicitly labelled `not_supported/completed_leg_reconstruction`; only genuine complete live rows can produce exact/diverged parity evidence, while absent or correction-derived live state is reported as missing. `replace_dartiq_leg_projection_events()` takes a transaction-scoped advisory lock, compares the revision content hash, chooses the next monotone revision inside the lock, and atomically writes every dart plus its full per-player probability vector; incomplete or failed replacements roll back without superseding the prior active revision. Tiebreak projections remain calibratable but set `outcome_model_applicable = false` because their darts do not belong to the X01 score-transition outcome model. Browser and Scolia-worker commentary policy evaluations append listener/epoch-scoped rows to `dartiq_commentary_policy_decisions`, recording the policy version, signals, priority, speak/skip result, guarantee/interruption flags, and decision reason. Commentary latency telemetry is intentionally outside this PR.

For manual commentary, `useMatchRealtime` replays the current leg locally → `summarizeDartIQForTurn()` adds exact before/after leg and match probability context to the commentary prompt, including fair-ending and tiebreak visits. Scolia browsers with a healthy Realtime session suppress this completed-turn duplicate because the worker already delivered each accepted dart directly.

Realtime commentary creates a prewarmed, output-only browser-to-GPT-Realtime WebRTC call through the unified server interface. The server retains the OpenAI call ID; the browser receives only the SDP answer, opaque app session ID, commentary epoch, and compact canonical snapshot. A database-backed per-listener claim permits one snapshot-anchored pre-match opener without replaying it across reconnects. Snapshots include frozen historical player and matchup facts plus bounded current-match narrative memory. `storyArcDirector` ranks factual arcs; multiplayer favorite churn is one match-scoped field-carousel story rather than a new player-scoped seesaw on every flip. Listener-local `BroadcastDirector` owns continuity, reserves, callback obligations, payoff/closure, and append-only lifecycle telemetry. The match report independently reconstructs the corrected story timeline. IDs never enter model-facing prose.

After persisting each Scolia detection, the worker overlaps its board-status write with throw ingestion and publishes commentary as soon as scoring succeeds. Both operations settle before the ordered board queue advances; a status-only retry skips an already-processed dart. Other message types retain status-before-processing ordering.

For Scolia matches, the worker publishes each accepted dart directly to the active Realtime sideband using the same correction-safe DartIQ tracker as the UI. Listener reconciliation prepares the same canonical DartIQ replay and frozen models in the background, including before the first dart; missing frozen evidence skips warming. Warm-ups are single-flight per match, never awaited by live delivery, and discarded if a correction, active live work, an existing cache, shutdown, or listener removal makes installation unsafe. Fresh delivery inserts return their status and attempts in the same database response; duplicate deliveries retain the authoritative lookup. Every dart may open a short factual reaction window; policy-approved calls start without an artificial hold. Dart three supplies the completed visit but deliberately does not announce the next player. The worker waits for a real non-false `TAKEOUT_FINISHED`, then always sends authoritative visit-opening context. It requests optional walk-up banter only when no response is generating or playing and at least 2.5 seconds have elapsed since the last call began and 25 seconds since the previous walk-on. This preserves realistic dart-three → removal → handoff → walk-up timing. Corrections reset timing, policy, takeout handoff, and director state. Direct audio has no editorial tool-call hop; the model gets up to four named factual candidates, recent transcript context, and strict no-invention instructions while retaining room for fragments, mild profanity, laughs, groans, and affectionate office-match sass.

The compact speech boundary supplies at most four factual candidate angles and leaves editorial choice and delivery to the Realtime model. The deterministic policy still owns whether speech is allowed, pacing, guarantees, and interruption. Only ordinary calls may decline with no speech when the model finds nothing fresh; marquee and terminal calls remain mandatory. The model's bounded conversation history supplies repetition context without a second transcript payload.

The completed visit is an important commentary unit, not a barrier. Back-to-back T20s, trebles, doubles, misses, newly created or unconverted one-dart finishes, and low early-visit darts can open short live reactions. Probability trend arcs still use completed-visit checkpoints so dart-level flicker cannot fabricate a comeback, collapse, seesaw, or dominance story. Scolia next-player banter is withheld until physical takeout completion; manual matches, which have no hardware takeout signal, may tee up the next player from the completed turn. Default cooldowns are deliberately loose (1.2 s ordinary, 0.6 s notable, none for marquee), ordinary calls have no artificial hold, and Chad treats long low-level single-leg office play as affectionate factual comedy.

**Fair ending:**
First player checks out → DartIQ v2 marks the checkout provisional and projects the remaining players' chances to join → remaining players complete their turns → if single checkout: leg resolves → if multiple checkouts: eligible players enter high-round tiebreaks. Tiebreak darts update deterministic, normalized probabilities without changing X01 scores; tied leaders advance to the next round. Only authoritative resolution emits `leg_win`/`match_win`.

**Party-game UI:**
Scoring and spectator views share X01-style player tiles with lime on-throw state, per-mode targets, and current/last-turn darts. Manual scoring offers keypad and dartboard input beside the scoreboard on desktop and before it on mobile. Spectator navigation stays in the same tab. Ended sessions suppress active-player hints and scoring controls; marks and round tables scroll within their panel.

**Party-game scoring:**
New Game selects Cricket, Killer, Shanghai, or Around the World → `POST /api/games` creates the session and ordered players through `create_game_session_atomic` → `GameClient` replays `game_throws` through the selected pure engine → `useGameActions` queues manual input through `POST /api/games/:id/throws` → `append_game_throw_atomic` locks the session and commits the throw with any completion → `undo_last_game_throw_atomic` deletes the latest dart and reopens a completed session when board ownership still permits it → `useGameData` reconciles session and throw changes through Supabase realtime.

**Scolia board connectivity:**

Migration `0062_scolia_worker_notifications.sql` publishes private work tables for service-role Realtime wake-ups, with 15-second reconciliation polls and command acknowledgement timers. `WorkerNotifications` coalesces commands by board and commentary by session, ignores repeated heartbeat-only updates and delivery-attempt updates, and requests full reconciliation on reconnect. Dart registration still arrives over the Scolia WebSocket. `OrderedWorkQueue` retries a failed scoring event before later events; a separate queue isolates commentary delivery. Publisher recovery batches session lookups and runs up to four independent matches concurrently while preserving per-match ordering across live darts, retry delivery, prewarming, and takeout. Delayed commentary uses facts only through its source dart and skips obsolete speech/handoffs. Provider create rejections are correlated by event ID, and a bounded response watchdog recovers a stuck transport.

Migration `0063_worker_snapshots.sql` provides service-only, statement-consistent scoring/telemetry snapshot RPCs. Scoring keeps fresh post-insert reads; ordinary settlement loads only the actor's turns, while fair ending loads the whole field. Source-row triggers invalidate telemetry revisions for throws, turns, legs, match configuration, player ordering, and frozen evidence (including deletes/reparenting). A request-scoped `DartIQTelemetryBatch` receives only the revision when unchanged; changed snapshots still download canonical history and reuse verified replay checkpoints when configuration/evidence permits. Corrections fall back to canonical reconstruction. Deploy both migrations before this version of the app/worker; do not replace revision checks with unchecked cross-request caching.
`npm run scolia:worker` → REST discovery of account boards → one Scolia cloud WebSocket per serial → serialize and deduplicate incoming messages → persist raw `scolia_events` + current `scolia_boards` status → retry pending/failed detections → resolve the board to an active X01 match or party game → dispatch to `ingestScoliaThrowEvent` or `ingestGameThrow` → existing mode-specific completion and Supabase realtime flows apply. `throws.scolia_event_id` and `game_throws.scolia_event_id` enforce exactly-once scoring across reconnects.

Current-round app undo/edit → match throw API mutates and recomputes app state → `enqueueCurrentRoundScoliaThrowCommand` skips manual or already-taken-out darts and creates `scolia_commands` → worker sends `DELETE_THROW`/`THROW_CORRECTED` on the owning board socket → `ACKNOWLEDGED`/`REFUSED` updates command status.

**Scolia match assignment:**
New Game and Boards load one API snapshot → `scolia_board_public_status` Postgres Realtime updates runtime status immediately while match and game-session events refresh occupancy → reconnects reconcile from the API and a local heartbeat-expiry timer detects silent worker loss. The user selects manual scoring or a connected, ready, unused board → the creation API revalidates availability → persists the board on `matches` or `game_sessions`. Database constraints and triggers permit only one active scoring target per physical board.

Scolia matches replace the manual keypad/dartboard with a hardware-scoring notice, and manual throw POSTs are rejected server-side. Rematch revalidates and carries the same ready board; database enforcement rejects a concurrent claim.

Scolia spectator loads include throw geometry across every leg for per-player whole-match heatmaps. The current leg's realtime turns override that initial all-leg snapshot so new, edited, and deleted impacts update live without another subscription.

**Completed match history:**
Recent Games card → `/match/:id?spectator=true&history=true` → spectator data load includes every leg and Scolia throw geometry → read-only result hero, whole-match KPIs/player performance/top visits, final-leg score progression, Elo changes, and whole-match heatmaps. Live-only board status, QR code, current-player state, commentary, and winner popup are suppressed.

**Slack dart poll:**
`/dart [HH:MM|now] [201|301|501] [legs] [single|double]` → signed `POST /api/slack/darts` → insert poll and its `background_jobs` row atomically → publish an I'm down / Not this time Block Kit poll → signed button actions upsert one vote per Slack user → one Supabase Cron job checks for due work every five seconds → `dispatch_due_background_jobs()` atomically claims a batch and makes no HTTP request for an empty batch → authenticated `POST /api/background-jobs` dispatches `slack_dart_poll` → fewer than two Yes votes cancel; otherwise `claim_slack_player_atomic` resolves or creates each stable Slack identity without exposing a half-created player → `create_slack_x01_match_atomic` creates a manual match using the stored poll settings → Slack message links to scoring and spectator mode. Self-service claims use the same RPC; admin replacements use `set_slack_player_link_atomic`, so link changes roll back together. See `docs/SLACK_DARTS.md` for setup and Vault configuration.

**Production release gate:**
Pull request or merge queue → `Tests / test` validates migration filenames, runs lint, unit tests, a production build, and five Lighthouse samples of the real home page through a loopback-only CI auth bypass → GitHub branch protection permits merge only after success. Before releasing Slack poll settings, run the output of `node scripts/supabase-migrations.mjs slack-settings-sql` in the Supabase SQL Editor, deploy the migration, then rerun with `--installed`. These bounded rollback checks exercise service-role match creation without leaving fixtures. On a push to `main`, the Supabase workflow deploys every migration after the exact `0055_game_sessions` baseline by full migration name. The timestamped production smoke migration is recorded only after it verifies `matches.paused_at`, creates an X01 match and throw, and removes its test rows. `Tests / test` waits for that exact production history before Vercel Deployment Checks can promote the commit.

Outbound commands transition `pending` → `sent` → `acknowledged`/`refused`. A missing acknowledgement resets a stale command for retry; after three attempts it becomes `failed`. Deploy `Dockerfile.scolia-worker` as exactly one always-on worker replica outside Vercel.

## Supabase Migration Rule

Local development recovery (2026-09-07): `supabase_db_dart-highsoft` had legacy Pressure/commentary migrations occupying versions `0055`–`0059`. Those history rows were preserved; current files were backfilled and recorded by full filename, source SHA-256, actual executed SQL, and compatibility notes in the private `supabase_migrations.local_reconciled_migrations` table. Existing rematch and commentary objects were retained and brought up to the current shape. Check this ledger as well as `schema_migrations` before rerunning migrations on this local instance. The repository still contains duplicate numeric prefixes (`0055`, `0059`); a clean CLI/deployment migration-history reconciliation remains separate work. Never assume this local recovery was applied to production. Pre-recovery backup: `/private/tmp/dart-highsoft-before-migrations-20260907.dump`.

- Do not use `ALTER FUNCTION` in Supabase migrations. For function changes, use drop + recreate.
- Existing Supabase migration files are immutable except under the failed, unapplied migration recovery procedure below.
- Changes to applied migrations require a new migration that supersedes them. New schema/function/policy work also requires a new migration.
- Name every new migration with a unique 14-digit UTC timestamp: `YYYYMMDDHHMMSS_description.sql`. The numbered migrations in `legacy-numbered-migrations.txt` are the only exceptions.
- Migration deployment and verification track the complete migration name, never only its numeric or timestamp prefix.

### Failed, unapplied migration recovery

Within an already authorized deployment, an agent may correct a failed migration in place, including after commit or merge, when all of these conditions hold. This procedure supplies the exception; do not request another policy waiver once the evidence is complete.

1. Identify every retained database that could have received the migration. Verify the complete name is absent from each migration history, and check manual application records and reconciliation ledgers, including `local_reconciled_migrations` where present. A recorded no-op counts as applied. Disposable test databases may be recreated; never reset a retained database to qualify for this exception.
2. Confirm the failed attempt fully rolled back by checking its transaction boundaries, failure output, and affected schema/data. Missing history alone does not prove rollback. Resolve partial writes or uncertain application state before considering an edit.
3. Limit the correction to the original migration's intended behavior. Preserve its filename, timestamp, identity/data guards, and history. Reproduce the failure with the relevant real constraints, then verify the corrected SQL, data preservation, and retry behavior in disposable PostgreSQL.
4. Record the failed run, original commit, databases checked, rollback evidence, correction, and test results in the corrective PR or durable deployment notes. Commit the correction as a new commit; do not rewrite merged Git history.
5. Recheck history before retrying through the serialized deployment workflow at the corrected commit. Verify the complete migration history, affected data, and required release checks before reporting success. See [DEPLOYMENT.md](DEPLOYMENT.md#recover-a-failed-unapplied-migration).

If any retained database applied the migration, keep its file unchanged and plan a forward recovery with a new timestamped migration. If evidence is missing, continue read-only investigation and local reproduction; do not assume the exception applies. Never delete history rows, mark failed SQL as applied, disable constraints, or bypass release checks to unblock deployment. This exception does not authorize additional data changes or a deployment outside the user's existing request.

## Boundaries / Do Not Touch
- `.env*` files, secrets, production credentials.
- Existing migration files in `supabase/migrations/`, except through the failed, unapplied migration recovery procedure above. Applied migrations remain immutable.
- `package-lock.json` unless dependency changes are required.
- Generated artifacts (`coverage/`, `playwright-report/`, `.next/`, `node_modules/`).

## When You're Done
- `npm run lint` passes.
- `npm run build` succeeds.
- `npm run test:run` passes (add/update tests for behavior changes).
- Summarize what changed and how to verify locally.

Realtime speech uses `broadcast-2` policy: routine darts preserve active lines; significant notable swings, busts, and finish chances may interrupt equal/lower-priority speech, while marquee/terminal guarantees remain immediate. Only the newest replacement survives provider cancellation; routine skipped calls are never queued. Browser and worker release the speech policy after `output_audio_buffer.stopped`/`cleared`, not merely `response.done`. Per-call delivery follows the moment rather than event-ID hashing; callbacks may develop earlier jokes from newly supplied facts.

Realtime factual candidates reserve an early slot for a checkout compared with the player’s frozen pre-match best (including novice finishes below 100), a first-nine comparison against supported personal history, or relevant shared history when a bust/finish setup leaves an opponent in range. Comparisons explicitly remain pre-match facts; multiplayer meetings retain other winners and are not rendered as head-to-head records. Underdog arcs scale their initial-probability threshold by field size.

Realtime `response.create.instructions` overrides the session prompt. Opening, handoff, and dart-call builders therefore carry the complete shared persona/factual/continuity contract followed by the compact current-call brief. Chad favors audible grunts/groans/laughs, short roasts and abrupt energy shifts; no coaching or motivational follow-up.

Walk-ons name the incoming player and remaining score after takeout, without interrupting generation or playback. Their 25-second spacing is independent of dart reactions; a 2.5-second gap from the latest call permits natural takeout timing. Between-dart briefs favor performed sounds or single words (0–2 words); completed visits retain room for meaningful remaining-score context.

After a real takeout, Scolia may offer one optional pause reaction if no dart arrives for 20 seconds (at most one idle call per minute). A new dart, correction, teardown, or fresh takeout invalidates that timer, including in-flight database checks. The worker verifies the match/listener remain active and speech is idle before sending; it never queues or interrupts for a pause nudge. The voice may wonder aloud, but invents no off-board whereabouts. Walk-ons permit affectionate ridicule, while emotional escalation follows actual match events.

Each match snapshot includes one explicitly fictional commentator starting premise, selected deterministically from the match ID by `commentaryStartingMood()` in `personas.ts`. It remains stable across listeners, reconnects and correction epochs. Shared response instructions let the mood develop through actual game events and prior conversation, without repeating the premise or inventing facts about players. No additional database fields or model calls are required.

Rivalry commentary uses `selectCommentaryRivalry` in `commentaryNarrative.ts` over frozen supported history or a verified rematch. `RivalryDirector` in `broadcastDirector.ts` keeps one selected pair across quiet visits, with one establishment, two ordinary developments, up to six developments only when further reversals or match opportunities earn them, and an authoritative match-result ending. `RealtimeNarrativeWireState` adapts worker darts and browser completed visits to the same director and renders compact named briefs. Rivalry developments use existing speech slots; promoted live stories retain priority. Rivalry match-dart anticipation uses the actual post-dart one-dart route with darts still in hand, suppresses fair-ending and leg-only claims, speaks in 2–6 words, and expires on the very next dart. The completed opening line is retained separately from the latest callback so the commentator can own earlier misplaced confidence. Callback excerpts require successful audio generation AND the matching playback-stopped event; cleared, failed, cancelled, old-epoch, and text-only responses cannot establish heard history. Corrections reset the thread and delivery memory; reconnects use self-contained developments rather than repeating setup. Direct records never advance from multiplayer results, and fair-ending checkouts or leg-only wins never resolve a match rivalry. The local `commentary:demo prepare` freezes explicitly synthetic Ada/Ben history for its new test-only players, with Ada ending Ben’s three-shared-win run on D16.

**Quick rematch:** `components/games/RematchPanel.tsx` offers same or edited players after X01 and game-session completion in scorer and spectator views. Player creation uses the existing players API; rematch routes validate optional player IDs with `lib/server/rematchPlayers.ts` and preserve source settings and board checks. Tournament X01 matches retain bracket navigation. Mobile UI reference: `docs/images/rematch-player-picker.png`.

`20260909071500_sync_slack_player_names.sql` adds the service-only, team-scoped name sync RPC used by Slack imports. Renames preserve player IDs, history, existing nicknames, and inactive status.

`20260909071600_consolidate_mustapha_player.sql` retains the confirmed original player and its history, moves the Slack identity, preserves nicknames, and renames and deactivates the unused imported duplicate before reusing its name. The regression requires the real unique display-name constraint and checks retry rejection plus rollback when the duplicate has history. It aborts if the duplicate has acquired referenced data. SQL regression coverage lives in the matching `supabase/tests/20260909071500_sync_slack_player_names.sql` and `20260909071600_consolidate_mustapha_player.sql` files.


**Bull-off:** New X01's optional saved Bull-off switch sits below Fair ending. `create_bull_off_match_atomic` wraps ordinary atomic creation, preserving default-off callers. `matches.bull_off` carries the correction/concurrency revision, pending players, per-round measurements and derived phase. Each player throws one dart, then removes it; manual scoring records measured inches/mm or a miss, while Scolia stores the radial impact distance and `TAKEOUT_FINISHED` advances the player. At 0.1 mm precision, ties at any rank repeat only among the tied players and earlier rounds keep all other positions locked. The last takeout atomically commits `match_players.play_order` and the first leg's starter. Turns and lineup changes are blocked during the bull-off. Realtime match updates drive the provisional ranked cards, impact/reorder animation and a common-scale distance ruler; pending/rethrow cards stay muted. Browser commentary uses measured bull-off briefs, retains its WebRTC session across the view handoff, and gives one short game-opening hype call using the confirmed starter/rules after the spectator view is ready. An early X01 dart suppresses a stale opening. MatchClient regression tests delay realtime reloads and cover unchanged connections, ordering, full starting scores and an early scoring dart. Rematches preserve the option.

Every attempt, including misses and tie rethrows, is also stored with player/match/round, distance, timestamp and optional Scolia event in `bull_off_throws`, for the dedicated Top 10 Bullers leaderboard. `bull_off_leaderboard` averages measured distances across completed bull-offs, including rethrows, converts mm to inches without rounding the ranking, and excludes test players and players with no measured darts. Misses have no measured distance, so they are counted separately rather than included in the average; measured sample sizes are visible. Ties in the average sort by more measured darts, name, then player ID. Deploy `20260909140000_bull_off_leaderboard` before serving the new leaderboard card. These rows never enter `throws`/`turns`, X01 averages, checkout figures, Elo, heatmaps or DartIQ scoring replay. Deploy `20260909120000_x01_bull_off` before the app and Scolia worker; no production migration was applied as part of implementation.
