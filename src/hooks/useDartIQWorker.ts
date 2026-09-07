"use client";

import { useEffect, useRef, useState } from 'react';
import type { DartIQLiveEvidence, DartIQLiveInput, DartIQLiveRequest, DartIQLiveResponse } from '@/lib/dartiq/liveWorker';

type Work = { id: number; input: DartIQLiveInput; evidence: DartIQLiveEvidence };

/** Rare completed-turn fallback. No synchronous replay if workers are unavailable. */
export function computeDartIQCommentary(input: DartIQLiveInput, evidence: DartIQLiveEvidence | undefined,
  turnId: string, playerId: string): Promise<DartIQLiveResponse['commentary']> {
  if (!evidence) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let worker: Worker;
    try { worker = new Worker(new URL('../workers/dartiqLiveWorker.ts', import.meta.url), { type: 'module' }); }
    catch { resolve(undefined); return; }
    const finish = (result?: DartIQLiveResponse['commentary']) => {
      clearTimeout(timer); worker.terminate(); resolve(result);
    };
    const timer = setTimeout(() => finish(), 10_000);
    worker.onmessage = ({ data }: MessageEvent<DartIQLiveResponse>) => {
      if (data.id === 1) finish(data.commentary);
    };
    worker.onerror = worker.onmessageerror = () => finish();
    try { worker.postMessage({ id: 1, input, evidence, commentary: { turnId, playerId } } satisfies DartIQLiveRequest); }
    catch { finish(); }
  });
}

/** One in-flight calculation, one latest-wins snapshot, and one bounded restart.
 * Fail closed: broken workers must never fall back onto the UI thread.
 */
export function useDartIQWorker(input: DartIQLiveInput, evidence?: DartIQLiveEvidence) {
  const submit = useRef<((input: DartIQLiveInput, evidence?: DartIQLiveEvidence) => void) | null>(null);
  const [result, setResult] = useState<(Work & { snapshot: DartIQLiveResponse['snapshot'] }) | null>(null);

  useEffect(() => {
    let worker: Worker | null = null;
    let latest: Work | null = null;
    let active: Work | null = null;
    let sentEvidence: DartIQLiveEvidence | null = null;
    let sequence = 0;
    let restarts = 0;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function fail() {
      clearTimeout(timer);
      worker?.terminate();
      worker = null;
      active = null;
      sentEvidence = null;
      setResult(null);
      if (!disposed && restarts++ < 1) { start(); dispatch(); }
    }
    function dispatch() {
      if (!worker || !latest || active) return;
      active = latest;
      const request: DartIQLiveRequest = { id: active.id, input: active.input };
      if (sentEvidence !== active.evidence) request.evidence = active.evidence;
      try {
        worker.postMessage(request);
        sentEvidence = active.evidence;
        timer = setTimeout(fail, 30_000);
      } catch { fail(); }
    }
    function start() {
      try {
        const instance = new Worker(new URL('../workers/dartiqLiveWorker.ts', import.meta.url), { type: 'module' });
        worker = instance;
        instance.onmessage = ({ data }: MessageEvent<DartIQLiveResponse>) => {
          if (disposed || worker !== instance || !active || data.id !== active.id) return;
          clearTimeout(timer);
          if (!data.snapshot) { fail(); return; }
          const completed = active;
          active = null;
          if (latest?.id === completed.id) {
            setResult({ ...completed, snapshot: data.snapshot });
            latest = null;
          } else { dispatch(); }
        };
        instance.onerror = instance.onmessageerror = () => {
          if (!disposed && worker === instance) fail();
        };
      } catch { worker = null; }
    }
    start();
    submit.current = (nextInput, nextEvidence) => {
      latest = nextEvidence ? { id: ++sequence, input: nextInput, evidence: nextEvidence } : null;
      dispatch();
    };
    return () => {
      disposed = true;
      submit.current = null;
      clearTimeout(timer);
      worker?.terminate();
    };
  }, []);

  useEffect(() => { submit.current?.(input, evidence); }, [input, evidence]);
  // Even a response racing React's next effect cannot show old probabilities.
  return result?.input === input && result.evidence === evidence ? result.snapshot : null;
}
