// @vitest-environment node
import { EventEmitter } from 'node:events';
import net from 'node:net';
import { Worker } from 'node:worker_threads';
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
  it('coalesces warm-ups and terminates an unresponsive thread without doing work on the main thread',async()=>{
    vi.useFakeTimers();const worker=new FakeWorker();const analysis=new ThreadedScoliaCommentaryAnalysis('','',{factory:()=>worker as unknown as AnalysisWorker,timeoutMs:50,healthTimeoutMs:20});
    const first=analysis.warm('m');expect(analysis.warm('m')).toBe(first);const rejected=expect(first).rejects.toThrow('stopped responding');
    await vi.advanceTimersByTimeAsync(51);expect(worker.terminate).not.toHaveBeenCalled();
    expect(worker.postMessage.mock.calls.at(-1)?.[0].task).toEqual({kind:'ping'});
    await vi.advanceTimersByTimeAsync(21);await rejected;expect(worker.terminate).toHaveBeenCalledTimes(1);analysis.close();
  });
  it('gives up on one slow request without restarting a thread that still answers',async()=>{
    vi.useFakeTimers();const worker=new FakeWorker();const analysis=new ThreadedScoliaCommentaryAnalysis('','',{factory:()=>worker as unknown as AnalysisWorker,timeoutMs:50,healthTimeoutMs:20});
    const slow=analysis.snapshot('a');const rejected=expect(slow).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(30);const other=analysis.snapshot('b');
    await vi.advanceTimersByTimeAsync(21);
    const ping=worker.postMessage.mock.calls.map(call=>call[0]).find(request=>request.task.kind==='ping');
    worker.emit('message',{id:ping.id,result:'pong'});await rejected;
    expect(worker.terminate).not.toHaveBeenCalled();
    const otherId=worker.postMessage.mock.calls[1][0].id;worker.emit('message',{id:otherId,result:'b-snapshot'});
    expect(await other).toBe('b-snapshot');analysis.close();
  });
});

// Runs the real thread against a database that accepts connections but never answers.
describe('commentary analysis thread timeouts',()=>{
  it('times out a stuck task from when it starts and keeps answering health checks',async()=>{
    const sockets:net.Socket[]=[];const server=net.createServer(socket=>{sockets.push(socket);});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    const {port}=server.address() as net.AddressInfo;
    const thread=new Worker(new URL('../workers/scoliaCommentaryAnalysisWorker.ts',import.meta.url),{
      workerData:{supabaseUrl:`http://127.0.0.1:${port}`,serviceRoleKey:'key',taskTimeoutMs:300},
      execArgv:['--experimental-strip-types','--import',new URL('../../scripts/workerLoader.mjs',import.meta.url).href],
    });
    const replies=new Map<number,{result?:unknown;error?:string}>();
    thread.on('message',(message:{id:number;result?:unknown;error?:string})=>replies.set(message.id,message));
    try{
      const started=Date.now();
      thread.postMessage({id:1,task:{kind:'snapshot',matchId:'m'}});
      thread.postMessage({id:2,task:{kind:'snapshot',matchId:'m'}});
      thread.postMessage({id:3,task:{kind:'ping'}});
      await vi.waitFor(()=>expect(replies.get(3)?.result).toBe('pong'),{timeout:5_000});
      expect(replies.has(1)).toBe(false);
      await vi.waitFor(()=>expect(replies.get(2)?.error).toBe('Commentary analysis timed out'),{timeout:5_000});
      expect(replies.get(1)?.error).toBe('Commentary analysis timed out');
      // The queued task got its own full budget instead of inheriting the first task's wait.
      expect(Date.now()-started).toBeGreaterThanOrEqual(550);
    }finally{
      await thread.terminate();sockets.forEach(socket=>socket.destroy());server.close();
    }
  },15_000);
});
