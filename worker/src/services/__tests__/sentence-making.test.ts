import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { checkMadeSentence, fixMadeSentence, SENTENCE_CHECK_SYSTEM, SENTENCE_FIX_SYSTEM } from '../sentence-making';
import { fakeSentenceMakingClient } from '../sentence-making-fake';
import { normalizeSentenceFeedback } from '@shared/lesson/sentenceCheck';

function fakeClient(inputs: unknown[], name = 'check_sentence') {
  const calls: Array<Record<string, any>> = [];
  const client = {
    messages: {
      create: async (params: Record<string, any>) => {
        calls.push(params);
        const input = inputs.shift();
        return { stop_reason: 'tool_use', usage: { output_tokens: 5 }, content: [{ type: 'tool_use', id: 't', name, input }] };
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>;
  return { client, calls };
}

/** An in-memory `lesson_answer_checks` (only the two statements the service runs). */
function fakeDb() {
  const rows = new Map<string, string>();
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => (sql.startsWith('SELECT') && rows.has(`${args[0]}:${args[1]}`) ? { check_json: rows.get(`${args[0]}:${args[1]}`) } : null),
        run: async () => { rows.set(`${args[0]}:${args[1]}`, String(args[4])); return {}; },
      }),
    }),
  } as unknown as D1Database;
  return { db, rows };
}

const input = { words: ['因为', '所以'], task: 'Why were you late?', sentence: '因为堵车，所以我迟到了。' };

describe('sentence making check', () => {
  it('forces the tool with thinking off, a short budget, and passes words + task', async () => {
    const { client, calls } = fakeClient([{ grade: 'right', headline: 'Natural and correct', fixable: false, uses_all_words: true }]);
    const { feedback } = await checkMadeSentence(null, input, { apiKey: 'k', client });
    expect(feedback).toMatchObject({ verdict: 'correct', grade: 'right', headline: 'Natural and correct', fixable: false, uses_all_words: true });
    expect(feedback.corrected).toBeUndefined();
    expect(calls[0].thinking).toEqual({ type: 'disabled' });
    expect(calls[0].tool_choice).toEqual({ type: 'tool', name: 'check_sentence' });
    expect(calls[0].max_tokens).toBeLessThanOrEqual(600);
    expect(calls[0].messages[0].content).toContain('因为、所以');
    expect(calls[0].messages[0].content).toContain('Why were you late?');
  });

  it('asks for a grade + headline, never a corrected sentence, and says how to read a transcript', () => {
    expect(SENTENCE_CHECK_SYSTEM).toMatch(/needs_work/);
    expect(SENTENCE_CHECK_SYSTEM).toMatch(/Do NOT write a corrected sentence/);
    expect(SENTENCE_CHECK_SYSTEM).toMatch(/ONE continuous utterance/);
    expect(SENTENCE_CHECK_SYSTEM).toMatch(/never judge them/);
    expect(SENTENCE_FIX_SYSTEM).toMatch(/SMALLEST edits/);
  });

  it('Jerome\'s 本来…要 sentence: a green verdict over a correction becomes needs_work', async () => {
    const { client } = fakeClient([{
      grade: 'right', headline: 'Natural and correct',
      reason: 'Good use of 本来…要 to set up the original plan; but the second clause just states another plan rather than an actual interrupting event, so it should show what really happened, e.g. with 结果 or 可是…了. Also 健身馆 is usually 健身房.',
      fixable: true, uses_all_words: true,
    }]);
    const { feedback } = await checkMadeSentence(null, { words: ['本来', '要'], sentence: '我本来要去健身馆，但是我学中文。' }, { apiKey: 'k', client });
    expect(feedback.grade).toBe('needs_work');
    expect(feedback.verdict).toBe('minor');
    expect(feedback.headline).toBe('本来 and 要 used right — one thing to fix');
    expect(feedback.reason).toMatch(/^The second clause just states another plan/);
  });

  it('a missing target word is wrong whatever the model says', () => {
    const fb = normalizeSentenceFeedback({ grade: 'right', headline: 'Natural', fixable: false, uses_all_words: true }, { ...input, sentence: '因为堵车我迟到了。' });
    expect(fb.grade).toBe('wrong');
    expect(fb.uses_all_words).toBe(false);
  });

  it('rejects a reply without a grade (retried by structuredCall)', () => {
    expect(() => normalizeSentenceFeedback({ headline: 'hm' }, input)).toThrow();
  });

  it('caches the check by words + task + sentence (punctuation aside)', async () => {
    const { db, rows } = fakeDb();
    const { client, calls } = fakeClient([{ grade: 'right', headline: 'Natural and correct', fixable: false, uses_all_words: true }]);
    const first = await checkMadeSentence(db, input, { apiKey: 'k', client });
    const again = await checkMadeSentence(db, { ...input, sentence: '因为堵车 所以我迟到了' }, { apiKey: 'k', client });
    expect(first.cached).toBe(false);
    expect(again.cached).toBe(true);
    expect(again.feedback.grade).toBe('right');
    expect(calls).toHaveLength(1);
    expect(rows.size).toBe(1);
  });

  it('a spoken sentence is checked as one utterance (the transcript note in the turn)', async () => {
    const { client, calls } = fakeClient([{ grade: 'right', headline: 'Natural and correct', fixable: false, uses_all_words: true }]);
    await checkMadeSentence(null, { words: ['不知道'], sentence: '我不知道我妹妹在哪儿', input: 'spoken' }, { apiKey: 'k', client });
    expect(calls[0].messages[0].content).toContain('SPOKEN');
  });
});

describe('sentence making fix', () => {
  it('fixes HIS sentence, pinyin made by the app, cached', async () => {
    const { db } = fakeDb();
    const { client, calls } = fakeClient([{ hanzi: '我本来要去健身房，可是后来去学中文了。', english: 'x' }], 'fix_sentence');
    const i = { words: ['本来', '要'], sentence: '我本来要去健身馆，但是我学中文。' };
    const { fix } = await fixMadeSentence(db, i, { apiKey: 'k', client });
    expect(fix.hanzi).toBe('我本来要去健身房，可是后来去学中文了。');
    expect(fix.pinyin).toMatch(/běn/); // none from the model → the app's own
    expect(calls[0].tool_choice).toEqual({ type: 'tool', name: 'fix_sentence' });
    const again = await fixMadeSentence(db, i, { apiKey: 'k', client });
    expect(again.cached).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('a "fix" that is his own sentence is retried, never shown', async () => {
    const { client, calls } = fakeClient([{ hanzi: '我本来要去健身馆但是我学中文', english: 'x' }, { hanzi: '我本来要去健身房，可是后来去学中文了。', english: 'y' }], 'fix_sentence');
    const { fix } = await fixMadeSentence(null, { words: ['本来', '要'], sentence: '我本来要去健身馆，但是我学中文。' }, { apiKey: 'k', client });
    expect(fix.hanzi).toBe('我本来要去健身房，可是后来去学中文了。');
    expect(calls).toHaveLength(2);
  });
});

describe('the E2E stand-in', () => {
  const deps = { apiKey: 'e2e', client: fakeSentenceMakingClient() };
  it('本来…要 + 健身馆 → needs_work; its fix', async () => {
    const i = { words: ['本来', '要'], sentence: '我本来要去健身馆，但是我学中文。' };
    expect((await checkMadeSentence(null, i, deps)).feedback.grade).toBe('needs_work');
    expect((await fixMadeSentence(null, i, deps)).fix.hanzi).toBe('我本来要去健身房，可是后来去学中文了。');
  });
  it('a right sentence after Try again', async () => {
    const r = await checkMadeSentence(null, { words: ['本来', '要'], sentence: '我本来要去健身房，可是后来下雨了。' }, deps);
    expect(r.feedback.grade).toBe('right');
  });
  it('the paused 不知道 / 有没有 take: needs_work on 不有 only, never the sentence split', async () => {
    const r = await checkMadeSentence(null, { words: ['不知道', '有没有'], sentence: '我不知道我妹妹有不有新电脑', input: 'spoken' }, deps);
    expect(r.feedback.grade).toBe('needs_work');
    expect(`${r.feedback.headline} ${r.feedback.reason}`).not.toMatch(/sentence|split|punctuation/i);
  });
});
