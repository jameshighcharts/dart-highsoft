import { parentPort, workerData } from 'node:worker_threads';
import { createClient } from '@supabase/supabase-js';
import { loadScoliaRealtimeDartEvent, warmScoliaDartIQContext, ScoliaDartIQEventCache } from '../lib/commentary/scoliaRealtimeEvent.ts';
import { loadRealtimeCommentarySnapshot } from '../lib/commentary/realtimeSnapshot.ts';
import { loadMatch } from '../lib/server/matchGuards.ts';
import { ANALYSIS_TASK_TIMEOUT_MS, type AnalysisTask } from '../services/scoliaCommentaryAnalysis.ts';

// A hung database request must fail rather than hold every later analysis task.
const SUPABASE_REQUEST_TIMEOUT_MS = 15_000;

function fetchWithTimeout(input: Parameters<typeof fetch>[0], init?: RequestInit) {
  const timeout = AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
}

if (!parentPort) throw new Error('Commentary analysis requires a worker thread');
const port = parentPort;
const supabase = createClient(workerData.supabaseUrl, workerData.serviceRoleKey, {
  auth: { persistSession: false },
  global: { fetch: fetchWithTimeout },
});
const cache = new ScoliaDartIQEventCache();
const taskTimeoutMs: number = workerData.taskTimeoutMs ?? ANALYSIS_TASK_TIMEOUT_MS;

// Invalidation is a barrier: work that started before it (or outlived its timeout) may finish, but never writes the cache.
const generations = new Map<string, number>();
const generation = (matchId: string) => generations.get(matchId) ?? 0;
function bumpGeneration(matchId: string) {
  const next = generation(matchId) + 1;
  generations.delete(matchId);
  generations.set(matchId, next);
  if (generations.size > 1_000) {
    const oldest = generations.keys().next().value!;
    generations.delete(oldest);
    cache.delete(oldest);
  }
}

type CachedDartIQContext = Parameters<ScoliaDartIQEventCache['set']>[1];

/** Reads the shared cache, but drops writes once the task is no longer allowed to make them. */
class TaskCache extends ScoliaDartIQEventCache {
  private readonly shared: ScoliaDartIQEventCache;
  private readonly live: () => boolean;
  constructor(shared: ScoliaDartIQEventCache, live: () => boolean) {
    super();
    this.shared = shared;
    this.live = live;
  }
  get(matchId: string) { return this.shared.get(matchId); }
  timeline(matchId: string) { return this.shared.timeline(matchId); }
  set(matchId: string, value: CachedDartIQContext) { if (this.live()) this.shared.set(matchId, value); }
  delete(matchId: string) { this.shared.delete(matchId); }
  clear() { this.shared.clear(); }
}

async function execute(task: Exclude<AnalysisTask, { kind: 'ping' | 'invalidate' }>, taskCache: TaskCache): Promise<unknown> {
  if (task.kind === 'warm') {
    if (taskCache.get(task.matchId)) return undefined;
    const before = await supabase.from('dartiq_source_revisions').select('revision').eq('match_id', task.matchId).maybeSingle();
    if (before.error) throw new Error(before.error.message);
    const context = await warmScoliaDartIQContext(supabase, task.matchId);
    const after = await supabase.from('dartiq_source_revisions').select('revision').eq('match_id', task.matchId).maybeSingle();
    if (after.error) throw new Error(after.error.message);
    if (context && before.data?.revision === after.data?.revision) {
      context.revision = String(after.data?.revision ?? 0);
      taskCache.set(task.matchId, context);
    }
    return undefined;
  }
  if (task.kind === 'snapshot') {
    const match = await loadMatch(supabase, task.matchId);
    if (!match) throw new Error('Could not load match for commentary snapshot');
    return loadRealtimeCommentarySnapshot(supabase, match);
  }
  if (task.kind === 'event') return loadScoliaRealtimeDartEvent(supabase, task.matchId, task.throwId, taskCache, task.accepted);
  throw new Error('Unknown commentary analysis task');
}

/** The timeout starts when the task starts, so time spent queued behind other work never counts against it. */
async function run(id: number, task: Exclude<AnalysisTask, { kind: 'ping' | 'invalidate' }>) {
  const startGeneration = generation(task.matchId);
  let abandoned = false;
  const taskCache = new TaskCache(cache, () => !abandoned && generation(task.matchId) === startGeneration);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const running = execute(task, taskCache);
  // An abandoned task may still fail later; that must not become an unhandled rejection.
  running.catch(() => {});
  try {
    const result = await Promise.race([running, new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abandoned = true;
        reject(new Error('Commentary analysis timed out'));
      }, taskTimeoutMs);
    })]);
    port.postMessage({ id, result });
  } catch (error) {
    port.postMessage({ id, error: error instanceof Error ? error.message : 'Commentary analysis failed' });
  } finally {
    clearTimeout(timer);
  }
}

let work = Promise.resolve();
port.on('message', ({ id, task }: { id: number; task: AnalysisTask }) => {
  // Health checks bypass the queue: an answer proves the thread is alive even while a task is slow.
  if (task.kind === 'ping') { port.postMessage({ id, result: 'pong' }); return; }
  if (task.kind === 'invalidate') {
    bumpGeneration(task.matchId);
    cache.delete(task.matchId);
    return;
  }
  work = work.then(() => run(id, task));
});
