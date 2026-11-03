import { describe, expect, it } from 'vitest';
import {
  cardChips,
  chipsFor,
  claudeReplyPollMs,
  composerFor,
  PRACTICE_READ_ONLY_NOTE,
  headerChipFor,
  readerPageWords,
  resumeThreadFor,
  turnStatusLine,
  CLAUDE_POLL_FAST_MS,
  CLAUDE_POLL_SLOW_MS,
  RESUME_WINDOW_MS,
  type ResumeCandidate,
} from './contexts';
import { askQuickActions } from '../study/askClaude';

describe('chipsFor', () => {
  it('a card: the old Ask Claude chips (askQuickActions is the same function)', () => {
    expect(askQuickActions).toBe(cardChips);
    const ids = chipsFor({ kind: 'card' }, { language: 'zh', hasSentence: true }).map((c) => c.id);
    expect(ids).toEqual(['sentences', 'characters', 'related', 'grammar', 'fun_fact', 'sentence']);
    // The context's typed answer offers "Check my answer".
    expect(chipsFor({ kind: 'card', typed: { answer: '银航' } }, { language: 'en' }).map((c) => c.id)).toContain('check_answer');
  });

  it('general / chat message chips; a role-play: the three help chips, every time, 🆘 into the box', () => {
    expect(chipsFor({ kind: 'general' }, { language: 'zh' }).map((c) => c.id)).toEqual(['phrase', 'quiz', 'story']);
    expect(chipsFor({ kind: 'general' }, { language: 'en' })[0].label).toBe('A useful phrase');
    expect(chipsFor({ kind: 'chat_message' }, { language: 'en' }).map((c) => c.id)).toEqual(['meaning', 'natural', 'reply', 'cards']);
    const help = chipsFor({ kind: 'practice' }, { language: 'zh', started: true, used: ['hint', 'say', 'correct'] });
    expect(help.map((c) => [c.id, !!c.fill])).toEqual([['hint', false], ['say', true], ['correct', false]]);
    expect(help[0].question.startsWith('💡')).toBe(true);
    expect(chipsFor({ kind: 'practice' }, { language: 'en' })[1]).toEqual({ id: 'say', label: '🆘 How do I say…', question: '🆘 How do I say: ', fill: true });
  });

  it('once the thread has a message: no chips (a role-play keeps its help chips); never one already used', () => {
    expect(chipsFor({ kind: 'card' }, { language: 'zh', hasSentence: true, started: true })).toEqual([]);
    expect(chipsFor({ kind: 'reader' }, { language: 'en', started: true })).toEqual([]);
    expect(chipsFor({ kind: 'practice' }, { language: 'en', started: true })).toHaveLength(3);
    const unused = chipsFor({ kind: 'card' }, { language: 'zh', hasSentence: true, used: ['sentences'] });
    expect(unused.map((c) => c.id)).toEqual(['characters', 'related', 'grammar', 'fun_fact', 'sentence']);
  });
});

describe('composerFor', () => {
  it('a new general chat: Ask first, then the Coach buttons for the text', () => {
    expect(composerFor('general', '我昨天去了商店', { started: false })).toMatchObject({ intents: ['ask', 'check', 'explain'], primary: 'ask', enabled: true });
    expect(composerFor('general', 'How do I say hello?', { started: false }).intents).toEqual(['ask', 'translate']);
    expect(composerFor('general', '  ', { started: false })).toMatchObject({ intents: ['ask', 'check', 'explain'], enabled: false, hint: null });
  });

  it('a started general chat, a card, a chat message, a role-play: Ask only; a read-only thread: none', () => {
    expect(composerFor('general', '我昨天去了商店', { started: true })).toMatchObject({ intents: ['ask'], enabled: true, hint: null });
    expect(composerFor('card', '为什么？', { started: false }).intents).toEqual(['ask']);
    expect(composerFor('chat_message', '', { started: false }).enabled).toBe(false);
    expect(composerFor('practice', '你好', { started: true })).toMatchObject({ intents: ['ask'], primary: 'ask', enabled: true, readOnly: false });
    expect(composerFor('practice', '你好', { started: true, readOnly: true })).toMatchObject({ intents: [], primary: null, readOnly: true, hint: PRACTICE_READ_ONLY_NOTE });
  });
});

describe('headerChipFor', () => {
  it('card → the hub, chat message → the chat, practice → no link, general → none', () => {
    expect(headerChipFor({ kind: 'card', note_id: 'n1', label: '银行' })).toEqual({ icon: '📇', text: 'Asked on card · 银行', link: { kind: 'card', note_id: 'n1' } });
    expect(headerChipFor({ kind: 'chat_message', message_id: 'm1', conversation_id: 'c1' })).toEqual({
      icon: '💬',
      text: 'From a chat message',
      link: { kind: 'chat_message', message_id: 'm1', conversation_id: 'c1' },
    });
    expect(headerChipFor({ kind: 'practice', conversation_id: 'c2', scenario: '点菜' })).toEqual({ icon: '🎭', text: 'Practice · 点菜', link: null });
    expect(headerChipFor({ kind: 'general' })).toBeNull();
  });
});

describe('resumeThreadFor', () => {
  const now = Date.parse('2026-11-03T10:00:00Z');
  const t = (id: string, kind: ResumeCandidate['context_kind'], context: ResumeCandidate['context'], minsAgo: number | null, extra: Partial<ResumeCandidate> = {}): ResumeCandidate => ({
    id,
    context_kind: kind,
    context,
    last_message_at: minsAgo === null ? null : new Date(now - minsAgo * 60_000).toISOString(),
    created_at: new Date(now - 120 * 60_000).toISOString(),
    ...extra,
  });
  const card = { kind: 'card' as const, note_id: 'n1' };

  it('a card resumes its newest thread within 30 minutes', () => {
    const threads = [t('a', 'card', card, 25), t('b', 'card', card, 5), t('c', 'card', { kind: 'card', note_id: 'n2' }, 1), t('d', 'general', { kind: 'general' }, 1)];
    expect(resumeThreadFor(threads, card, now)).toBe('b');
    expect(resumeThreadFor([t('a', 'card', card, RESUME_WINDOW_MS / 60_000 + 1)], card, now)).toBeNull();
    expect(resumeThreadFor([t('a', 'card', card, 2, { archived: true })], card, now)).toBeNull();
  });

  it('general never resumes; a chat message / practice thread always does', () => {
    expect(resumeThreadFor([t('d', 'general', { kind: 'general' }, 1)], { kind: 'general' }, now)).toBeNull();
    const msg = { kind: 'chat_message' as const, message_id: 'm1' };
    expect(resumeThreadFor([t('x', 'chat_message', { ...msg, conversation_id: 'c1' }, 60 * 24 * 30)], msg, now)).toBe('x');
    // No last message: its creation time counts.
    expect(resumeThreadFor([t('p', 'practice', { kind: 'practice', conversation_id: 'c9' }, null)], { kind: 'practice', conversation_id: 'c9' }, now)).toBe('p');
    // A new role-play never resumes (each "Practice a situation" is a new scene).
    expect(resumeThreadFor([t('q', 'practice', { kind: 'practice', scenario: '点菜' }, 1)], { kind: 'practice', scenario: '点菜' }, now)).toBeNull();
  });
});

describe('claudeReplyPollMs', () => {
  it('400 ms for the first 10 s, then 1.5 s', () => {
    expect(claudeReplyPollMs(0)).toBe(CLAUDE_POLL_FAST_MS);
    expect(claudeReplyPollMs(9_999)).toBe(400);
    expect(claudeReplyPollMs(10_000)).toBe(CLAUDE_POLL_SLOW_MS);
    expect(claudeReplyPollMs(Number.NaN)).toBe(1500);
  });

  it('live events arriving: the slow safety net only', () => {
    expect(claudeReplyPollMs(1000, { open: true, sinceEventMs: 200 })).toBe(1500);
    expect(claudeReplyPollMs(1000, { open: true, sinceEventMs: null })).toBe(400);
    expect(claudeReplyPollMs(1000, { open: true, sinceEventMs: 5000 })).toBe(400);
    expect(claudeReplyPollMs(1000, { open: false, sinceEventMs: 100 })).toBe(400);
  });
});

describe('turnStatusLine', () => {
  it('names what a read tool is doing', () => {
    expect(turnStatusLine('tool', 'search_cards', 'en')).toBe('Looking through your cards…');
    expect(turnStatusLine('tool', 'get_overall_stats', 'en')).toBe('Looking at your progress…');
    expect(turnStatusLine('tool', 'other', 'zh')).toBe('在查… Looking it up…');
    expect(turnStatusLine('thinking', null, 'en')).toBe('Thinking…');
    expect(turnStatusLine('streaming', null, 'en')).toBeNull();
  });
});

describe('reader + exercise contexts', () => {
  it('reader chips: the page, its grammar, a quiz — the looked-up words first when there are any', () => {
    expect(chipsFor({ kind: 'reader' }, { language: 'en' }).map((c) => c.label)).toEqual([
      'What does this page mean?',
      'Explain the grammar in this sentence',
      'Quiz me on this page',
    ]);
    const zh = chipsFor({ kind: 'reader', looked_up: ['成都'] }, { language: 'zh' });
    expect(zh.map((c) => c.id)).toEqual(['my_words', 'page_meaning', 'grammar', 'quiz']);
    expect(zh[1].question).toBe('这一页讲的是什么？请一句一句地说一说。');
    expect(chipsFor({ kind: 'reader', said_wrong: ['都'] }, { language: 'en' })[0].id).toBe('my_words');
  });

  it('exercise chips follow the type and the checked answer', () => {
    expect(chipsFor({ kind: 'exercise', exercise_type: 'translate', answer: { verdict: 'wrong' } }, { language: 'en' }).map((c) => c.id)).toEqual(['why_wrong', 'explain', 'example', 'one_more']);
    expect(chipsFor({ kind: 'exercise', exercise_type: 'translate', answer: { verdict: 'correct' } }, { language: 'en' })[0].label).toBe('Is my answer OK?');
    expect(chipsFor({ kind: 'exercise', exercise_type: 'choice' }, { language: 'en' })[0].label).toBe('Explain the right answer');
    expect(chipsFor({ kind: 'exercise', exercise_type: 'scramble' }, { language: 'zh' })[0].label).toBe('语序 Explain the word order');
    expect(chipsFor({ kind: 'exercise', exercise_type: 'note' }, { language: 'en' })[0].label).toBe('Explain this note');
    expect(chipsFor({ kind: 'exercise' }, { language: 'en' }).map((c) => c.label)).toEqual(['Explain this exercise', 'Give me another example', 'One more like this']);
  });

  it('Ask only; the header chip links to the reader page / the lesson', () => {
    expect(composerFor('reader', '这是什么意思？', { started: false }).intents).toEqual(['ask']);
    expect(composerFor('exercise', '', { started: false })).toMatchObject({ intents: ['ask'], enabled: false });
    expect(headerChipFor({ kind: 'reader', reader_id: 'r1', page_id: 'p3', page: 3, label: '成都' })).toEqual({ icon: '📖', text: 'Reader · 成都 p.3', link: { kind: 'reader', reader_id: 'r1', page: 3 } });
    expect(headerChipFor({ kind: 'exercise', lesson_id: 'l1', exercise_key: 's0e2', label: 'Translate' })).toEqual({
      icon: '🧩',
      text: 'Exercise · Translate',
      link: { kind: 'exercise', lesson_id: 'l1', exercise_key: 's0e2' },
    });
  });

  it('resumes the same page / exercise within 30 minutes only', () => {
    const now = Date.parse('2026-11-03T10:00:00Z');
    const at = (m: number) => new Date(now - m * 60_000).toISOString();
    const threads: ResumeCandidate[] = [
      { id: 'p3', context_kind: 'reader', context: { kind: 'reader', reader_id: 'r1', page_id: 'p3' }, last_message_at: at(10), created_at: at(20) },
      { id: 'p4', context_kind: 'reader', context: { kind: 'reader', reader_id: 'r1', page_id: 'p4' }, last_message_at: at(40), created_at: at(50) },
      { id: 'e1', context_kind: 'exercise', context: { kind: 'exercise', lesson_id: 'l1', exercise_key: 's0e1' }, last_message_at: at(5), created_at: at(6) },
    ];
    expect(resumeThreadFor(threads, { kind: 'reader', reader_id: 'r1', page_id: 'p3' }, now)).toBe('p3');
    expect(resumeThreadFor(threads, { kind: 'reader', reader_id: 'r1', page_id: 'p4' }, now)).toBeNull();
    expect(resumeThreadFor(threads, { kind: 'reader', reader_id: 'r1' }, now)).toBeNull();
    expect(resumeThreadFor(threads, { kind: 'exercise', lesson_id: 'l1', exercise_key: 's0e1' }, now)).toBe('e1');
    expect(resumeThreadFor(threads, { kind: 'exercise', lesson_id: 'l1', exercise_key: 's0e2' }, now)).toBeNull();
  });
});

describe('readerPageWords', () => {
  it("one page's tapped / misread words, story order, de-duplicated; none → nothing", () => {
    const words = [
      { hanzi: '熊猫', page: 1, pos: 6, reasons: ['tapped'] },
      { hanzi: '成都', page: 1, pos: 0, reasons: ['tapped', 'said_wrong'] },
      { hanzi: '火锅', page: 2, pos: 3, reasons: ['tapped'] },
      { hanzi: '可爱', page: 1, pos: 9, reasons: ['said_wrong'] },
    ];
    expect(readerPageWords(words, 1)).toEqual({ looked_up: ['成都', '熊猫'], said_wrong: ['成都', '可爱'] });
    expect(readerPageWords(words, 2)).toEqual({ looked_up: ['火锅'] });
    expect(readerPageWords(words, 0)).toEqual({});
  });
});
