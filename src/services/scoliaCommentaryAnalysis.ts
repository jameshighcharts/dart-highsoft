import { Worker } from 'node:worker_threads';
import type { AcceptedScoliaDart, ScoliaRealtimeDartEvent } from '../lib/commentary/scoliaRealtimeEvent.ts';
import type { RealtimeCommentarySnapshot } from '../lib/commentary/realtimeSnapshot.ts';

export type AnalysisTask = { kind: 'event'; matchId: string; throwId: string; accepted?: AcceptedScoliaDart }
  | { kind: 'warm' | 'snapshot' | 'invalidate'; matchId: string } | { kind: 'ping' };
export interface ScoliaCommentaryAnalysis {
  event(matchId: string, throwId: string, accepted?: AcceptedScoliaDart): Promise<ScoliaRealtimeDartEvent>;
  warm(matchId: string): Promise<void>;
  snapshot(matchId: string): Promise<RealtimeCommentarySnapshot>;
  invalidate(matchId: string): void;
  close(): void;
}

type Pending = { matchId?: string; resolve: (result: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
export type AnalysisWorker = Pick<Worker, 'on' | 'postMessage' | 'terminate'>;

/** Each task's own limit inside the thread, measured from when it starts running. */
export const ANALYSIS_TASK_TIMEOUT_MS = 20_000;

/** CPU/model caches live in another thread; failures never fall back onto scoring's event loop. */
export class ThreadedScoliaCommentaryAnalysis implements ScoliaCommentaryAnalysis {
  private worker: AnalysisWorker | null = null;
  private sequence = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly warmups = new Map<string, Promise<void>>();
  private restarts: number[] = [];
  private closed = false;
  private healthCheck: { worker: AnalysisWorker; result: Promise<boolean> } | null = null;
  private readonly factory: () => AnalysisWorker;
  private readonly timeoutMs: number;
  private readonly healthTimeoutMs: number;
  constructor(supabaseUrl: string, serviceRoleKey: string, options: {
    factory?: () => AnalysisWorker; timeoutMs?: number; healthTimeoutMs?: number;
  } = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.healthTimeoutMs = options.healthTimeoutMs ?? 5_000;
    this.factory = options.factory ?? (() => new Worker(new URL('../workers/scoliaCommentaryAnalysisWorker.ts', import.meta.url), {
      workerData: { supabaseUrl, serviceRoleKey },
      execArgv: ['--experimental-strip-types', '--import', new URL('../../scripts/workerLoader.mjs', import.meta.url).href],
    }));
  }
  event(matchId: string, throwId: string, accepted?: AcceptedScoliaDart) {
    return this.request<ScoliaRealtimeDartEvent>({ kind: 'event', matchId, throwId, accepted });
  }
  snapshot(matchId: string) { return this.request<RealtimeCommentarySnapshot>({ kind: 'snapshot', matchId }); }
  warm(matchId: string): Promise<void> {
    const existing = this.warmups.get(matchId);
    if (existing) return existing;
    const promise = this.request<void>({ kind: 'warm', matchId }).finally(() => {
      if (this.warmups.get(matchId) === promise) this.warmups.delete(matchId);
    });
    this.warmups.set(matchId, promise);
    return promise;
  }
  invalidate(matchId: string) {
    for (const [id, pending] of this.pending) {
      if (pending.matchId !== matchId) continue;
      clearTimeout(pending.timer); this.pending.delete(id);
      pending.reject(new Error('Commentary analysis invalidated by a correction or listener change'));
    }
    this.warmups.delete(matchId);
    this.worker?.postMessage({ id: 0, task: { kind: 'invalidate', matchId } });
  }
  close() { this.closed = true; this.fail(new Error('Commentary analysis closed')); }
  private fail(error: Error) {
    const worker = this.worker; this.worker = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.warmups.clear();
    if (worker) void worker.terminate();
  }
  private ensureWorker() {
    if (this.closed) throw new Error('Commentary analysis closed');
    if (this.worker) return this.worker;
    const now = Date.now();
    this.restarts = this.restarts.filter(time => now - time < 60_000);
    if (this.restarts.length >= 3) throw new Error('Commentary analysis restart limit reached');
    this.restarts.push(now);
    const worker = this.factory(); this.worker = worker;
    worker.on('message', (message: { id: number; result?: unknown; error?: string }) => {
      if (this.worker !== worker) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message.result);
    });
    worker.on('error', error => { if (this.worker === worker) this.fail(error); });
    worker.on('exit', code => { if (this.worker === worker) this.fail(new Error(`Commentary analysis exited (${code})`)); });
    return worker;
  }
  /**
   * A late answer usually means the thread is busy, not broken: then only that request gives up.
   * The thread (and everyone's pending work) is restarted only when it stops answering a ping.
   */
  private timedOut(worker: AnalysisWorker, id: number) {
    void this.checkHealth(worker).then((healthy) => {
      if (this.worker !== worker) return;
      if (!healthy) { this.fail(new Error('Commentary analysis thread stopped responding')); return; }
      const pending = this.pending.get(id);
      if (!pending) return;
      this.pending.delete(id);
      pending.reject(new Error('Commentary analysis timed out'));
    });
  }
  private checkHealth(worker: AnalysisWorker): Promise<boolean> {
    if (this.healthCheck?.worker === worker) return this.healthCheck.result;
    const id = ++this.sequence;
    const check = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve(false); }, this.healthTimeoutMs);
      const settle = (healthy: boolean) => { clearTimeout(timer); resolve(healthy); };
      this.pending.set(id, { resolve: () => settle(true), reject: () => settle(false), timer });
      try { worker.postMessage({ id, task: { kind: 'ping' } }); } catch { this.pending.delete(id); settle(false); }
    }).finally(() => { if (this.healthCheck?.result === check) this.healthCheck = null; });
    this.healthCheck = { worker, result: check };
    return check;
  }
  private request<T>(task: AnalysisTask): Promise<T> {
    if (this.pending.size >= 64) return Promise.reject(new Error('Commentary analysis queue is full'));
    return new Promise<T>((resolve, reject) => {
      const worker = this.ensureWorker(); const id = ++this.sequence;
      const timer = setTimeout(() => this.timedOut(worker, id), this.timeoutMs);
      this.pending.set(id, { matchId: 'matchId' in task ? task.matchId : undefined,
        resolve: result => resolve(result as T), reject, timer });
      try { worker.postMessage({ id, task }); } catch (error) { this.fail(error instanceof Error ? error : new Error('Could not send analysis')); }
    });
  }
}
