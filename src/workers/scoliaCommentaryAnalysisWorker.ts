import { parentPort, workerData } from 'node:worker_threads';
import { createClient } from '@supabase/supabase-js';
import { loadScoliaRealtimeDartEvent, warmScoliaDartIQContext, ScoliaDartIQEventCache } from '../lib/commentary/scoliaRealtimeEvent.ts';
import { loadRealtimeCommentarySnapshot } from '../lib/commentary/realtimeSnapshot.ts';
import { loadMatch } from '../lib/server/matchGuards.ts';
import type { AnalysisTask } from '../services/scoliaCommentaryAnalysis.ts';

if (!parentPort) throw new Error('Commentary analysis requires a worker thread');
const port = parentPort;
const supabase = createClient(workerData.supabaseUrl, workerData.serviceRoleKey, { auth: { persistSession: false } });
const cache = new ScoliaDartIQEventCache();
// Ordered processing makes a reset a barrier, including async DB warm-ups.
let work = Promise.resolve();
port.on('message', ({ id, task }: { id: number; task: AnalysisTask }) => {
  work = work.then(async () => {
    try {
      let result: unknown;
      if (task.kind === 'ping') result = 'pong';
      else if (task.kind === 'invalidate') cache.delete(task.matchId);
      else if (task.kind === 'warm') {
        if (!cache.get(task.matchId)) {
          const before = await supabase.from('dartiq_source_revisions').select('revision').eq('match_id', task.matchId).maybeSingle();
          if (before.error) throw new Error(before.error.message);
          const context = await warmScoliaDartIQContext(supabase, task.matchId);
          const after = await supabase.from('dartiq_source_revisions').select('revision').eq('match_id', task.matchId).maybeSingle();
          if (after.error) throw new Error(after.error.message);
          if (context && before.data?.revision === after.data?.revision) {
            context.revision = String(after.data?.revision ?? 0);
            cache.set(task.matchId, context);
          }
        }
      } else if (task.kind === 'snapshot') {
        const match = await loadMatch(supabase, task.matchId);
        if (!match) throw new Error('Could not load match for commentary snapshot');
        result = await loadRealtimeCommentarySnapshot(supabase, match);
      } else if (task.kind === 'event') result = await loadScoliaRealtimeDartEvent(supabase, task.matchId, task.throwId, cache, task.accepted);
      else throw new Error('Unknown commentary analysis task');
      port.postMessage({ id, result });
    } catch (error) { port.postMessage({ id, error: error instanceof Error ? error.message : 'Commentary analysis failed' }); }
  });
});
