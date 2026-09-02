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
- `src/test-utils`: Test factories, mock Supabase client.
- `public`/`favicon`: Static assets.
- `e2e`: Playwright E2E tests and fixtures.
- `supabase`: SQL migrations and local config.
- `supabase-test`: Separate Supabase config for E2E tests (port 56XXX).
- `DEPLOYMENT.md`: Beginner-friendly production deployment guide for Vercel + Supabase.
- `PRESSURE_ENGINE.md`: Product and modeling roadmap for live probability, WPA, leverage, and pressure analytics.
- `Dockerfile.scolia-worker`: Production container for the separate persistent Scolia worker.
- `railway.json`: Railway config-as-code for the single-replica Scolia worker service.
- `docs/SCOLIA_SOCIAL_API.md`: Markdown reference for the complete Scolia Social API v1.2 protocol.

## File Map

### Pages (`src/app`)
| Path | Purpose |
|------|---------|
| `page.tsx` | Home — leaderboard grid, nav to new match/practice/players |
| `new/page.tsx` | New match creation form with optional ready Scolia board selection |
| `match/[id]/page.tsx` | Match page (server component) |
| `match/[id]/MatchClient.tsx` | Main match client — orchestrates all hooks, switches scoring/spectator view |
| `games/page.tsx` | Recent games listing |
| `players/page.tsx` | Player management (list, create, toggle active) |
| `boards/page.tsx` | Scolia board management (connectivity, availability, active-match links, connect/disconnect) |
| `stats/page.tsx` | Stats and leaderboards |
| `leaderboards/page.tsx` | Detailed leaderboards |
| `elo-multi/page.tsx` | Multiplayer Elo leaderboard |
| `practice/page.tsx` | Practice mode (select player) |
| `practice/[playerId]/page.tsx` | Practice session for a player |

### API Routes (`src/app/api`)
| Route | Methods | Purpose |
|-------|---------|---------|
| `matches/` | POST | Create a new match |
| `matches/[matchId]/` | DELETE | Passcode-protected permanent deletion of a standalone match and its dependent game data |
| `matches/[matchId]/throws/` | POST, DELETE | Record or delete a dart throw |
| `matches/[matchId]/throws/[throwId]/` | PATCH, DELETE | Edit or delete a specific throw |
| `matches/[matchId]/turns/` | POST | Create a turn |
| `matches/[matchId]/turns/[turnId]/` | PATCH, DELETE | Finish a turn (score, bust); auto-resolves leg on fair ending |
| `matches/[matchId]/legs/[legId]/complete/` | POST | Complete a leg (set winner, create next leg or finalize match + Elo) |
| `matches/[matchId]/end/` | PATCH | End match early |
| `matches/[matchId]/rematch/` | POST | Create a rematch |
| `matches/[matchId]/players/` | POST | Add player to match |
| `matches/[matchId]/players/new/` | POST | Create new player and add to match |
| `matches/[matchId]/players/[playerId]/` | DELETE | Remove player from match |
| `matches/[matchId]/players/reorder/` | PATCH | Reorder players |
| `elo/update/` | POST | Update 1v1 Elo ratings |
| `elo-multi/update/` | POST | Update multiplayer Elo ratings |
| `players/` | GET, POST | List or create players |
| `scolia/boards/` | GET, PUT | List/connect Scolia boards and merge worker plus active-match status |
| `scolia/boards/available/` | GET | List safe board status and availability for match selection |
| `scolia/boards/[serialNumber]/` | DELETE | Disconnect a board from the Scolia service account |
| `practice/sessions/` | POST | Create practice session |
| `practice/sessions/[id]/end/` | PATCH | End practice session |
| `practice/sessions/[id]/throws/` | POST | Record practice throw |
| `around-world/sessions/` | POST | Create Around the World session |
| `commentary/` | POST | Generate AI commentary via LLM |
| `commentary/realtime/session/` | POST, PUT, PATCH, DELETE | Create an output-only OpenAI Realtime WebRTC call, advance its correction epoch with a replacement snapshot, heartbeat it, or close it |
| `tts/` | POST | Text-to-speech for commentary |

### Utils (`src/utils`) — Pure Business Logic
| File | Purpose |
|------|---------|
| `x01.ts` | Core X01 game engine: `applyThrow()`, `calculate3DartAverage()` |
| `fairEnding.ts` | Fair ending state machine plus current-phase pending-player selection for incremental Pressure projections |
| `dartboard.ts` | Dartboard geometry: `computeHit()` from SVG coordinates, `segmentFromSelection()` |
| `eloRating.ts` | 1v1 Elo: `calculateNewEloRatings()`, leaderboard/stats queries |
| `eloRatingMultiplayer.ts` | Multiplayer Elo: `updateMatchEloRatingsMultiplayer()`, stats queries |
| `checkoutSuggestions.ts` | DFS checkout combinations for a remaining score |
| `checkoutTable.ts` | Pre-computed double-out checkout lookup table |
| `legScoreCalculator.ts` | Calculate remaining scores from turns/throws |
| `matchStats.ts` | Live spectator scores, round stats |
| `nikitaSpecial.ts` | Exact order-independent detector for the marquee 1 + 5 + 20 visit |
| `pressureEngine.ts` | Deterministic live leg/match win probability, expected darts, leverage, and bounded fair-ending/tiebreak projections |
| `pressureCheckout.ts` | Deterministic checkout probability, counterfactual setup quality, and generic bogey-leave evaluation |
| `pressureProfiles.ts` | Hierarchical personal → installation population → fallback model shrinkage for historical player strength |
| `pressureReplay.ts` | Single-pass X01/fair-ending/tiebreak dart replay producing versioned before/after probability events, WPA, and leverage |
| `pressureInsights.ts` | One-pass classifier for turning points, lead changes, stolen/thrown-away legs, and commentary moments |
| `pressureEvents.ts` | Compact provider-neutral per-dart packets, signals, and latest-wins commentary priority classification |
| `haptics.ts` | Mobile haptic feedback via `navigator.vibrate` |

### Hooks (`src/hooks`)
| File | Purpose |
|------|---------|
| `useMatchData.ts` | All match state loading: `loadAll()`, `loadAllSpectator()`, per-entity loaders |
| `useMatchActions.ts` | Player actions: `handleBoardClick`, `undoLastThrow`, `endLegAndMaybeMatch`, rematch, player management. Serializes concurrent throws via queue. |
| `useMatchRealtime.ts` | Connects Supabase realtime events to state; uses spectator reducer for incremental updates |
| `useRealtime.ts` | Low-level Supabase channel subscription, DOM custom events, connection lifecycle |
| `useCommentary.ts` | Commentary feature state, persona selection, TTS, localStorage persistence, and capped per-match completed-call history |
| `useRealtimeCommentary.ts` | Owns the persistent output-only browser WebRTC commentary connection and fallback lifecycle |
| `useMatchEloChanges.ts` | Fetches Elo changes after match completion |
| `useScoliaBoardRealtime.ts` | Pushes sanitized board status and match-occupancy changes into board UIs |
| `usePressureProfiles.ts` | Fetches and caches compact finish-rule-specific personal/population Pressure profiles once per match player set |

### Lib (`src/lib`)
| Path | Purpose |
|------|---------|
| `match/types.ts` | Core types: `Player`, `MatchRecord`, `LegRecord`, `TurnRecord`, `ThrowRecord` |
| `match/selectors.ts` | Pure selectors: `selectCurrentPlayer`, `selectPlayerStats`, `canEditPlayers`, etc. |
| `match/loadMatchData.ts` | Parallel fetch of match + players + legs + turns from Supabase |
| `match/realtime.ts` | `PendingThrowBuffer`, realtime payload helpers |
| `match/spectatorRealtimeReducer.ts` | Pure reducer for spectator state from realtime events |
| `server/matchGuards.ts` | API route guards: `loadMatch()`, `isMatchActive()` |
| `server/completeLeg.ts` | Idempotent leg completion: winner, next leg creation, Elo RPC |
| `server/turnLifecycle.ts` | Race-tolerant turn creation, `resolveOrCreateTurnForPlayer()` |
| `server/recomputeLegTurns.ts` | Recomputes turn scores from raw throws after edits |
| `server/scoliaCommands.ts` | Enqueues current-round Scolia correction/deletion notifications for the worker WebSocket |
| `server/scoliaThrowIngestion.ts` | Idempotently maps persisted Scolia detections into the active app match and completes turns/legs |
| `commentary/personas.ts` | AI commentary persona definitions |
| `commentary/promptBuilder.ts` | Builds LLM prompts from game context |
| `commentary/realtimePrompt.ts` | Builds compact labeled Realtime session prompts and per-call briefs |
| `commentary/commentaryPolicy.ts` | Listener-local deterministic speech policy: cooldowns, observation memory, completed-visit editorial scope, guaranteed calls, and latest-wins interruption |
| `commentary/commentaryVisitTiming.ts` | Shared browser/worker visit-gap coordinator: holds ordinary calls briefly, suppresses stale pending speech, and keeps marquee calls immediate |
| `commentary/commentaryNarrative.ts` | Builds bounded factual story memory from Pressure replay: tendencies, checkout/double history, biggest swing, rematch stakes, and baseline performance |
| `commentary/storyArcDirector.ts` | Scores competing factual match arcs, selects one broadcast angle, and assigns analysis/sass/callback/closing treatment |
| `commentary/broadcastDirector.ts` | Stateful listener-local producer: arc hysteresis, reserve stories, editorial budgets, callback obligations, and required payoff/closure direction |
| `commentary/commentaryDemoScenario.ts` | Deterministic valid 301 double-out broadcast demo: Nikita special, opposing 180, comeback, missed double, and bull-checkout payoff |
| `commentary/realtimeTypes.ts` | Shared Realtime session/correction-envelope contracts, model default, UUID validation, and legacy-to-Realtime voice mapping |
| `commentary/realtimeSnapshot.ts` | Builds compact authoritative match snapshots for new, reconnected, and rotated Realtime sessions |
| `commentary/scoliaRealtimeEvent.ts` | Loads an accepted Scolia throw from canonical rows, attaches its deterministic Pressure packet, and classifies speech priority without waiting for Supabase Realtime |
| `commentary/transcriptLog.ts` | Pure completed-call transcript append, consecutive-deduplication, and bounded-history helper |
| `supabaseClient.ts` | Browser-side Supabase client (cached) |
| `supabaseServer.ts` | Server-side Supabase client (API routes) |
| `apiClient.ts` | Typed fetch wrapper: `apiRequest<T>()` |
| `scolia/access.ts` | Development-only board-management guard pending production admin auth |
| `scolia/availability.ts` | Pure live-heartbeat and ready-state checks for match assignment |
| `scolia/client.ts` | Server-only Scolia REST client for board registration |
| `scolia/commandRecovery.ts` | Pure acknowledgement timeout and bounded-retry policy for outbound board commands |
| `scolia/protocol.ts` | Pure Scolia message/throw parsing, board-state mapping, and reconnect timing |
| `scolia/types.ts` | Shared Scolia board response types |

### Components (`src/components`)
| File | Purpose |
|------|---------|
| `match/MatchScoringView.tsx` | Active scoring view — scores, dartboard/keypad, actions |
| `match/MatchSpectatorView.tsx` | Read-only spectator view |
| `match/PressureWinProbability.tsx` | Pressure Engine broadcast strip with per-dart leg/match win probabilities and a current-player-centered circular rail for large fields |
| `match/MatchPlayersCard.tsx` | Player list with scores, averages, legs won |
| `match/LiveScoliaBoard.tsx` | Read-only spectator dartboard with live Scolia impact positions and detected dart orientation |
| `match/ScoliaMatchHeatmaps.tsx` | Whole-match per-player Scolia impact density boards for spectator mode |
| `match/EditThrowsModal.tsx` | Edit recorded throws in current leg |
| `match/EditPlayersModal.tsx` | Add/remove/reorder players |
| `match/EloChangesDisplay.tsx` | Elo rating changes after match |
| `Dartboard.tsx` | SVG interactive dartboard (desktop) |
| `MobileKeypad.tsx` | Touch number pad (mobile) |
| `GridLeaderboard.tsx` | Home page leaderboard grid |
| `EloLeaderboard.tsx` | 1v1 Elo leaderboard |
| `MultiEloLeaderboard.tsx` | Multiplayer Elo leaderboard |
| `AroundTheWorldGame.tsx` | Around the World game UI |
| `CommentaryDisplay.tsx` | AI commentary text display |
| `CommentarySettings.tsx` | Persona, voice, and audio controls with a visible per-match list of recent completed commentary calls |
| `ScoreProgressChart.tsx` | Score progression chart |
| `TurnsHistoryCard.tsx` | Scrollable turns history for a leg |

### Workers (`src/workers`)
| File | Purpose |
|------|---------|
| `scoliaWorker.ts` | Persistent Scolia worker: maintains board WebSockets, persists events/status, queues throw ingestion/recovery, and publishes accepted throws directly to active Realtime commentary sidebands |

### Services (`src/services`)
| File | Purpose |
|------|---------|
| `commentaryService.ts` | Transitional request-per-turn text commentary client and debounce helper |
| `ttsService.ts` | Transitional buffered MP3 commentary playback fallback |
| `realtimeCommentaryService.ts` | Browser WebRTC audio/data-channel transport, transcript streaming, audio-context unlock, heartbeat, skip, and teardown |
| `scoliaRealtimeCommentaryPublisher.ts` | Worker-side OpenAI sideband connection pool, idempotent delivery/retry, and latest-wins response triggering |

### Test Utilities (`src/test-utils`)
| File | Purpose |
|------|---------|
| `factories.ts` | Test data factories: `createMockPlayer`, `createMockMatch`, `createMockLeg`, `createMockTurn`, `createMockThrow`, `createTwoPlayerGameSetup` |
| `mockSupabase.ts` | In-memory mock Supabase client with query builder operating on JS arrays |

## Build, Test, and Development Commands
- `npm run dev`: Start local dev server (Turbopack) at `http://localhost:3000`.
- `npm run build`: Create optimized production build.
- `npm start`: Run the built app in production mode.
- `npm run lint`: Lint with Next.js + ESLint config.
- `npm test`: Run tests in watch mode (interactive).
- `npm run test:run`: Run all tests once (for CI/CD).
- `npm run test:ui`: Open visual test interface.
- `npm run test:coverage`: Generate and display coverage report.
- `npm run commentary:demo -- preview|prepare|run <match-id>|cleanup <match-id>`: Preview, provision, play, or safely clean a test-only local synthetic Scolia commentary match. `run` waits for an active browser Realtime listener before injection.
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
`handleBoardClick` (useMatchActions) → optimistic local state → `POST /api/matches/:id/throws` → `resolveOrCreateTurnForPlayer` (turnLifecycle.ts) → insert throw → on 3rd dart: `PATCH /api/matches/:id/turns/:id` → if fair ending: `computeFairEndingState` → if resolved: `completeLeg` → Elo RPC.

**Spectator realtime:**
`useRealtime` subscribes to Supabase channel → dispatches DOM custom events → `useMatchRealtime` listens → `applyThrowChange/applyTurnChange` (spectatorRealtimeReducer) updates state incrementally → on `needsReconcile`: `loadAll()` full refresh.

Each incremental spectator throw also re-derives the current Pressure Engine snapshot in `PressureWinProbability` → `calculatePressureProjection()` blends live form with a league baseline and estimates leg/match win probability plus expected darts remaining without additional network requests. Fair-ending checkout-waiting and high-round tiebreak states use the same bounded deterministic projection as replay. The compact header also derives the on-throw player's prospective pressure index and exact-route checkout probability without increasing the player rail height.

Historical pressure replay evaluates each dart through `evaluateDartSetup()` → estimates checkout probability before/after, compares the resulting leave against every legal non-busting segment, grades setup quality, and flags bogey creation/avoidance. These facts flow into compact `PressureDartPacket` signals and deterministic commentary moments.

**Pressure personalization:**
Migrations `0055`/`0056` expose small `player_pressure_profiles` and `pressure_population_profiles` aggregates from completed, non-test, non-ended X01 matches, excluding tiebreak turns. `usePressureProfiles()` fetches both finish-rule-specific datasets in parallel and caches them by player set → `createPressureSkillModel()` applies player → installation population → conservative fallback shrinkage → the live projection and replay use the resulting scoring average, checkout conversion, and bust tendency. Current-match form is blended on top. Raw historical throws are never loaded into the spectator per-dart path.

For manual commentary, `useMatchRealtime` replays the current leg locally → `summarizePressureForTurn()` adds exact before/after leg and match probability context to the commentary prompt, including fair-ending and tiebreak visits. Scolia browsers with a healthy Realtime session suppress this completed-turn duplicate because the worker already delivered each accepted dart directly.

Realtime commentary now creates a prewarmed, output-only browser-to-GPT-Realtime WebRTC call through the unified server interface. The server retains the returned OpenAI call ID in `commentary_realtime_sessions`; only the SDP answer, opaque app session ID, current commentary epoch, and compact canonical snapshot return to the browser. Opening/reconnect/correction snapshots include shrunk historical Pressure baselines for every player plus bounded current-match narrative memory. `commentaryNarrative` derives recurring tendencies, exact-double non-conversions, checkout-pressure history, biggest match WPA swing, and live performance versus baseline; `matches.rematch_of_match_id` supplies explicit revenge/rematch lineage rather than player-list guessing. `storyArcDirector` ranks comeback, collapse, underdog, seesaw, punished-miss, checkout-duel, pressure-resilience, revenge, and dominance candidates. Listener-local `BroadcastDirector` commits to one primary arc, retains two background candidates, prevents weak one-dart story switches, keeps phases monotonic, budgets introductions, creates explicit future callback obligations, and requires either payoff or closure when the supplied result resolves the story. Only new, switched, or resolving stories promote routine context to notable speech. Scolia sessions are seeded by the worker sideband before dart deltas; manual sessions seed through the browser data channel. Browser failures reconnect with bounded backoff, and healthy sessions rotate at 50 minutes before the provider's 60-minute limit. For Scolia matches, including fair-ending and tiebreak play, the worker calls `scoliaRealtimeCommentaryPublisher` immediately after `ingestScoliaThrowEvent()` returns `processed`: it reloads the accepted dart's canonical facts and injects the Pressure v2 packet plus refreshed narrative memory through an authenticated sideband WebSocket to the same call. The first dart cold-loads canonical full-match history/profiles; subsequent ordered darts append to an in-memory worker cache and reuse the verified Pressure prefix, with canonical rebuild on restart, leg change, correction epoch, or ordering drift. This bypasses the Supabase Realtime notification round trip and repeated history/profile queries. `commentary_realtime_deliveries` deduplicates and retries per listener/throw. Every dart feeds model context, but routine and notable speech waits for a completed visit; the third-dart envelope explicitly includes all visit segments and the visit total. Checkouts, busts, 180s, major checkouts, leg wins, match wins, and Nikita specials remain immediate/guaranteed. `CommentaryPolicy` also applies per-priority cooldowns, bounded repeat memory, rapid-sequence silence, and latest-wins interruption. `CommentaryVisitTiming` then gives an approved ordinary call an 850 ms natural pause: the next accepted dart suppresses a pending thought and clears routine audio already underway, while notable completed-visit calls remain immediate; marquee and terminal calls never wait. Corrections reset timing, policy, and director state from the authoritative replacement snapshot, so invalidated speech or stories cannot survive. The exact 1 + 5 + 20 visit is detected from canonical turn darts and explicitly named in both Realtime and fallback prompts. The obsolete global two-second commentary debouncer is gone; deterministic policy and visit timing own pacing without delaying marquee calls. Delivery is playful and lightly sassy within the selected persona, teasing results and story patterns rather than personal traits. OpenAI streams audio directly to the browser WebRTC track and transcript deltas over the data channel; completed calls are also deduplicated into a capped 50-line, per-match “Recent calls” list in commentary settings for review. On a throw edit/delete, `useMatchRealtime` immediately cancels buffered speech, `PUT /api/commentary/realtime/session` idempotently advances the listener epoch, and the browser sends the returned authoritative replacement snapshot; the worker observes that epoch before its next dart, drops its Pressure prefix, and resynchronizes the sideband. The previous commentary/TTS path remains as fallback and records its completed lines in the same list. Next work is local marquee stings and detection-to-first-audible-sample telemetry. See `PRESSURE_ENGINE.md` for boundaries and targets.

The completed visit is the default commentary unit, not an absolute barrier: a notable mid-visit dart may speak immediately only when Pressure marks it as a genuinely large match-probability swing. Cheap favorite flickers, high-pressure labels, and newly proposed story arcs wait for the completed visit, while the director keeps an unspoken proposal promoted until it is actually used.

**Fair ending:**
First player checks out → Pressure v2 marks the checkout provisional and projects the remaining players' chances to join → remaining players complete their turns → if single checkout: leg resolves → if multiple checkouts: eligible players enter high-round tiebreaks. Tiebreak darts update deterministic, normalized probabilities without changing X01 scores; tied leaders advance to the next round. Only authoritative resolution emits `leg_win`/`match_win`.

**Scolia board connectivity:**
`npm run scolia:worker` → REST discovery of account boards → one Scolia cloud WebSocket per serial → serialize and deduplicate incoming messages → persist raw `scolia_events` + current `scolia_boards` status → retry pending/failed detections → `ingestScoliaThrowEvent` maps the sector to the active match/player/turn → existing X01 bust/checkout, fair-ending, leg completion, Elo, and Supabase realtime flows apply. `throws.scolia_event_id` enforces exactly-once scoring across reconnects.

Current-round app undo/edit → match throw API mutates and recomputes app state → `enqueueCurrentRoundScoliaThrowCommand` skips manual or already-taken-out darts and creates `scolia_commands` → worker sends `DELETE_THROW`/`THROW_CORRECTED` on the owning board socket → `ACKNOWLEDGED`/`REFUSED` updates command status.

**Scolia match assignment:**
New Match and Boards load one API snapshot → `scolia_board_public_status` Postgres Realtime updates runtime status immediately while match events refresh occupancy → reconnects reconcile from the API and a local heartbeat-expiry timer detects silent worker loss. The user selects manual scoring or a connected/ready unused board → `POST /api/matches` revalidates availability → persists `matches.scolia_board_id`. A partial unique index permits only one active match per physical board.

Scolia matches replace the manual keypad/dartboard with a hardware-scoring notice, and manual throw POSTs are rejected server-side. Rematch revalidates and carries the same ready board; the partial unique index rejects a concurrent claim.

Scolia spectator loads include throw geometry across every leg for per-player whole-match heatmaps. The current leg's realtime turns override that initial all-leg snapshot so new, edited, and deleted impacts update live without another subscription.

Outbound commands transition `pending` → `sent` → `acknowledged`/`refused`. A missing acknowledgement resets a stale command for retry; after three attempts it becomes `failed`. Deploy `Dockerfile.scolia-worker` as exactly one always-on worker replica outside Vercel.

## Supabase Migration Rule
- Do not use `ALTER FUNCTION` in Supabase migrations. For function changes, use drop + recreate.
- Never modify existing Supabase migration files after they are created/committed.
- Any schema/function/policy change must be done by adding a new migration that supersedes earlier ones.

## Boundaries / Do Not Touch
- `.env*` files, secrets, production credentials.
- Existing migration files in `supabase/migrations/` — never edit, only add new ones.
- `package-lock.json` unless dependency changes are required.
- Generated artifacts (`coverage/`, `playwright-report/`, `.next/`, `node_modules/`).

## When You're Done
- `npm run lint` passes.
- `npm run build` succeeds.
- `npm run test:run` passes (add/update tests for behavior changes).
- Summarize what changed and how to verify locally.
