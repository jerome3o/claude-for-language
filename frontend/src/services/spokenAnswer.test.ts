import { describe, expect, it, vi } from 'vitest';
import { SpokenAnswerController, type LiveLike, type SpokenAnswerDeps, type SpokenAnswerState } from './spokenAnswer';

/** A fake live transcriber: tokens arrive through `say`, `finish` resolves (or rejects) on demand. */
function fakeLive(result: string | Error = '油') {
  let onUpdate: (f: string, p: string) => void = () => {};
  const live: LiveLike & { pushed: number; aborted: boolean } = {
    pushed: 0,
    aborted: false,
    push() { this.pushed++; },
    finish: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
    abort() { this.aborted = true; },
  };
  return { live, bind: (cb: typeof onUpdate) => { onUpdate = cb; }, say: (f: string, p: string) => onUpdate(f, p) };
}

function setup(opts: { live?: ReturnType<typeof fakeLive> | null; upload?: () => Promise<{ text: string; language: string }>; autoSubmit?: boolean; online?: boolean; micOk?: boolean } = {}) {
  const states: SpokenAnswerState[] = [];
  const results: Array<{ text: string; submit: boolean; again?: boolean }> = [];
  const tracked: Array<{ result: string; props: Record<string, unknown> }> = [];
  let stopHook: ((take: Blob) => void) | null = null;
  const take = new Blob(['take'], { type: 'audio/webm' });
  const live = opts.live === undefined ? fakeLive() : opts.live;
  const deps: SpokenAnswerDeps = {
    startRecorder: vi.fn(async (hooks) => {
      stopHook = hooks.onStop;
      hooks.onChunk(new Blob(['a']));
      return opts.micOk ?? true;
    }),
    stopRecorder: vi.fn(() => { stopHook?.(take); }),
    cancelRecorder: vi.fn(),
    discardTake: vi.fn(),
    restorePrevious: vi.fn(),
    createLive: (cb) => { if (!live) return null; live.bind(cb); return live.live; },
    upload: vi.fn(opts.upload ?? (async () => ({ text: '油', language: 'zh' }))),
    isOnline: () => opts.online ?? true,
    autoSubmit: () => opts.autoSubmit ?? true,
    onState: (s) => states.push(s),
    onResult: (text, submit, again) => results.push(again ? { text, submit, again } : { text, submit }),
    track: (result, props) => tracked.push({ result, props }),
  };
  return { c: new SpokenAnswerController(deps), deps, states, results, tracked, live, take };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('SpokenAnswerController', () => {
  it('streams live: interim text shows, stop → the final text is submitted', async () => {
    const t = setup();
    await t.c.start();
    expect(t.c.current.phase).toBe('listening');
    expect(t.live!.live.pushed).toBe(1);
    t.live!.say('由', '于');
    expect(t.c.current).toMatchObject({ phase: 'listening', finalText: '由', partialText: '于' });
    t.c.stop();
    await flush();
    expect(t.results).toEqual([{ text: '油', submit: true }]);
    expect(t.c.current.phase).toBe('idle');
    expect(t.deps.upload).not.toHaveBeenCalled();
    expect(t.tracked).toEqual([{ result: 'submitted', props: expect.objectContaining({ via: 'live', live_error: 'none', auto_submit: true }) }]);
  });

  it('auto-submit off: fills the box only', async () => {
    const t = setup({ autoSubmit: false });
    await t.c.start();
    t.c.stop();
    await flush();
    expect(t.results).toEqual([{ text: '油', submit: false }]);
    expect(t.tracked[0].result).toBe('filled');
  });

  it('live fails → the take is uploaded (the read cards’ fallback)', async () => {
    const t = setup({ live: fakeLive(new Error('timeout')), upload: async () => ({ text: '游', language: 'zh' }) });
    await t.c.start();
    t.c.stop();
    await flush();
    expect(t.deps.upload).toHaveBeenCalledWith(t.take, 'timeout');
    expect(t.results).toEqual([{ text: '游', submit: true }]);
    expect(t.tracked[0].props).toMatchObject({ via: 'upload', live_error: 'timeout' });
  });

  it('no live key: upload only', async () => {
    const t = setup({ live: null });
    await t.c.start();
    t.c.stop();
    await flush();
    expect(t.deps.upload).toHaveBeenCalledTimes(1);
    expect(t.results[0].text).toBe('油');
    expect(t.tracked[0].props).toMatchObject({ via: 'upload', live_error: 'none' });
  });

  it('both failing: never silent, nothing submitted, retry re-sends the same take', async () => {
    let fail = true;
    const t = setup({ live: fakeLive(new Error('Soniox 402: Balance exhausted')), upload: async () => { if (fail) throw new Error('502'); return { text: '由', language: 'zh' }; } });
    await t.c.start();
    t.c.stop();
    await flush();
    expect(t.results).toEqual([]);
    expect(t.c.current).toMatchObject({ phase: 'failed', failure: 'failed' });
    expect(t.tracked[0]).toMatchObject({ result: 'failed', props: { live_error: 'soniox_402' } });
    fail = false;
    await t.c.retry();
    expect(t.deps.upload).toHaveBeenLastCalledWith(t.take, null);
    expect(t.results).toEqual([{ text: '由', submit: true }]);
  });

  it('nothing heard: "empty", no submit, no retry of the same silence', async () => {
    const t = setup({ live: fakeLive(''), upload: async () => ({ text: '  ', language: 'zh' }) });
    await t.c.start();
    t.c.stop();
    await flush();
    expect(t.c.current).toMatchObject({ phase: 'failed', failure: 'empty' });
    expect(t.results).toEqual([]);
    await t.c.retry();
    expect(t.deps.upload).toHaveBeenCalledTimes(1);
  });

  it('cancel while listening throws the take away and fills nothing', async () => {
    const t = setup();
    await t.c.start();
    t.c.cancel();
    expect(t.deps.cancelRecorder).toHaveBeenCalled();
    expect(t.live!.live.aborted).toBe(true);
    expect(t.c.current.phase).toBe('idle');
    expect(t.tracked[0].result).toBe('cancelled');
    await flush();
    expect(t.results).toEqual([]);
  });

  it('a stop before the microphone opened stops as soon as it does', async () => {
    const t = setup();
    const p = t.c.start();
    t.c.stop(); // still opening
    await p;
    await flush();
    expect(t.deps.stopRecorder).toHaveBeenCalled();
    expect(t.results).toEqual([{ text: '油', submit: true }]);
  });

  it('a microphone that will not open goes back to idle', async () => {
    const t = setup({ micOk: false });
    await t.c.start();
    expect(t.c.current.phase).toBe('idle');
    expect(t.live!.live.aborted).toBe(true);
  });

  describe('Say it again (answer side)', () => {
    it('keeps the previous take until the new one lands, and always checks the new answer', async () => {
      const t = setup({ autoSubmit: false });
      await t.c.start({ again: true });
      expect(t.deps.startRecorder).toHaveBeenCalledWith(expect.anything(), { keepPrevious: true });
      expect(t.c.current).toMatchObject({ phase: 'listening', again: true });
      t.live!.say('油', '');
      expect(t.c.current.finalText).toBe('油');
      t.c.stop();
      await flush();
      // Checked even with auto-submit off: the card is already revealed.
      expect(t.results).toEqual([{ text: '油', submit: true, again: true }]);
      expect(t.c.current).toMatchObject({ phase: 'idle', again: false });
      expect(t.deps.restorePrevious).not.toHaveBeenCalled();
      expect(t.tracked).toEqual([{ result: 'submitted', props: expect.objectContaining({ retry: true, auto_submit: false }) }]);
    });

    it('a first answer is tracked with retry false', async () => {
      const t = setup();
      await t.c.start();
      t.c.stop();
      await flush();
      expect(t.tracked[0].props).toMatchObject({ retry: false });
      expect(t.deps.startRecorder).toHaveBeenCalledWith(expect.anything(), { keepPrevious: false });
    });

    it('cancel while listening: the previous take comes back, nothing is answered', async () => {
      const t = setup();
      await t.c.start({ again: true });
      t.c.cancel();
      expect(t.deps.cancelRecorder).toHaveBeenCalled();
      expect(t.deps.restorePrevious).toHaveBeenCalledTimes(1);
      expect(t.c.current).toMatchObject({ phase: 'idle', again: false });
      expect(t.tracked[0]).toMatchObject({ result: 'cancelled', props: { retry: true } });
      await flush();
      expect(t.results).toEqual([]);
    });

    it('a failed take stays a say-again: retry, 🎤 again, or cancel back to the previous take', async () => {
      let fail = true;
      const t = setup({ live: fakeLive(new Error('timeout')), upload: async () => { if (fail) throw new Error('502'); return { text: '由', language: 'zh' }; } });
      await t.c.start({ again: true });
      t.c.stop();
      await flush();
      expect(t.c.current).toMatchObject({ phase: 'failed', failure: 'failed', again: true });
      expect(t.results).toEqual([]);
      // 🎤 again from the failed state: still a say-again (keepPrevious), the take before it still restorable.
      await t.c.start();
      expect(t.c.current).toMatchObject({ phase: 'listening', again: true });
      expect(t.deps.startRecorder).toHaveBeenLastCalledWith(expect.anything(), { keepPrevious: true });
      t.c.stop();
      await flush();
      expect(t.c.current).toMatchObject({ phase: 'failed', again: true });
      t.c.cancel();
      expect(t.deps.discardTake).not.toHaveBeenCalled();
      expect(t.deps.restorePrevious).toHaveBeenCalledTimes(1);
      expect(t.c.current).toMatchObject({ phase: 'idle', again: false });
      // And a retry that works lands as a checked say-again.
      await t.c.start({ again: true });
      t.c.stop();
      await flush();
      fail = false;
      await t.c.retry();
      expect(t.results).toEqual([{ text: '由', submit: true, again: true }]);
    });

    it('a microphone that will not open goes back to the answer with the previous take', async () => {
      const t = setup({ micOk: false });
      await t.c.start({ again: true });
      expect(t.c.current).toMatchObject({ phase: 'idle', again: false });
      expect(t.deps.restorePrevious).toHaveBeenCalledTimes(1);
    });
  });

  it('offline: does not start', async () => {
    const t = setup({ online: false });
    await t.c.start();
    expect(t.deps.startRecorder).not.toHaveBeenCalled();
    expect(t.states).toEqual([]);
  });
});
