let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  audioCtx ??= new Ctor();
  return audioCtx;
}

/** Short bell/pling tone for a target hit (Around the Clock, Shanghai). */
export function playHitSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.2, now);
    master.connect(ctx.destination);

    // Fundamental + a couple of overtones for a bell-like "pling".
    const partials: Array<[freq: number, gain: number]> = [
      [1568, 1],
      [3136, 0.35],
      [4700, 0.15],
    ];
    for (const [freq, gain] of partials) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(gain, now + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      osc.connect(env);
      env.connect(master);
      osc.start(now);
      osc.stop(now + 0.5);
    }
  } catch {
    // noop
  }
}
