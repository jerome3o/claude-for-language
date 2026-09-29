/**
 * A short rising arpeggio for emptying today's queue (the Lab app plays its FANFARE sfx at the
 * same moment). Synthesised with WebAudio — no asset to download or cache — and silent when
 * WebAudio is unavailable or the page has not been interacted with yet.
 */
export function playFanfare(volume = 0.18): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    const start = ctx.currentTime + 0.02;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const t = start + i * 0.11;
      const len = i === notes.length - 1 ? 0.55 : 0.18;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + len + 0.05);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1500);
  } catch {
    // no sound is fine
  }
}
