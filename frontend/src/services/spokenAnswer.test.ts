import { describe, expect, it, vi } from 'vitest';
import { SpokenAnswerController, type LiveLike, type SpokenAnswer, type SpokenAnswerDeps, type SpokenAnswerState } from './spokenAnswer';

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

/** `skipReview` defaults to TRUE here (the old checked-at-once path); the review step has its own block. */
function setup(opts: { live?: ReturnType<typeof fakeLive> | null; upload?: () => Promise<{ text: string; language: string }>; skipReview?: boolean; online?: boolean; micOk?: boolean } = {}) {
  const states: SpokenAnswerState[] = [];
  const results: Array<{ text: string; submit: boolean; again?: boolean }> = [];
  const answers: SpokenAnswer[] = [];
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
    skipReview: () => opts.skipReview ?? true,
    onState: (s) => states.push(s),
    onResult: (a) => {
      answers.push(a);
      results.push(a.again ? { text: a.text, submit: a.submit, again: true } : { text: a.text, submit: a.submit });
    },
    track: (result, props) => tracked.push({ result, props }),
  };
  return { c: new SpokenAnswerController(deps), deps, states, results, answers, tracked, live, take };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('SpokenAnswerController', () => {
  it('review skipped (Settings): streams live, interim text shows, stop → the final text is submitted', async () => {
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
    expect(t.tracked).toEqual([{ result: 'submitted', props: expect.objectContaining({ via: 'live', live_error: 'none', auto_submit: true, reviewed: false, edited: false }) }]);
    expect(t.answers[0]).toMatchObject({ transcript: '油', reviewed: false });
  });

  describe('the review step (the default)', () => {
    it('stop → review: the transcript waits, nothing checked or reported until Submit', async () => {
      const t = setup({ skipReview: false });
      await t.c.start();
      t.c.stop();
      await flush();
      expect(t.c.current).toMatchObject({ phase: 'review', finalText: '油', again: false });
      expect(t.results).toEqual([]);
      expect(t.tracked).toEqual([]);
      t.c.submit();
      expect(t.c.current.phase).toBe('idle');
      expect(t.answers).toEqual([{ text: '油', transcript: '油', submit: true, again: false, reviewed: true }]);
      expect(t.tracked).toEqual([{ result: 'submitted', props: expect.objectContaining({ via: 'live', reviewed: true, edited: false, auto_submit: false, retry: false }) }]);
      expect(t.deps.discardTake).not.toHaveBeenCalled(); // the take rides with the review
    });

    it('Retry replaces the take: a new recording, the old transcript gone', async () => {
      const t = setup({ skipReview: false, live: null, upload: vi.fn().mockResolvedValueOnce({ text: '油', language: 'zh' }).mockResolvedValueOnce({ text: '由', language: 'zh' }) });
      await t.c.start();
      t.c.stop();
      await flush();
      expect(t.c.current.finalText).toBe('油');
      await t.c.retake();
      expect(t.c.current).toMatchObject({ phase: 'listening', finalText: '' });
      expect(t.deps.startRecorder).toHaveBeenCalledTimes(2);
      expect(t.deps.startRecorder).toHaveBeenLastCalledWith(expect.anything(), { keepPrevious: false });
      expect(t.tracked[0]).toMatchObject({ result: 'retaken', props: { reviewed: true } });
      t.c.stop();
      await flush();
      expect(t.c.current).toMatchObject({ phase: 'review', finalText: '由' });
      t.c.submit();
      expect(t.results).toEqual([{ text: '由', submit: true }]);
    });

    it('Edit: the transcript goes to the box, not checked (Check submits it, typed once changed)', async () => {
      const t = setup({ skipReview: false });
      await t.c.start();
      t.c.stop();
      await flush();
      t.c.edit();
      expect(t.c.current.phase).toBe('idle');
      expect(t.answers).toEqual([{ text: '油', transcript: '油', submit: false, again: false, reviewed: true }]);
      expect(t.tracked).toEqual([{ result: 'filled', props: expect.objectContaining({ reviewed: true, edited: true }) }]);
      // Submit / Edit outside the review do nothing.
      t.c.submit();
      t.c.edit();
      expect(t.answers).toHaveLength(1);
    });

    it('a take that gives nothing: failed, no review, Retry records anew', async () => {
      const t = setup({ skipReview: false, live: fakeLive(''), upload: async () => ({ text: '', language: 'zh' }) });
      await t.c.start();
      t.c.stop();
      await flush();
      expect(t.c.current).toMatchObject({ phase: 'failed', failure: 'empty' });
      expect(t.tracked[0]).toMatchObject({ result: 'empty', props: { reviewed: true } });
      t.c.submit();
      expect(t.results).toEqual([]);
      await t.c.retake();
      expect(t.c.current.phase).toBe('listening');
    });

    it('cancel on the review throws the take away', async () => {
      const t = setup({ skipReview: false });
      await t.c.start();
      t.c.stop();
      await flush();
      t.c.cancel();
      expect(t.deps.discardTake).toHaveBeenCalled();
      expect(t.c.current.phase).toBe('idle');
      expect(t.tracked[0]).toMatchObject({ result: 'cancelled', props: { reviewed: true } });
      expect(t.results).toEqual([]);
    });
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
    it('review skipped: keeps the previous take until the new one lands, and checks the new answer at once', async () => {
      const t = setup();
      await t.c.start({ again: true });
      expect(t.deps.startRecorder).toHaveBeenCalledWith(expect.anything(), { keepPrevious: true });
      expect(t.c.current).toMatchObject({ phase: 'listening', again: true });
      t.live!.say('油', '');
      expect(t.c.current.finalText).toBe('油');
      t.c.stop();
      await flush();
      expect(t.results).toEqual([{ text: '油', submit: true, again: true }]);
      expect(t.c.current).toMatchObject({ phase: 'idle', again: false });
      expect(t.deps.restorePrevious).not.toHaveBeenCalled();
      expect(t.tracked).toEqual([{ result: 'submitted', props: expect.objectContaining({ retry: true, auto_submit: true, reviewed: false }) }]);
    });

    it('goes through the same review: Submit checks it, Retry stays a say-again', async () => {
      const t = setup({ skipReview: false });
      await t.c.start({ again: true });
      t.c.stop();
      await flush();
      expect(t.c.current).toMatchObject({ phase: 'review', finalText: '油', again: true });
      expect(t.results).toEqual([]);
      await t.c.retake();
      expect(t.c.current).toMatchObject({ phase: 'listening', again: true });
      expect(t.deps.startRecorder).toHaveBeenLastCalledWith(expect.anything(), { keepPrevious: true });
      t.c.stop();
      await flush();
      t.c.submit();
      expect(t.answers).toEqual([{ text: '油', transcript: '油', submit: true, again: true, reviewed: true }]);
      expect(t.deps.restorePrevious).not.toHaveBeenCalled();
    });

    it('Edit on its review: the box on the question side, Check submits the edited text (checked as typed)', async () => {
      const t = setup({ skipReview: false });
      await t.c.start({ again: true });
      t.c.stop();
      await flush();
      t.c.edit();
      expect(t.c.current).toMatchObject({ phase: 'editing', finalText: '油', again: true });
      expect(t.results).toEqual([]);
      t.c.submitEdit('  ');
      expect(t.results).toEqual([]); // nothing to check
      t.c.submitEdit(' 由 ');
      expect(t.answers).toEqual([{ text: '由', transcript: '油', submit: true, again: true, reviewed: true }]);
      expect(t.tracked).toEqual([{ result: 'filled', props: expect.objectContaining({ retry: true, reviewed: true, edited: true }) }]);
    });

    it('cancel on its review or while editing brings the previous take back', async () => {
      const t = setup({ skipReview: false });
      await t.c.start({ again: true });
      t.c.stop();
      await flush();
      t.c.cancel();
      expect(t.deps.restorePrevious).toHaveBeenCalledTimes(1);
      expect(t.deps.discardTake).not.toHaveBeenCalled();
      await t.c.start({ again: true });
      t.c.stop();
      await flush();
      t.c.edit();
      t.c.cancel();
      expect(t.deps.restorePrevious).toHaveBeenCalledTimes(2);
      expect(t.c.current).toMatchObject({ phase: 'idle', again: false });
      expect(t.results).toEqual([]);
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
