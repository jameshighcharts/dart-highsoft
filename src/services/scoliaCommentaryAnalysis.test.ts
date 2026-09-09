// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThreadedScoliaCommentaryAnalysis, type AnalysisWorker } from './scoliaCommentaryAnalysis';
class FakeWorker extends EventEmitter {
  postMessage=vi.fn(); terminate=vi.fn().mockResolvedValue(0);
}
afterEach(()=>vi.useRealTimers());
describe('commentary analysis thread',()=>{
  it('drops pre-correction results and sends a reset barrier before later work',async()=>{
    const worker=new FakeWorker();const analysis=new ThreadedScoliaCommentaryAnalysis('','',{factory:()=>worker as unknown as AnalysisWorker});
    const old=analysis.event('m','dart1'); const rejected=expect(old).rejects.toThrow('invalidated');
    analysis.invalidate('m');await rejected;
    const current=analysis.event('m','dart2');
    const requests=worker.postMessage.mock.calls.map(call=>call[0]);
    expect(requests.map(request=>request.task.kind)).toEqual(['event','invalidate','event']);
    worker.emit('message',{id:requests[0].id,result:'stale'});
    worker.emit('message',{id:requests[2].id,result:'current'});
    expect(await current).toBe('current');analysis.close();
  });
  it('restarts after a crash and rejects work from the old thread',async()=>{
    const workers:FakeWorker[]=[];const analysis=new ThreadedScoliaCommentaryAnalysis('','',{factory:()=>{
      const worker=new FakeWorker();workers.push(worker);return worker as unknown as AnalysisWorker;
    }});
    const failed=analysis.snapshot('m');const rejected=expect(failed).rejects.toThrow('crashed');workers[0].emit('error',new Error('crashed'));await rejected;
    const current=analysis.snapshot('m');expect(workers).toHaveLength(2);
    const id=workers[1].postMessage.mock.calls[0][0].id;
    workers[0].emit('message',{id,result:'old'});workers[1].emit('message',{id,result:'new'});
    expect(await current).toBe('new');analysis.close();
  });
  it('coalesces warm-ups and terminates stuck analysis without doing work on the main thread',async()=>{
    vi.useFakeTimers();const worker=new FakeWorker();const analysis=new ThreadedScoliaCommentaryAnalysis('','',{factory:()=>worker as unknown as AnalysisWorker,timeoutMs:50});
    const first=analysis.warm('m');expect(analysis.warm('m')).toBe(first);const rejected=expect(first).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(51);await rejected;expect(worker.terminate).toHaveBeenCalledTimes(1);analysis.close();
  });
});
