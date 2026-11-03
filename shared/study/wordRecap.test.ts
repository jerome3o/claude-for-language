import { describe, expect, it } from 'vitest';
import { judgeReadAloud } from '../reader/readAloud';
import {
  addRecapMistakes, addRecapTap, answerRecap, emptyRecapRun, finishRecapRun, isRecapWord, markRecapped, recapAvailable,
  recapBar, recapChoices, recapDoneLine, recapItemIds, recapKey, recapMistakes, recapProgress, recapPromptLabel, recapPromptLine,
  recapRightFirstTime, recapRunFor, recapSentenceClue, recapWhyLines, restartRecap, setRecapKeep, type WordRecapTap,
  chatRecapCount, chatRecapRun, chatRecapRunId, recapBumpSource, recapDeck, recapEvent, recapSource, recapSourceLabel, recapUpNextSource,
} from './wordRecap';
import { UP_NEXT_SOURCES } from '../decks/up-next';
import { BUMP_SOURCES } from '../decks/bumps';
import { isAnalyticsEvent } from '../analytics/events';

const PAGE0 = '我们去成都吃麻辣兔头。';
const WORDS0 = [
  { text: '我们', pinyin: 'wǒmen', gloss: 'we' }, { text: '去', pinyin: 'qù', gloss: 'go' },
  { text: '成都', pinyin: 'Chéngdū', gloss: 'Chengdu' }, { text: '吃', pinyin: 'chī', gloss: 'eat' },
  { text: '麻辣', pinyin: 'málà', gloss: 'numbing and spicy' }, { text: '兔头', pinyin: 'tùtóu', gloss: "rabbit head" },
  { text: '。', pinyin: '', gloss: '' },
];
const tap = (over: Partial<WordRecapTap>): WordRecapTap => ({
  text: '采耳', pinyin: 'cǎi\'ěr', gloss: 'ear cleaning', sentence: '他在春熙路采耳。', page: 1, pos: 5, page_english: 'He gets his ears cleaned on Chunxi Road.', ...over,
});

describe('reader word recap', () => {
  it('keys words by letters and digits only', () => {
    expect(recapKey(' 成都，')).toBe('成都');
    expect(isRecapWord('OK')).toBe(false);
    expect(isRecapWord('A货')).toBe(true);
  });

  it('collects taps, dedupes and keeps story order', () => {
    let run = emptyRecapRun('r1', '2026-11-03T10:00:00Z');
    run = addRecapTap(run, tap({}), '2026-11-03T10:01:00Z');
    run = addRecapTap(run, tap({ text: '麻辣', pinyin: 'málà', gloss: 'numbing and spicy', sentence: PAGE0, page: 0, pos: 6 }), '2026-11-03T10:02:00Z');
    run = addRecapTap(run, tap({}), '2026-11-03T10:03:00Z');
    run = addRecapTap(run, tap({ text: '，' }), '2026-11-03T10:03:00Z');
    expect(run.words.map((w) => w.hanzi)).toEqual(['麻辣', '采耳']);
    expect(recapItemIds(run)).toEqual(['麻辣', '采耳']);
  });

  it('takes a read-aloud mistake, never a homophone or extra words', () => {
    const r = judgeReadAloud(PAGE0, '我们去程度吃兔头了');
    const m = recapMistakes(r, WORDS0.map((w) => w.text));
    expect(m.map((x) => x.text)).toEqual(['成都', '麻辣']);
    expect(m[0].said).toEqual(['都 dū → you said dù (4th tone instead of 1st)']);
    let run = emptyRecapRun('r1', 't0');
    run = addRecapMistakes(run, { index: 0, text: PAGE0, english: 'We go to Chengdu to eat spicy rabbit heads.', words: WORDS0 }, r, 't1');
    expect(run.words[0]).toMatchObject({ hanzi: '成都', gloss: 'Chengdu', sentence: PAGE0, reasons: ['said_wrong'], page: 0, pos: 3 });
    expect(recapWhyLines(run.words[0])).toEqual(['Read aloud: 都 dū → you said dù (4th tone instead of 1st)']);
    // Tapping the same word merges the reasons.
    run = addRecapTap(run, tap({ text: '成都', page: 0, pos: 3, sentence: PAGE0 }), 't2');
    expect(run.words[0].reasons).toEqual(['tapped', 'said_wrong']);
    expect(recapPromptLine(run)).toBe('Words from this story: 1 you tapped · 2 you read aloud differently.');
  });

  it('a homophone-only take collects nothing', () => {
    const r = judgeReadAloud('他在春熙路。', '他在春西路');
    expect(recapMistakes(r, null)).toEqual([]);
  });

  it('carries an unfinished run on, starts afresh after a finished one', () => {
    const run = emptyRecapRun('r1', '2026-11-01T10:00:00Z');
    expect(recapRunFor(run, 'r1', '2026-11-02T08:00:00Z', 'now')).toBe(run);
    const done = finishRecapRun(run, '2026-11-01T11:00:00Z');
    expect(recapRunFor(done, 'r1', '2026-11-02T08:00:00Z', 'now').words).toEqual([]);
    expect(recapRunFor(done, 'r1', '2026-11-01T10:30:00Z', 'now')).toBe(done);
    expect(recapRunFor(run, 'r2', 'x', 'now').reader_id).toBe('r2');
    expect(recapAvailable(done)).toBe(false);
    expect(recapAvailable(addRecapTap(done, tap({}), 'x'))).toBe(true);
  });

  it('runs the one-off pass: Not yet comes back until Got it', () => {
    let run = addRecapTap(addRecapTap(emptyRecapRun('r', 't'), tap({}), 't'), tap({ text: '兔头', page: 0, pos: 8 }), 't');
    expect(recapProgress(run).remaining).toEqual(['兔头', '采耳']);
    run = answerRecap(run, '兔头', false, '2026-11-03T10:00:01Z', 'e1');
    run = answerRecap(run, '采耳', true, '2026-11-03T10:00:02Z', 'e2');
    expect(recapProgress(run).remaining).toEqual(['兔头']);
    expect(recapBar(run).onRetries).toBe(true);
    run = answerRecap(run, '兔头', true, '2026-11-03T10:00:03Z', 'e3');
    expect(recapProgress(run).complete).toBe(true);
    expect(recapRightFirstTime(run)).toBe(1);
    run = markRecapped(run, 'x');
    expect(restartRecap(run)).toMatchObject({ events: [], recapped_at: null });
  });

  it('splits the switched-on words into new cards and bumps (default off)', () => {
    let run = addRecapTap(addRecapTap(emptyRecapRun('r', 't'), tap({}), 't'), tap({ text: '成都', page: 0, pos: 3 }), 't');
    expect(recapChoices(run, () => false)).toEqual({ add: [], bump: [] });
    run = setRecapKeep(setRecapKeep(run, '成都', true), '采耳', true);
    const c = recapChoices(run, (k) => k === '成都');
    expect(c.add.map((w) => w.hanzi)).toEqual(['采耳']);
    expect(c.bump.map((w) => w.hanzi)).toEqual(['成都']);
    expect(recapChoices(setRecapKeep(run, '采耳', false), () => false).add.map((w) => w.hanzi)).toEqual(['成都']);
  });

  it('uses a short story sentence as the card sentence', () => {
    const w = addRecapTap(emptyRecapRun('r', 't'), tap({}), 't').words[0];
    expect(recapSentenceClue(w)).toBe('他在春熙路采耳。');
    expect(recapSentenceClue({ ...w, sentence: '采耳' })).toBe('');
    expect(recapSentenceClue({ ...w, sentence: '他在春熙路(成都)采耳。' })).toBe('');
    expect(recapSentenceClue({ ...w, sentence: '今天下午他和朋友一起在成都最热闹的春熙路上舒舒服服地采耳。' })).toBe('');
  });

  it('labels', () => {
    expect(recapPromptLabel(1)).toBe('📝 Recap 1 word');
    expect(recapPromptLabel(4)).toBe('📝 Recap 4 words');
    expect(recapDoneLine(2, 1)).toBe('2 words added to your long-term review · 1 for today ⚡');
    expect(recapDoneLine(0, 0)).toBe('Nothing kept — that’s fine.');
  });
});

describe('chat word recap (the same pass, a chat as the source)', () => {
  const words = [
    { hanzi: '成都', sentence: '我们明天去成都吧。', reasons: ['tapped' as const], pinyin: 'Chéngdū', gloss: 'Chengdu' },
    { hanzi: '银行', sentence: '我去银行。', reasons: ['said_wrong' as const], reason_line: 'Tone off on 银 (heard 音)' },
    { hanzi: 'OK', sentence: 'OK', reasons: ['tapped' as const] },
  ];

  it('builds a run of the chat words: the message sentence as the cue, finished from the start', () => {
    const run = chatRecapRun('t1', words, null, 'NOW');
    expect(run.reader_id).toBe(chatRecapRunId('t1'));
    expect(recapSource(run)).toBe('chat');
    expect(recapAvailable(run)).toBe(true);
    expect(run.words.map((w) => [w.hanzi, w.sentence, w.page])).toEqual([['成都', '我们明天去成都吧。', 0], ['银行', '我去银行。', 1]]);
    expect(recapWhyLines(run.words[1], 'chat')).toEqual(['Read it back: Tone off on 银 (heard 音)']);
    expect(recapWhyLines(run.words[0], 'chat')).toEqual(['You tapped it in the chat']);
    expect(chatRecapCount(words, null)).toBe(2);
  });

  it('carries answers and switches on; after Done only words met since count', () => {
    let run = chatRecapRun('t1', words, null, 'T0');
    run = setRecapKeep(answerRecap(run, '成都', true, 'T1', 'e1'), '银行', true);
    const more = [...words, { hanzi: '热闹', sentence: '成都很热闹。', reasons: ['tapped' as const] }];
    run = chatRecapRun('t1', more, run, 'T2');
    expect(run.words.map((w) => w.hanzi)).toEqual(['成都', '银行', '热闹']);
    expect(run.events.map((e) => e.item_id)).toEqual(['成都']);
    expect(run.keep).toEqual(['银行']);
    expect(run.words[0].at).toBe('T0');
    run = markRecapped(run, 'T3');
    expect(chatRecapCount(more, run)).toBe(0);
    const next = [...more, { hanzi: '麻辣', sentence: '麻辣兔头。', reasons: ['tapped' as const] }];
    expect(chatRecapCount(next, run)).toBe(1);
    const run2 = chatRecapRun('t1', next, run, 'T4');
    expect(run2.words.map((w) => w.hanzi)).toEqual(['麻辣']);
    expect(run2.before).toEqual(['成都', '银行', '热闹']);
    expect(run2.events).toEqual([]);
    expect(run2.keep).toEqual([]);
  });

  it('per-source copy, deck, Up next / bump sources and events', () => {
    expect(recapSourceLabel('chat')).toBe('from your chat with Claude');
    expect(recapSourceLabel('reader', '小明在成都')).toBe('from the story “小明在成都”');
    expect(recapDeck('chat').name).toBe('From my chats');
    expect(recapDeck('reader').name).toBe('From my readers');
    expect(recapUpNextSource('chat')).toBe('chat_recap');
    expect(UP_NEXT_SOURCES).toContain('chat_recap');
    expect(BUMP_SOURCES).toContain(recapBumpSource('chat'));
    expect(recapEvent('chat', 'finish')).toBe('coach.ask_recap_finish');
    expect(recapEvent('reader', 'start')).toBe('reader.word_recap_start');
    for (const src of ['reader', 'chat'] as const) for (const w of ['start', 'finish'] as const) expect(isAnalyticsEvent(recapEvent(src, w))).toBe(true);
  });
});
