import { DartIQLiveProcessor, type DartIQLiveRequest, type DartIQLiveResponse } from '@/lib/dartiq/liveWorker';

const processor = new DartIQLiveProcessor();
self.onmessage = ({ data }: MessageEvent<DartIQLiveRequest>) => {
  let snapshot: DartIQLiveResponse['snapshot'] = null;
  let commentary: DartIQLiveResponse['commentary'];
  try {
    snapshot = processor.update(data);
    if (data.commentary) commentary = processor.commentary(data.input, data.commentary.turnId, data.commentary.playerId);
  } catch {
    // A failed analysis must never interrupt scoring or publish stale probabilities.
  }
  self.postMessage({ id: data.id, snapshot, commentary } satisfies DartIQLiveResponse);
};
