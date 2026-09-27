import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  loadMultipleChoice,
  parseMcOptions,
  shuffleMcOptions,
  initialMcSelections,
  isEnglishEntry,
  hasMcPick,
  mcSubmitLabel,
  mcSubmittedAnswer,
  mcAnswerSlots,
  withTimeout,
  MC_TIMEOUT_MS,
  MC_FALLBACK_MESSAGES,
} from './multipleChoice';

const CACHED = JSON.stringify([
  { correct: '点', options: ['点', '店', '典'] },
  { correct: '菜', options: ['菜', '采', '彩'] },
]);

afterEach(() => {
  vi.useRealTimers();
});

describe('parseMcOptions', () => {
  it('returns null for missing, empty or malformed JSON', () => {
    expect(parseMcOptions(null)).toBeNull();
    expect(parseMcOptions(undefined)).toBeNull();
    expect(parseMcOptions('')).toBeNull();
    expect(parseMcOptions('[]')).toBeNull();
    expect(parseMcOptions('not json')).toBeNull();
    expect(parseMcOptions('[{"nope": 1}]')).toBeNull();
  });

  it('parses well-formed rows', () => {
    expect(parseMcOptions(CACHED)).toEqual([
      { correct: '点', options: ['点', '店', '典'] },
      { correct: '菜', options: ['菜', '采', '彩'] },
    ]);
  });
});

describe('shuffleMcOptions / initialMcSelections', () => {
  it('keeps every option and the correct answer per row', () => {
    const rows = parseMcOptions(CACHED)!;
    const shuffled = shuffleMcOptions(rows, () => 0.99);
    expect(shuffled).toHaveLength(2);
    expect([...shuffled[0].options].sort()).toEqual([...rows[0].options].sort());
    expect(shuffled[0].correct).toBe('点');
  });

  it('pre-selects punctuation and English rows only', () => {
    const rows = [
      { correct: '点', options: ['点', '店'] },
      { correct: '。', options: ['。'] },
      { correct: 'hello', options: ['hello', 'hi'] },
    ];
    expect(initialMcSelections(rows)).toEqual([null, '。', 'hello']);
    expect(isEnglishEntry('hello')).toBe(true);
    expect(isEnglishEntry('点')).toBe(false);
  });
});

describe('one-tap submit with partial answers', () => {
  // 图书馆。 — three rows to pick in, then a pre-selected full stop
  const rows = [
    { correct: '图', options: ['团', '图', '国'] },
    { correct: '书', options: ['韦', '书', '节'] },
    { correct: '馆', options: ['官', '馆', '管'] },
    { correct: '。', options: ['。'] },
  ];

  it('nothing picked: "Show answer" and an empty answer (pre-selected rows are not an answer)', () => {
    const sel = initialMcSelections(rows);
    expect(hasMcPick(rows, sel)).toBe(false);
    expect(mcSubmitLabel(rows, sel)).toBe('Show answer');
    expect(mcSubmittedAnswer(rows, sel)).toBe('');
  });

  it('partial: "Submit", the picks in row order with unselected rows skipped', () => {
    const sel = ['图', null, '管', '。'];
    expect(mcSubmitLabel(rows, sel)).toBe('Submit');
    expect(mcSubmittedAnswer(rows, sel)).toBe('图管。');
  });

  it('every row picked: the whole answer, as before', () => {
    expect(mcSubmittedAnswer(rows, ['图', '书', '馆', '。'])).toBe('图书馆。');
  });

  it('English rows are pre-selected text, not a pick', () => {
    const withEnglish = [{ correct: 'T', options: ['T', 'X'] }, { correct: '恤', options: ['恤', '血'] }];
    const sel = initialMcSelections(withEnglish);
    expect(sel).toEqual(['T', null]);
    expect(mcSubmitLabel(withEnglish, sel)).toBe('Show answer');
    expect(mcSubmittedAnswer(withEnglish, ['T', '血'])).toBe('T血');
  });

  it('slots: right / wrong / skipped / given per row for the answer side', () => {
    expect(mcAnswerSlots(rows, ['图', '节', null, '。'])).toEqual([
      { correct: '图', chosen: '图', status: 'right' },
      { correct: '书', chosen: '节', status: 'wrong' },
      { correct: '馆', chosen: null, status: 'skipped' },
      { correct: '。', chosen: '。', status: 'given' },
    ]);
  });
});

describe('withTimeout', () => {
  it('rejects with "Generation timed out" after the deadline', async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {});
    const p = withTimeout(never, 100);
    const assertion = expect(p).rejects.toThrow('Generation timed out');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it('resolves with the value when it arrives in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 100)).resolves.toBe('ok');
  });
});

describe('loadMultipleChoice', () => {
  it('uses cached options without calling generate, even offline', async () => {
    const generate = vi.fn();
    const result = await loadMultipleChoice({ cachedOptions: CACHED, online: false, generate });
    expect(result.status).toBe('ready');
    if (result.status === 'ready') {
      expect(result.generated).toBe(false);
      expect(result.options).toHaveLength(2);
    }
    expect(generate).not.toHaveBeenCalled();
  });

  it('falls back to typing offline with nothing cached, never starting a request', async () => {
    const generate = vi.fn();
    const result = await loadMultipleChoice({ cachedOptions: null, online: false, generate });
    expect(result).toEqual({ status: 'fallback', reason: 'offline', message: MC_FALLBACK_MESSAGES.offline });
    expect(generate).not.toHaveBeenCalled();
  });

  it('generates when online and returns the new options', async () => {
    const generate = vi.fn().mockResolvedValue(CACHED);
    const result = await loadMultipleChoice({ cachedOptions: null, online: true, generate });
    expect(result.status).toBe('ready');
    if (result.status === 'ready') expect(result.generated).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('times out at 8 seconds and falls back to typing with a note', async () => {
    vi.useFakeTimers();
    expect(MC_TIMEOUT_MS).toBe(8000);
    const generate = vi.fn(() => new Promise<string>(() => {}));
    const pending = loadMultipleChoice({ cachedOptions: null, online: true, generate });
    await vi.advanceTimersByTimeAsync(7999);
    // Still waiting just before the deadline
    let settled = false;
    pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result).toEqual({ status: 'fallback', reason: 'timeout', message: MC_FALLBACK_MESSAGES.timeout });
  });

  it('falls back on a request error', async () => {
    const generate = vi.fn().mockRejectedValue(new Error('500'));
    const result = await loadMultipleChoice({ cachedOptions: null, online: true, generate });
    expect(result).toEqual({ status: 'fallback', reason: 'error', message: MC_FALLBACK_MESSAGES.error });
  });

  it('falls back when the server has no options for the word', async () => {
    const generate = vi.fn().mockResolvedValue(null);
    const result = await loadMultipleChoice({ cachedOptions: null, online: true, generate });
    expect(result).toEqual({ status: 'fallback', reason: 'empty', message: MC_FALLBACK_MESSAGES.empty });
  });
});
