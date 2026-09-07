/** GA assistant items use output_audio; older Realtime content uses audio. */
export function hasRealtimeAudioOutput(response?: {
  output?: { content?: { type?: string }[] }[];
}) {
  return Boolean(response?.output?.some((item) => item.content?.some((part) => (
    part.type === 'output_audio' || part.type === 'audio'
  ))));
}

/** Generation completion and speaker drain are separate Realtime events. */
export class RealtimePlayback {
  private responseId: string | null = null;
  private generationDone = false;
  private audioStopped = false;

  get busy() {
    return this.responseId !== null;
  }

  created(responseId: string | null) {
    this.responseId = responseId;
    this.generationDone = false;
    this.audioStopped = false;
  }

  generationFinished(responseId: string | undefined, hasAudio: boolean) {
    if (!responseId || responseId !== this.responseId) return;
    this.generationDone = true;
    if (!hasAudio || this.audioStopped) this.reset();
  }

  stopped(responseId: string | undefined) {
    if (!responseId || responseId !== this.responseId) return false;
    this.audioStopped = true;
    if (this.generationDone) this.reset();
    return !this.busy;
  }

  reset() {
    this.responseId = null;
    this.generationDone = false;
    this.audioStopped = false;
  }
}
