# Dart Highsoft architecture

A Next.js darts scorer on Vercel, a Supabase Postgres backend with Realtime, a long-running Node worker that bridges Scolia camera boards into live games, and OpenAI for optional commentary and speech.

Repo: https://github.com/jameshighcharts/dart-highsoft

## 1. Runtime topology

```mermaid
flowchart LR
  subgraph Browser["Browsers (players, spectators, TVs)"]
    Pages["/new · /match/[id] · /game/[id]<br/>/games · /leaderboards · /boards · /stats"]
  end

  subgraph Vercel["Next.js on Vercel"]
    API["API routes<br/>/api/matches/** · /api/games/**<br/>/api/scolia/boards/** · /api/commentary · /api/tts"]
    Lib["lib/server<br/>turnLifecycle · completeLeg · gameThrowLifecycle<br/>scoliaBoardTarget · scoliaCommands"]
  end

  subgraph Supabase["Supabase"]
    PG[("Postgres<br/>X01: matches · legs · turns · throws<br/>Games: game_sessions · game_throws<br/>Scolia: scolia_boards · scolia_events · scolia_commands")]
    RT["Realtime publication"]
  end

  subgraph WorkerHost["Railway / Render container"]
    Worker["Scolia worker<br/>src/workers/scoliaWorker.ts"]
  end

  Scolia["Scolia cloud<br/>game.scoliadarts.com"]
  SBC["Scolia SBC<br/>(cameras on the board)"]
  OpenAI["OpenAI"]

  Pages -- "fetch JSON" --> API
  API -- "service role" --> PG
  Lib --> PG
  PG --> RT
  RT -- "postgres_changes (anon key)" --> Pages
  API -- "REST: list / connect / disconnect boards" --> Scolia
  API -- "commentary · TTS" --> OpenAI
  Worker <-- "WSS per board: events down, commands up<br/>REST discovery every 30s" --> Scolia
  Worker -- "service role: events, status, commands, throws" --> PG
  SBC -- "WSS" --> Scolia
```

Browsers never write to Postgres directly. All writes go through the API routes or the worker, both using the service role. Browsers read with the anon key and receive pushed changes over Realtime. The worker is the only component holding Scolia WebSockets, so it runs on a persistent host, not on Vercel.

## 2. Two game families, one board

| | X01 | Party games (Cricket, Killer, Shanghai, Around the Clock) |
|---|---|---|
| Tables | `matches`, `match_players`, `legs`, `turns`, `throws` | `game_sessions`, `game_session_players`, `game_throws` |
| Live page | `/match/[id]` (`MatchClient`) | `/game/[id]` (`GameClient`) |
| Who decides bust / win | Client for manual darts, server for Scolia darts | Server always; client replays the same engine for display |
| State storage | `turns.total_scored`, `turns.busted`, `legs.winner_player_id` | None. State is derived by replaying `game_throws` |
| Rating | Elo (2-player and multiplayer) | None. Per-mode leaderboard views |

A Scolia board drives at most one active match or one active game session. A `before insert` trigger on both tables enforces this across tables and raises `unique_violation`, which the API maps to HTTP 409.

## 3. Party game engine

```mermaid
flowchart TB
  Log[("game_throws<br/>ordered by (turn_index, dart_index)")]
  Engine["getEngine(mode).deriveState(config, players, throws)"]
  State["GameState<br/>currentPlayerId · dartsThrownInTurn · round<br/>perPlayer · standings · winnerId · finished · lastEvent"]

  Log --> Engine --> State

  subgraph Engines["src/lib/games/engines"]
    Cricket["cricket.ts"]
    Killer["killer.ts"]
    Shanghai["shanghai.ts"]
    Clock["aroundTheClock.ts"]
  end
  Engines -.-> Engine

  Shared["replay.ts<br/>groupTurns · computeOpenTurn · nextEligiblePlayer"]
  Segment["segment.ts<br/>parseSegment('T20') → {value 20, multiplier 3, scored 60}"]
  Shared -.-> Engines
  Segment -.-> Engines
```

Rules:

- The throw log is the only stored fact. Undo is "delete the last row and replay".
- Every engine implements `parseConfig`, `finalizeConfig` (Killer assigns numbers here) and `deriveState`.
- `lastEvent` describes what the latest dart did and is written to `game_throws.meta`, so leaderboard views can count marks, kills and Shanghais in plain SQL.
- The Scolia worker imports this code with `node --experimental-strip-types`, so everything under `src/lib/games` and the server helpers it reaches must use relative `.ts` imports, no `@/` alias, no TypeScript `enum`, no `server-only`.

## 4. Life of a manual dart (party game)

```mermaid
sequenceDiagram
  participant B as Browser (GameClient)
  participant A as POST /api/games/[id]/throws
  participant L as gameThrowLifecycle
  participant E as Engine
  participant DB as Postgres
  participant RT as Realtime

  B->>B: optimistic append, derive state locally
  B->>A: { segment: "T20", scored: 60, playerId }
  A->>L: loadGameSnapshot(id)
  L->>DB: session + players + throws
  L->>E: deriveState(existing throws)
  L->>L: reject if finished / wrong player / bad segment
  L->>E: deriveState(existing + candidate) → nextState, lastEvent
  L->>DB: rpc append_game_throw_atomic(slot, segment, meta, finished?, winner)
  Note over DB: one transaction: insert game_throws,<br/>and mark the session completed when the dart wins
  A-->>B: { throw, state }
  DB-->>RT: change on game_throws / game_sessions
  RT-->>B: refetch, derive again
```

The unique key `(session_id, turn_index, dart_index)` makes two devices racing for the same dart safe: the loser gets a 409 and reloads. Since migration 0056 the insert and the session update happen inside one Postgres function (`append_game_throw_atomic`; undo uses `undo_last_game_throw_atomic`, creation uses `create_game_session_atomic` and `create_x01_match_atomic`), so a crash between the two steps cannot leave a won game marked active.

## 5. Life of a Scolia dart

```mermaid
sequenceDiagram
  participant SBC as Scolia SBC
  participant SC as Scolia cloud
  participant W as Worker (BoardConnection)
  participant I as scoliaThrowIngestion
  participant T as scoliaBoardTarget
  participant DB as Postgres
  participant B as Browser

  SBC->>SC: dart detected
  SC->>W: THROW_DETECTED { sector, coordinates, angle }
  W->>DB: upsert scolia_events (board_id, message_id)
  W->>I: ingestScoliaThrowEvent(event)
  I->>DB: already stored? (throws.scolia_event_id, game_throws.scolia_event_id)
  I->>T: findActiveScoliaBoardTarget(board)
  alt match
    I->>DB: resolve turn, insert throws row, replay X01, completeLeg
  else game
    I->>DB: appendGameThrow via engine, finalize if finished
  else none
    I->>DB: mark event ignored
  end
  DB-->>B: Realtime push
```

Corrections flow the other way: undoing or editing a Scolia dart in the browser enqueues `DELETE_THROW` or `THROW_CORRECTED` in `scolia_commands`; the worker sends it over the socket and records `ACKNOWLEDGED` or `REFUSED`. Commands are only queued while the dart is still in the board's current physical round (no `TAKEOUT_FINISHED` since).

## 6. Worker lifecycle

```mermaid
stateDiagram-v2
  [*] --> syncBoards: start (every 30s)
  syncBoards --> connecting: new board on account
  connecting --> connected: socket open, GET_SBC_STATUS
  connected --> connected: persist events · flush commands (500ms) · heartbeat (15s)
  connected --> reconnecting: socket closed
  reconnecting --> connecting: backoff (4100/4102 → 5 min, 4101 → 30s, else 1–30s)
  connected --> disconnected: board removed from account
```

## 7. Data model

```mermaid
erDiagram
  players ||--o{ match_players : ""
  matches ||--o{ match_players : ""
  matches ||--o{ legs : ""
  legs ||--o{ turns : ""
  turns ||--o{ throws : ""
  players ||--o{ game_session_players : ""
  game_sessions ||--o{ game_session_players : ""
  game_sessions ||--o{ game_throws : ""
  scolia_boards ||--o{ matches : "scolia_board_id"
  scolia_boards ||--o{ game_sessions : "scolia_board_id"
  scolia_boards ||--o{ scolia_events : ""
  scolia_boards ||--o{ scolia_commands : ""
  scolia_events ||--o| throws : "scolia_event_id"
  scolia_events ||--o| game_throws : "scolia_event_id"

  game_sessions {
    uuid id
    game_session_mode mode
    jsonb config
    text status "active | completed | ended_early"
    uuid winner_player_id
    uuid scolia_board_id
  }
  game_throws {
    uuid id
    int round_number
    int turn_index
    int dart_index
    text segment
    int scored
    jsonb meta "engine lastEvent"
    bigint scolia_event_id
  }
```

Views (all `security_invoker = true`): X01 stats and Elo views from earlier migrations, plus `game_mode_leaderboard`, `cricket_leaderboard`, `killer_leaderboard`, `shanghai_leaderboard`, `around_the_clock_leaderboard`.

## 8. Where to look

| Concern | Path |
|---|---|
| X01 rules | `src/utils/x01.ts`, `src/utils/legScoreCalculator.ts`, `src/lib/server/recomputeLegTurns.ts` |
| Party game rules | `src/lib/games/engines/*.ts` |
| Party game server flow | `src/lib/server/gameThrowLifecycle.ts`, `src/lib/server/createGameSession.ts` |
| Scolia protocol | `src/lib/scolia/protocol.ts`, `docs/SCOLIA_SOCIAL_API.md` |
| Scolia ingestion and dispatch | `src/lib/server/scoliaThrowIngestion.ts`, `gameScoliaIngestion.ts`, `scoliaBoardTarget.ts` |
| Worker | `src/workers/scoliaWorker.ts`, `Dockerfile.scolia-worker` |
| Live pages | `src/app/match/[id]/MatchClient.tsx`, `src/app/game/[id]/GameClient.tsx` |
| New game form | `src/app/new/page.tsx`, `src/components/games/NewGameOptions.tsx`, `src/lib/games/labels.ts` |
| Schema | `supabase/migrations/` (0001 base, 0048–0054 Scolia, 0055 party games, 0056 atomic scoring functions) |
