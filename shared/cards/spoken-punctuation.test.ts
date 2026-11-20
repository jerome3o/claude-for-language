/**
 * Punctuation never affects a spoken answer (Jerome, Nov 2026: "We should not have it so that punctuation affects the
 * answer"): every device-side check of a transcript ignores the recogniser's marks — ASCII or full-width, curly quotes,
 * tildes, dashes, corner brackets, spaces — and the diff never marks one as wrong / extra / missing.
 */
import { describe, expect, it } from 'vitest';
import { checkSpokenAnswer, checkTypedAnswer, scrubSpokenTranscript, spokenAnswerWithin } from './answer';
import { answerDiff, answerDiffSummary } from './answer-diff';
import { spokenResult } from './spoken-result';
import { hanziAnswerKey, stripAnswerPunctuation } from '../text/numberHanzi';
import { practiseSentence } from '../coach/practise';
import { judgeReadAloud } from '../reader/readAloud';
import { sameAnswerWords } from '../study/answerDifference';

const PUNCTUATED = [
  '我去。', '我去', '我去！', '我去!', '我去？', '我去?', '我去.', '“我去”', '‘我去’', '"我去"', '「我去」', '『我去』', '〈我去〉',
  '我去～', '我去~', '我去—', '我去——', '我去…', '我去⋯', '我去...', '我，去', '我, 去', '我 去', '我　去', ' 我去 ', '我・去', '我去﹗',
];

describe('a recogniser’s punctuation never makes a spoken answer wrong', () => {
  it('checkSpokenAnswer: every punctuated form of the answer is right, and not “by sound”', () => {
    for (const said of PUNCTUATED) {
      const v = checkSpokenAnswer(said, '我去');
      expect(['exact', 'punctuation_only'], said).toContain(v);
    }
  });

  it('the typed check and the answer key ignore the same marks (curly quotes, tildes, dashes, corner brackets)', () => {
    for (const said of PUNCTUATED) {
      expect(checkTypedAnswer(said, '我去。'), said).not.toBe('wrong');
      expect(hanziAnswerKey(said), said).toBe('我去');
      expect(stripAnswerPunctuation(said), said).toBe('我去');
    }
  });

  it('a percent sign is never punctuation (50% is not 50)', () => {
    expect(checkTypedAnswer('50%', '50')).toBe('wrong');
    expect(stripAnswerPunctuation('50％')).toBe('50％');
  });

  it('the diff never marks punctuation (either side) as wrong / extra / missing', () => {
    for (const said of PUNCTUATED) {
      for (const expected of ['我去', '我去。', '我去！']) {
        const d = answerDiff(said, expected);
        expect(d.right, `${said} / ${expected}`).toBe(true);
        expect(answerDiffSummary(d), `${said} / ${expected}`).toBe('Right');
        expect(d.parts.filter((p) => p.kind !== 'ok' && p.kind !== 'plain'), `${said} / ${expected}`).toEqual([]);
      }
    }
  });

  it('the "You said" row: Match, no marked characters', () => {
    for (const said of PUNCTUATED) {
      const r = spokenResult(said, '我去', checkSpokenAnswer(said, '我去'));
      expect(r.state, said).toBe('match');
      expect(r.chars.filter((c) => c.mark !== 'right' && c.mark !== 'plain'), said).toEqual([]);
    }
  });

  it('a sentence said with pauses: the Sentence round / Coach practise counts it right', () => {
    for (const said of ['我不知道。 我妹妹有没有新电脑。', '我不知道，我妹妹有没有新电脑？', '“我不知道我妹妹有没有新电脑”', '我不知道——我妹妹有没有新电脑～']) {
      expect(practiseSentence(said, '我不知道我妹妹有没有新电脑。').result.accepted, said).toBe(true);
    }
  });

  it('the answer said inside a punctuated sentence is still found', () => {
    expect(spokenAnswerWithin('“他长得，很好”。', '长得')).toBe('hanzi');
  });

  it('a page read aloud: punctuation in the transcript is never extra', () => {
    const r = judgeReadAloud('我去北京。', '“我去，北京”！');
    expect(r.toCheck).toBe(0);
    expect(r.pct).toBe(100);
  });

  it('accepted-but-different: punctuation alone is never a difference', () => {
    expect(sameAnswerWords('“我去”～', '我去。')).toBe(true);
    expect(sameAnswerWords('我去——北京', '我去北京')).toBe(true);
  });

  it('scrubSpokenTranscript: dashes, ⋯, ・ and small-form marks go too', () => {
    expect(scrubSpokenTranscript('我想去——北京⋯⋯')).toBe('我想去北京');
    expect(scrubSpokenTranscript('你好﹐我是・小明')).toBe('你好我是小明');
    expect(scrubSpokenTranscript('我有 3.5 块—好吗')).toBe('我有3.5块好吗');
  });
});
