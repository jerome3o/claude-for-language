import { describe, expect, it } from 'vitest';
import type { CustomLessonSpec } from '@shared/lesson/types';
import type { CardWithNote, QueueCounts } from '../../types';
import type { UiNode } from '../ui/layout';
import { spokenCheckFor, studyView, type StudyViewInput } from './StudyPanel';
import { readerListView, readerPageView } from './ReaderPanel';
import { passView } from './HomeworkPanel';
import { explorerView } from './ExplorerPanel';
import { lessonReduce, lessonView, scrambleCorrect, START_RUN } from './LessonPanel';
import { feedbackView } from './FeedbackPanel';
import { imageKeysOf, isMediaKey } from '../images';
import { trayNodes } from '../tray';

/** Every action reachable in a view (buttons, list rows, texts with an action). */
function actions(nodes: readonly UiNode[]): string[] {
  const out: string[] = [];
  const visit = (n: UiNode) => {
    if (n.t === 'button' && !n.disabled) out.push(n.action);
    else if (n.t === 'row') n.children.forEach(visit);
    else if (n.t === 'list') n.items.forEach((i) => out.push(i.action));
    else if (n.t === 'text' && n.action) out.push(n.action);
  };
  nodes.forEach(visit);
  return out;
}
const texts = (nodes: readonly UiNode[]) => JSON.stringify(nodes);

const COUNTS: QueueCounts = { new: 2, secondaryNew: 1, learning: 1, review: 5 };

function card(type: CardWithNote['card_type']): CardWithNote {
  return {
    id: 'c1',
    note_id: 'n1',
    card_type: type,
    queue: 0,
    note: { id: 'n1', hanzi: '银行', pinyin: 'yínháng', english: 'bank', alternatives: null, audio_url: null, sentence_clue: '我去银行。', sentence_clue_translation: 'I go to the bank.', fun_facts: '银 silver + 行 business' },
  } as unknown as CardWithNote;
}

const base: StudyViewInput = { loading: false, card: null, reader: null, grammar: false, revealed: false, spoken: null, counts: COUNTS, previews: null, reviewsToday: 0, online: true };

describe('study view', () => {
  it('loading, all done, reader, grammar', () => {
    expect(texts(studyView({ ...base, loading: true }))).toContain('Loading');
    expect(actions(studyView(base))).toEqual(['reload']);
    expect(actions(studyView({ ...base, reader: { id: 'r1', title: '小明在巴黎' } }))).toContain('open_reader');
    expect(texts(studyView({ ...base, grammar: true }))).toContain('phone');
  });

  it('reading card: hanzi to explore, then Show answer; the answer side rates', () => {
    const q = studyView({ ...base, card: card('hanzi_to_meaning') });
    expect(actions(q)).toEqual(['reveal']);
    expect(texts(q)).not.toContain('bank');
    const a = studyView({ ...base, card: card('hanzi_to_meaning'), revealed: true, previews: { 0: { intervalText: '1m', queue: 1 }, 1: { intervalText: '6m', queue: 1 }, 2: { intervalText: '10m', queue: 1 }, 3: { intervalText: '2d', queue: 2 } } as never });
    expect(actions(a)).toEqual(['play', 'rate:0', 'rate:1', 'rate:2', 'rate:3']);
    expect(texts(a)).toContain('bank');
    expect(texts(a)).toContain('"sub":"2d"');
  });

  it('typing cards offer 🎤 when online', () => {
    expect(actions(studyView({ ...base, card: card('meaning_to_hanzi') }))).toEqual(['speak', 'reveal']);
    expect(actions(studyView({ ...base, card: card('meaning_to_hanzi'), online: false }))).toEqual(['reveal']);
    expect(actions(studyView({ ...base, card: card('audio_to_hanzi') }))).toEqual(['play', 'speak', 'reveal']);
  });

  it('a spoken answer is checked like the web’s Say the answer (homophones count)', () => {
    expect(spokenCheckFor(card('meaning_to_hanzi'), '银行。').verdict).toBe('exact');
    expect(spokenCheckFor(card('meaning_to_hanzi'), '吃饭').verdict).toBe('wrong');
    const v = studyView({ ...base, card: card('meaning_to_hanzi'), revealed: true, spoken: { transcript: '银行', verdict: 'exact' } });
    expect(texts(v)).toContain('You said: 银行');
  });
});

describe('reader views', () => {
  it('the Up next list opens readers', () => {
    expect(texts(readerListView(null))).toContain('Loading');
    expect(texts(readerListView([]))).toContain('No story');
    const list = readerListView([{ id: 'r1', title: '小明在巴黎', english: 'Paris', pages: 6, read: false }, { id: 'r2', title: '猫', english: 'Cat', pages: 4, read: false }]);
    expect(actions(list)).toEqual(['open:r1', 'open:r2']);
  });

  it('a page: picture, Chinese, toggles, paging, Finish on the last', () => {
    const page = { content_chinese: '小明在巴黎。', content_pinyin: 'Xiǎo Míng zài Bālí.', content_english: 'Xiaoming is in Paris.', image_url: 'reader-images/p1.png' };
    const first = readerPageView({ title: 'T', page, index: 0, total: 2, showPinyin: false, showEnglish: false, finished: false, canGoBack: true });
    expect(actions(first)).toEqual(['play', 'pinyin', 'english', 'back', 'next']);
    expect(texts(first)).not.toContain('Paris.');
    expect(first[0]).toEqual({ t: 'image', key: 'reader-images/p1.png', height: 340 });
    const last = readerPageView({ title: 'T', page, index: 1, total: 2, showPinyin: true, showEnglish: true, finished: false, canGoBack: false });
    expect(actions(last)).toContain('finish');
    expect(texts(last)).toContain('Xiaoming is in Paris.');
    expect(texts(readerPageView({ title: 'T', page, index: 1, total: 2, showPinyin: false, showEnglish: false, finished: true, canGoBack: false }))).toContain('Story finished');
  });
});

describe('homework pass view', () => {
  it('Show answer, then Not yet / Got it; done says so', () => {
    const note = { hanzi: '银行', pinyin: 'yínháng', english: 'bank' };
    expect(actions(passView({ title: 'W1', done: 0, total: 3, complete: false, note, revealed: false, retrying: 0 }))).toEqual(['reveal']);
    expect(actions(passView({ title: 'W1', done: 0, total: 3, complete: false, note, revealed: true, retrying: 1 }))).toEqual(['play', 'wrong', 'right']);
    expect(texts(passView({ title: 'W1', done: 3, total: 3, complete: true, note: null, revealed: false, retrying: 0 }))).toContain('All done');
  });
});

describe('explorer view', () => {
  const rec = {
    char: '银', readings: [{ pinyin: 'yín', english: 'silver' }], meaning: 'silver', radical: '钅', radical_meaning: 'metal', decomposition: null,
    components: [{ char: '钅', meaning: 'metal' }], etymology: null, strokes: 11, rank: 900, words: [{ hanzi: '银行', pinyin: 'yínháng', english: 'bank' }],
  };
  it('a character: readings, parts and words to push', () => {
    const v = explorerView([{ kind: 'char', char: '银' }], { kind: 'char', record: rec });
    expect(actions(v)).toEqual(['play', 'push:钅', 'push:银行']);
  });
  it('a word: its characters to push; ← back when deeper', () => {
    const v = explorerView([{ kind: 'char', char: '银' }, { kind: 'word', hanzi: '银行' }], {
      kind: 'word', chars: ['银', '行'], word: { hanzi: '银行', pinyin: 'yínháng', english: 'bank', senses: ['bank'], syllables: null, rank: 1200, source: 'dictionary' },
    });
    expect(actions(v)).toEqual(['pop', 'crumb:0', 'crumb:1', 'play', 'push:银', 'push:行']);
  });
  it('offline and empty', () => {
    expect(texts(explorerView([{ kind: 'char', char: '银' }], { kind: 'missing', offline: true }))).toContain('connection');
    expect(texts(explorerView([], { kind: 'loading' }))).toContain('Tap any Chinese');
  });
});

describe('lesson (content as data)', () => {
  const spec: CustomLessonSpec = {
    title: '把',
    sections: [{ exercises: [
      { type: 'note', title: '把', body: 'Object first.', sentences: [{ hanzi: '我把门关了。' }] },
      { type: 'choice', question: 'Which?', options: [{ hanzi: '我把书看了。' }, { hanzi: '我看了把书。' }], correct: 0 },
      { type: 'scramble', english: 'I closed the door.', tiles: ['门', '我', '关了', '把'], correct_order: ['我', '把', '门', '关了'] },
      { type: 'translate', english: 'Close it.', reference_hanzi: '把它关上。' },
    ] }],
  };

  it('plays note → choice → scramble, skips what needs the phone, scores', () => {
    let run = START_RUN;
    expect(actions(lessonView(spec, run))).toEqual(['say:0', 'next']);
    run = lessonReduce(spec, run, 'next');
    expect(actions(lessonView(spec, run))).toEqual(['pick:0', 'pick:1']);
    run = lessonReduce(spec, run, 'pick:1');
    expect(run).toMatchObject({ checked: true, right: 0, scored: 1 });
    expect(lessonReduce(spec, run, 'pick:0')).toBe(run); // one answer
    run = lessonReduce(spec, run, 'next');
    for (const t of ['tile:1', 'tile:3', 'tile:0', 'tile:2']) run = lessonReduce(spec, run, t);
    expect(lessonReduce(spec, run, 'tile:1')).toBe(run); // a tile once
    run = lessonReduce(spec, run, 'check');
    expect(run).toMatchObject({ right: 1, scored: 2 });
    run = lessonReduce(spec, run, 'next');
    expect(texts(lessonView(spec, run))).toContain('needs your phone');
    run = lessonReduce(spec, run, 'next');
    expect(texts(lessonView(spec, run))).toContain('1 of 2 right');
    expect(lessonReduce(spec, run, 'restart')).toEqual(START_RUN);
  });

  it('scramble accepts alternative orders', () => {
    expect(scrambleCorrect({ tiles: ['a', 'b'], correct_order: ['a', 'b'], alt_orders: [['b', 'a']] }, [1, 0])).toBe(true);
    expect(scrambleCorrect({ tiles: ['a', 'b'], correct_order: ['a', 'b'] }, [1, 0])).toBe(false);
  });
});

describe('feedback, tray, images', () => {
  it('feedback: chips, 🎤, Send; sent', () => {
    const v = feedbackView({ hasShot: true, message: '', chips: [], status: 'editing', listening: false, online: true });
    expect(actions(v)).toEqual(['chip:Hard to read', 'chip:Too far away', 'chip:Something broke', 'chip:I love this', 'chip:Idea', 'speak', 'send']);
    expect(actions(feedbackView({ hasShot: false, message: '', chips: [], status: 'editing', listening: false, online: true }))).not.toContain('send');
    expect(texts(feedbackView({ hasShot: true, message: 'x', chips: [], status: 'sent', listening: false, online: true }))).toContain('Thanks');
  });

  it('tray: Exit VR only in the headset; 🎤 off offline', () => {
    expect(actions(trayNodes({ presenting: false, listening: false, busy: false, online: true }))).toEqual(['open:study', 'open:reader', 'open:homework', 'open:explorer', 'speak', 'feedback', 'recall']);
    expect(actions(trayNodes({ presenting: true, listening: false, busy: false, online: false }))).toEqual(['open:study', 'open:reader', 'open:homework', 'open:explorer', 'feedback', 'recall', 'exit']);
  });

  it('image keys are media keys only — never URLs', () => {
    expect(isMediaKey('reader-images/abc.png')).toBe(true);
    for (const bad of ['https://evil.example/x.png', '//evil.example/x', 'data:image/png;base64,AAA', 'javascript:alert(1)', '../secret', '/abs']) {
      expect(isMediaKey(bad)).toBe(false);
    }
    expect(imageKeysOf([{ title: 't', nodes: [{ t: 'image', key: 'reader-images/a.png', height: 1 }, { t: 'image', key: 'https://x/y.png', height: 1 }] }])).toEqual(['reader-images/a.png']);
  });
});
