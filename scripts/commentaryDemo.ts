import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';

import {
  BROADCAST_DIRECTOR_DEMO,
  COMMENTARY_DEMO_PLAYERS,
  commentaryDemoSummary,
  type CommentaryDemoDart,
} from '../src/lib/commentary/commentaryDemoScenario.ts';
import {
  ingestScoliaThrowEvent,
  type StoredScoliaEvent,
} from '../src/lib/server/scoliaThrowIngestion.ts';
import { ScoliaRealtimeCommentaryPublisher } from '../src/services/scoliaRealtimeCommentaryPublisher.ts';

const DEMO_PREFIX = 'Commentary Demo';
const DEMO_PLAYER_NAMES = new Set<string>(COMMENTARY_DEMO_PLAYERS);
const LEGACY_DEMO_PLAYER_NAMES = new Set(['Nikita', 'Ken']);
const BOARD_PREFIX = 'LOCAL-DEMO-';
const DEFAULT_DART_GAP_MS = 2_200;
const DEFAULT_TAKEOUT_START_DELAY_MS = 1_800;
const DEFAULT_TAKEOUT_DURATION_MS = 3_000;
const DEFAULT_NEXT_VISIT_WALKUP_MS = 4_500;

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function localSupabaseUrl() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || 'http://127.0.0.1:65421';
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error(`Refusing commentary demo against non-local Supabase host: ${url.hostname}`);
  }
  return value;
}

function serviceRoleKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    || process.env.SUPABASE_SECRET_KEY?.trim()
    || localServiceRoleKey();
}

function localServiceRoleKey() {
  let environment: string;
  const authContainer = new URL(localSupabaseUrl()).port === '56421'
    ? 'supabase_auth_dart-highsoft-test'
    : 'supabase_auth_dart-highsoft';
  try {
    environment = execFileSync(
      'docker',
      [
        'inspect',
        authContainer,
        '--format',
        '{{range .Config.Env}}{{println .}}{{end}}',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
  } catch {
    throw new Error(
      'Local Supabase is not running and no service-role key was provided. Run `supabase start` first.'
    );
  }
  const secret = environment
    .split('\n')
    .find((entry) => entry.startsWith('GOTRUE_JWT_SECRET='))
    ?.slice('GOTRUE_JWT_SECRET='.length);
  if (!secret) throw new Error('Could not discover the local Supabase JWT secret');
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1_000);
  const payload = encode({ role: 'service_role', iss: 'supabase-demo', iat: now, exp: now + 3_600 });
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function client() {
  return createClient(localSupabaseUrl(), serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(error: unknown): never {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

async function prepareDemo(supabase: SupabaseClient) {
  const suffix = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const now = new Date().toISOString();
  const { data: existingPlayers, error: existingPlayersError } = await supabase
    .from('players')
    .select('display_name')
    .in('display_name', [...COMMENTARY_DEMO_PLAYERS]);
  if (existingPlayersError) throw new Error(existingPlayersError.message);
  if ((existingPlayers?.length ?? 0) > 0) {
    const names = existingPlayers?.map((entry) => entry.display_name).join(', ');
    throw new Error(
      `The demo needs its short commentary names to be unique, but these already exist: ${names}`
    );
  }
  const { data: board, error: boardError } = await supabase
    .from('scolia_boards')
    .insert({
      serial_number: `${BOARD_PREFIX}${suffix}`,
      name: `${DEMO_PREFIX} Board`,
      is_home_sbc: true,
      enabled: true,
      worker_connection_status: 'connected',
      board_status: 'Ready',
      board_phase: 'Throw',
      worker_heartbeat_at: now,
      last_event_at: now,
      updated_at: now,
    })
    .select('id, serial_number')
    .single();
  if (boardError || !board) throw new Error(boardError?.message ?? 'Could not create demo board');

  const { data: players, error: playerError } = await supabase
    .from('players')
    .insert(COMMENTARY_DEMO_PLAYERS.map((displayName) => ({
      display_name: displayName,
      is_test: true,
      is_active: true,
    })))
    .select('id, display_name');
  if (playerError || !players || players.length !== COMMENTARY_DEMO_PLAYERS.length) {
    await supabase.from('scolia_boards').delete().eq('id', board.id);
    throw new Error(playerError?.message ?? 'Could not create demo players');
  }

  const playerByName = new Map(players.map((entry) => [String(entry.display_name), entry]));
  const { data: match, error: matchError } = await supabase
    .from('matches')
    .insert({
      mode: 'x01',
      start_score: '301',
      finish: 'double_out',
      legs_to_win: 1,
      fair_ending: false,
      ended_early: false,
      scolia_board_id: board.id,
    })
    .select('id')
    .single();
  if (matchError || !match) throw new Error(matchError?.message ?? 'Could not create demo match');

  const { error: linkError } = await supabase.from('match_players').insert(
    COMMENTARY_DEMO_PLAYERS.map((name, playOrder) => ({
      match_id: match.id,
      player_id: playerByName.get(name)!.id,
      play_order: playOrder,
    }))
  );
  if (linkError) throw new Error(linkError.message);
  const { error: legError } = await supabase.from('legs').insert({
    match_id: match.id,
    leg_number: 1,
    starting_player_id: playerByName.get(COMMENTARY_DEMO_PLAYERS[0])!.id,
  });
  if (legError) throw new Error(legError.message);

  console.log(`Demo match: ${match.id}`);
  console.log(`Open: http://localhost:3000/match/${match.id}`);
  console.log('Enable commentary and audio in the match UI, then run:');
  console.log(`npm run commentary:demo -- run ${match.id}`);
}

async function loadDemoMatch(supabase: SupabaseClient, matchId: string) {
  const { data: match, error } = await supabase
    .from('matches')
    .select('id, scolia_board_id, winner_player_id, completed_at, scolia_boards:scolia_board_id(serial_number)')
    .eq('id', matchId)
    .single();
  if (error || !match) throw new Error(error?.message ?? 'Demo match not found');
  const board = match.scolia_boards as unknown as { serial_number: string } | null;
  if (!board?.serial_number.startsWith(BOARD_PREFIX)) {
    throw new Error('Refusing to inject into a match that was not created by commentary:demo');
  }
  if (match.winner_player_id || match.completed_at) throw new Error('Demo match is already complete');
  const { count, error: throwError } = await supabase
    .from('throws')
    .select('id, turns!inner(legs!inner(match_id))', { count: 'exact', head: true })
    .eq('turns.legs.match_id', matchId);
  if (throwError) throw new Error(throwError.message);
  const existingDarts = count ?? 0;
  const scenarioDarts = BROADCAST_DIRECTOR_DEMO.reduce(
    (total, visit) => total + visit.darts.length,
    0
  );
  if (existingDarts > scenarioDarts) {
    throw new Error(`Demo has ${existingDarts} darts, beyond the ${scenarioDarts}-dart scenario`);
  }
  return { boardId: match.scolia_board_id as string, existingDarts };
}

async function waitForListener(supabase: SupabaseClient, matchId: string) {
  console.log('Waiting up to 90 seconds for an active browser Realtime listener…');
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const { count, error } = await supabase
      .from('commentary_realtime_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('match_id', matchId)
      .eq('status', 'active')
      .gte('last_seen_at', new Date(Date.now() - 45_000).toISOString());
    if (error) throw new Error(error.message);
    if ((count ?? 0) > 0) return;
    await sleep(1_000);
  }
  throw new Error('No active Realtime listener. Open the match and enable commentary plus audio.');
}

async function persistDemoDart(
  supabase: SupabaseClient,
  boardId: string,
  matchId: string,
  dart: CommentaryDemoDart,
  sequence: number
) {
  const occurredAt = new Date().toISOString();
  const payload = {
    bounceout: dart.sector === 'None',
    sector: dart.sector,
    coordinates: [dart.impactXmm, dart.impactYmm],
    angle: { horizontal: 1.5 + sequence * 0.1, vertical: 8.5 - sequence * 0.05 },
    detectionTime: occurredAt,
  };
  const { data, error } = await supabase
    .from('scolia_events')
    .insert({
      board_id: boardId,
      message_id: `commentary-demo-${matchId}-${sequence}-${crypto.randomUUID()}`,
      event_type: 'THROW_DETECTED',
      payload,
      occurred_at: occurredAt,
      processing_status: 'pending',
    })
    .select('id, board_id, message_id, event_type, payload')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Could not persist demo dart');

  await supabase.from('scolia_boards').update({
    worker_connection_status: 'connected',
    board_status: 'Ready',
    board_phase: 'Throw',
    worker_heartbeat_at: occurredAt,
    last_event_at: occurredAt,
    updated_at: occurredAt,
  }).eq('id', boardId);
  return data as StoredScoliaEvent;
}

async function persistDemoTakeout(
  supabase: SupabaseClient,
  boardId: string,
  matchId: string,
  sequence: number,
  type: 'TAKEOUT_STARTED' | 'TAKEOUT_FINISHED'
) {
  const occurredAt = new Date().toISOString();
  const messageId = `commentary-demo-${matchId}-takeout-${sequence}-${type.toLowerCase()}-${crypto.randomUUID()}`;
  const { data, error } = await supabase
    .from('scolia_events')
    .insert({
      board_id: boardId,
      message_id: messageId,
      event_type: type,
      payload: type === 'TAKEOUT_FINISHED'
        ? { falseTakeout: false, time: occurredAt }
        : { time: occurredAt },
      occurred_at: occurredAt,
      processing_status: 'ignored',
      processed_at: occurredAt,
    })
    .select('message_id')
    .single();
  if (error || !data) throw new Error(error?.message ?? `Could not persist ${type}`);
  const { error: boardError } = await supabase.from('scolia_boards').update({
    worker_connection_status: 'connected',
    board_status: 'Ready',
    board_phase: type === 'TAKEOUT_STARTED' ? 'Takeout' : 'Throw',
    worker_heartbeat_at: occurredAt,
    last_event_at: occurredAt,
    updated_at: occurredAt,
  }).eq('id', boardId);
  if (boardError) throw new Error(boardError.message);
  return String(data.message_id);
}

async function runDemo(supabase: SupabaseClient, matchId: string, fast: boolean) {
  const { boardId, existingDarts } = await loadDemoMatch(supabase, matchId);
  await waitForListener(supabase, matchId);
  const publisher = new ScoliaRealtimeCommentaryPublisher(
    supabase,
    requiredEnvironment('OPENAI_API_KEY')
  );
  const dartGap = fast ? 300 : DEFAULT_DART_GAP_MS;
  const takeoutStartDelay = fast ? 200 : DEFAULT_TAKEOUT_START_DELAY_MS;
  const takeoutDuration = fast ? 300 : DEFAULT_TAKEOUT_DURATION_MS;
  const nextVisitWalkup = fast ? 500 : DEFAULT_NEXT_VISIT_WALKUP_MS;
  let sequence = 0;
  try {
    console.log(existingDarts > 0
      ? `Listener ready. Resuming after ${existingDarts} canonical darts…`
      : 'Listener ready. Injecting canonical Scolia events…');
    for (const [visitIndex, visit] of BROADCAST_DIRECTOR_DEMO.entries()) {
      const visitEndSequence = sequence + visit.darts.length;
      if (visitEndSequence <= existingDarts) {
        sequence = visitEndSequence;
        continue;
      }
      console.log(`Round ${visit.round}, visit ${visitIndex + 1}: ${visit.player} — ${visit.purpose}`);
      for (const [dartIndex, dart] of visit.darts.entries()) {
        sequence += 1;
        if (sequence <= existingDarts) continue;
        const event = await persistDemoDart(supabase, boardId, matchId, dart, sequence);
        const result = await ingestScoliaThrowEvent(supabase, event);
        if (result.status !== 'processed') throw new Error(`Dart ignored: ${result.reason}`);
        if (result.target.kind !== 'match') throw new Error('Demo dart was routed to a party game');
        await publisher.publishAcceptedThrow(result.target.id, result.throwId);
        console.log(`  Dart ${dartIndex + 1}: ${dart.segment} (${dart.scored})`);
        const isVisitEnd = dartIndex === visit.darts.length - 1;
        if (!isVisitEnd) {
          await sleep(dartGap);
          continue;
        }
        await sleep(takeoutStartDelay);
        await persistDemoTakeout(supabase, boardId, matchId, sequence, 'TAKEOUT_STARTED');
        console.log('  Takeout started');
        await sleep(takeoutDuration);
        const takeoutEventId = await persistDemoTakeout(
          supabase,
          boardId,
          matchId,
          sequence,
          'TAKEOUT_FINISHED'
        );
        const handoffCount = await publisher.publishTakeoutFinished(matchId, takeoutEventId);
        console.log(handoffCount > 0
          ? '  Takeout finished — next visit announced'
          : '  Takeout finished');
        await sleep(nextVisitWalkup);
      }
    }
    console.log('Demo complete. Leaving five seconds for the final audio payoff…');
    await sleep(5_000);
  } finally {
    publisher.close();
  }
}

async function cleanupDemo(supabase: SupabaseClient, matchId: string) {
  const { data: match, error } = await supabase
    .from('matches')
    .select('id, scolia_board_id, scolia_boards:scolia_board_id(serial_number), match_players(player_id, players:player_id(display_name, is_test))')
    .eq('id', matchId)
    .single();
  if (error || !match) throw new Error(error?.message ?? 'Demo match not found');
  const links = match.match_players as unknown as Array<{
    player_id: string;
    players: { display_name: string; is_test: boolean } | null;
  }>;
  const currentDemo = links.length === COMMENTARY_DEMO_PLAYERS.length
    && links.every((link) => DEMO_PLAYER_NAMES.has(link.players?.display_name ?? ''));
  const legacyDemo = links.length === LEGACY_DEMO_PLAYER_NAMES.size
    && links.every((link) => LEGACY_DEMO_PLAYER_NAMES.has(link.players?.display_name ?? ''));
  const board = match.scolia_boards as unknown as { serial_number: string } | null;
  if (
    !board?.serial_number.startsWith(BOARD_PREFIX)
    || links.some((link) => link.players?.is_test !== true)
    || (!currentDemo && !legacyDemo)
  ) {
    throw new Error('Refusing to clean a match that is not a commentary demo');
  }
  const { error: deleteMatchError } = await supabase.from('matches').delete().eq('id', matchId);
  if (deleteMatchError) throw new Error(deleteMatchError.message);
  if (match.scolia_board_id) {
    await supabase.from('scolia_boards').delete().eq('id', match.scolia_board_id);
  }
  await supabase.from('players').delete().in('id', links.map((link) => link.player_id));
  console.log(`Cleaned demo match ${matchId}`);
}

async function main() {
  const [command = 'preview', value, ...flags] = process.argv.slice(2);
  if (command === 'preview') {
    console.table(commentaryDemoSummary());
    return;
  }
  const supabase = client();
  if (command === 'prepare') return prepareDemo(supabase);
  if (command === 'run' && value) return runDemo(supabase, value, flags.includes('--fast'));
  if (command === 'cleanup' && value) return cleanupDemo(supabase, value);
  throw new Error(
    'Usage: commentary:demo -- preview | prepare | run <match-id> [--fast] | cleanup <match-id>'
  );
}

void main().catch(fail);
