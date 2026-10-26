import { describe, it, expect } from 'vitest';
import {
  differenceLines, questionDifference, roundTakeDifference, sameAnswerWords, DIFFERENCE_TITLE,
} from './answerDifference';
import { sentenceTake } from './sentencePractise';

const take = (mode: 'read' | 'translate', said: string, model: string, claude: Parameters<typeof roundTakeDifference>[0]['claude'] = null) =>
  roundTakeDifference({ mode, said, model, local: sentenceTake(mode, said, model).practised.result.state, claude });

describe('sameAnswerWords', () => {
  it('ignores punctuation, spaces, numbers ↔ hanzi and 两 / 二', () => {
    expect(sameAnswerWords('我明天去北京。', '我明天去北京')).toBe(true);
    expect(sameAnswerWords('我 明天 去 北京！', '我明天去北京。')).toBe(true);
    expect(sameAnswerWords('我有3本书', '我有三本书')).toBe(true);
    expect(sameAnswerWords('我明天要去北京', '我明天去北京')).toBe(false);
  });
});

describe('roundTakeDifference', () => {
  it('holds a translate take Claude called acceptable, or correct in other words', () => {
    expect(take('translate', '我明天要去北京', '我明天去北京', 'acceptable')).toBe('acceptable');
    expect(take('translate', '明天我去北京', '我明天去北京', 'correct')).toBe('reworded');
    // correct and the same words (only punctuation apart): no hold
    expect(roundTakeDifference({ mode: 'translate', said: '我明天去北京！', model: '我明天去北京。', local: 'wrong', claude: 'correct' })).toBeNull();
  });
  it('never holds almost / wrong (they keep Try again) or an identical take', () => {
    expect(take('translate', '我昨天去北京', '我明天去北京', 'almost')).toBeNull();
    expect(take('translate', '你好', '我明天去北京', 'wrong')).toBeNull();
    expect(take('translate', '我明天去北京。', '我明天去北京')).toBeNull();
  });
  it('holds a translate take right by sound only (other characters)', () => {
    expect(take('translate', '他在游泳', '她在游泳')).toBe('homophone');
  });
  it('never holds a read take (other characters are the recogniser’s)', () => {
    expect(take('read', '他在游泳', '她在游泳')).toBeNull();
    expect(take('read', '我明天要去北京', '我明天去北京', 'acceptable')).toBeNull();
  });
});

describe('questionDifference', () => {
  it('holds a homophone or a listed alternative; exact / equivalent / contains go on', () => {
    expect(questionDifference('sound')).toBe('homophone');
    expect(questionDifference('alternative')).toBe('alternative');
    for (const v of ['exact', 'punctuation_only', 'equivalent', 'contains', 'close', 'wrong', null] as const) expect(questionDifference(v)).toBeNull();
    expect(DIFFERENCE_TITLE.homophone).toBe('✓ Sounded right — written differently');
  });
});

describe('differenceLines', () => {
  it('marks the characters each line has that the other has not', () => {
    const accepted = differenceLines('我明天要去北京', '我明天去北京。', true);
    expect(accepted.said.filter((c) => c.mark === 'differs').map((c) => c.char).join('')).toBe('要');
    expect(accepted.model.filter((c) => c.mark === 'differs').map((c) => c.char)).toEqual([]);
    expect(accepted.model.at(-1)).toEqual({ char: '。', mark: 'plain' });
    const wrong = differenceLines('我昨天去北京', '我明天去北京', false);
    expect(wrong.said.filter((c) => c.mark === 'wrong').map((c) => c.char).join('')).toBe('昨');
    expect(wrong.model.filter((c) => c.mark === 'differs').map((c) => c.char).join('')).toBe('明');
  });
});
