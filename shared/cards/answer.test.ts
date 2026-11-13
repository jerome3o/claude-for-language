import { describe, expect, it } from 'vitest';
import {
  checkSpokenAnswer,
  droppedFunctionChar,
  checkTypedAnswer,
  isAcceptedVerdict,
  normalizeSpokenPinyin,
  spokenAnswerWithin,
  spokenPinyinKey,
  spokenSyllables,
  spokenVerdictNote,
  tidySpokenTranscript,
  tonelessPinyin,
} from './answer';
import { practiseSentence } from '../coach/practise';

describe('tidySpokenTranscript', () => {
  it("drops the recogniser's trailing 。 on a word card, its pinyin too", () => {
    expect(tidySpokenTranscript('撤销。', '撤销')).toBe('撤销');
    expect(tidySpokenTranscript('chè xiāo。', '撤销')).toBe('chè xiāo');
    expect(tidySpokenTranscript(' 好的！！ ', '好的')).toBe('好的');
    expect(tidySpokenTranscript('再见…', '再见')).toBe('再见');
    expect(tidySpokenTranscript('。', '撤销')).toBe('');
  });
  it('keeps it when the answer is a sentence ending in punctuation', () => {
    expect(tidySpokenTranscript('你好吗？', '你好吗？')).toBe('你好吗？');
    expect(tidySpokenTranscript('他来了。', '他来了！')).toBe('他来了。');
  });
  it('a pause is never a sentence break: the 。 / ， / spaces between two characters go when the answer has none inside', () => {
    // Jerome's 虾饺 take: he paused before 点心.
    expect(tidySpokenTranscript('虾饺我最喜欢的。 点心。', '虾饺是我最喜欢的点心。')).toBe('虾饺我最喜欢的点心。');
    expect(tidySpokenTranscript('撤。销', '撤销')).toBe('撤销');
    expect(tidySpokenTranscript('我 想 去，银行', '我想去银行')).toBe('我想去银行');
    // The answer has a comma inside: the transcript's marks stay (the check ignores them anyway).
    expect(tidySpokenTranscript('你好， 我是小明', '你好，我是小明')).toBe('你好， 我是小明');
    // Latin words keep their spaces.
    expect(tidySpokenTranscript('我想 order 一个 coffee', '我想点一个咖啡')).toBe('我想 order 一个 coffee');
  });
  it('a tidied answer checks exact instead of punctuation-only', () => {
    expect(checkSpokenAnswer('撤销。', '撤销')).toBe('punctuation_only');
    expect(checkSpokenAnswer(tidySpokenTranscript('撤销。', '撤销'), '撤销')).toBe('exact');
  });
});

describe('checkTypedAnswer (the AnswerDiff decision)', () => {
  it('exact, punctuation-only, equivalent, alternative, wrong', () => {
    expect(checkTypedAnswer('你好', '你好')).toBe('exact');
    expect(checkTypedAnswer(' 你好 ', '你好')).toBe('exact');
    expect(checkTypedAnswer('你好', '你好。')).toBe('punctuation_only');
    expect(checkTypedAnswer('7个', '七个')).toBe('equivalent');
    expect(checkTypedAnswer('两个', '二个')).toBe('equivalent');
    expect(checkTypedAnswer('您好', '你好', ['您好'])).toBe('alternative');
    expect(checkTypedAnswer('你号', '你好')).toBe('wrong');
  });

  it('never gives the spoken verdicts', () => {
    expect(checkTypedAnswer('油', '由')).toBe('wrong');
  });
});

describe('checkSpokenAnswer', () => {
  it('a homophone counts by sound', () => {
    expect(checkSpokenAnswer('油', '由')).toBe('sound');
    expect(checkSpokenAnswer('游', '由')).toBe('sound');
    expect(checkSpokenAnswer('她是我的朋友', '他是我的朋友')).toBe('sound');
    expect(checkSpokenAnswer('银航', '银行')).toBe('sound');
  });

  it('exact hanzi stay exact; punctuation the recogniser adds is ignored', () => {
    expect(checkSpokenAnswer('由', '由')).toBe('exact');
    expect(checkSpokenAnswer('你好。', '你好')).toBe('punctuation_only');
    expect(checkSpokenAnswer('我有七个', '我有7个')).toBe('equivalent');
    expect(checkSpokenAnswer('您好', '你好', ['您好'])).toBe('alternative');
  });

  it('other tones are close (still wrong), other syllables wrong', () => {
    expect(checkSpokenAnswer('有', '由')).toBe('close');
    expect(checkSpokenAnswer('买', '卖')).toBe('close');
    expect(checkSpokenAnswer('猫', '狗')).toBe('wrong');
    expect(isAcceptedVerdict('close')).toBe(false);
    expect(isAcceptedVerdict('sound')).toBe(true);
  });

  it('the note pinyin is a target too (a polyphone the automatic pinyin reads otherwise)', () => {
    // 长 alone reads cháng; the card says zhǎng ("to grow").
    expect(checkSpokenAnswer('涨', '长')).toBe('wrong');
    expect(checkSpokenAnswer('涨', '长', [], 'zhǎng')).toBe('sound');
  });

  it('the 一 / 不 tone changes are applied on both sides', () => {
    expect(spokenPinyinKey('一个')).toBe('yígè');
    expect(spokenPinyinKey('不是')).toBe('búshì');
    expect(checkSpokenAnswer('衣个', '一个')).toBe('close');
  });

  it('nothing Chinese heard is wrong, never by sound', () => {
    expect(checkSpokenAnswer('', '由')).toBe('wrong');
    expect(checkSpokenAnswer('you', '由')).toBe('wrong');
    expect(checkSpokenAnswer('ma', '吗')).toBe('wrong');
  });
});

describe('one little word the recogniser dropped (dropped — a sentence said right, 是 / 的 / 了 swallowed)', () => {
  const XIAJIAO = '虾饺是我最喜欢的点心。';
  it("Jerome's 虾饺 take: the pause and the swallowed 是 count as right", () => {
    const said = tidySpokenTranscript('虾饺我最喜欢的。 点心。', XIAJIAO);
    expect(said).toBe('虾饺我最喜欢的点心。');
    expect(droppedFunctionChar(said, XIAJIAO)).toBe('是');
    // Saying a sentence aloud (the Sentence round, the rows, the Coach) counts it right…
    expect(practiseSentence('虾饺我最喜欢的。 点心。', XIAJIAO).verdict).toBe('dropped');
    expect(practiseSentence('虾饺我最喜欢的。 点心。', XIAJIAO).result.state).toBe('match');
    expect(isAcceptedVerdict('dropped')).toBe(true);
    expect(spokenVerdictNote('dropped', XIAJIAO)).toBe('Right ✓ — one small word wasn’t caught: 虾饺是我最喜欢的点心。');
    // …but the typing cards' / lessons' own check doesn't (a lesson's point may be the 了).
    expect(checkSpokenAnswer(said, XIAJIAO)).toBe('wrong');
  });
  it('by sound too (a homophone elsewhere), and 的 / 了 / 一', () => {
    expect(droppedFunctionChar('我去银航', '我去了银行')).toBe('了');
    expect(droppedFunctionChar('这是我书', '这是我的书')).toBe('的');
    expect(droppedFunctionChar('我买了本书', '我买了一本书')).toBe('一');
    expect(practiseSentence('我去银航', '我去了银行').verdict).toBe('dropped');
  });
  it('stays honest: a content word, a negation, two words, a short answer', () => {
    expect(practiseSentence('虾饺我喜欢的点心', XIAJIAO).verdict).toBe('wrong'); // 最 is a content word (and 是 too)
    expect(practiseSentence('虾饺是我喜欢的点心', XIAJIAO).verdict).toBe('wrong'); // 最 is a content word
    expect(practiseSentence('虾饺我最喜欢点心', XIAJIAO).verdict).toBe('wrong'); // two words missing
    expect(practiseSentence('我想去', '我不想去').verdict).toBe('wrong'); // 不 is never a little word
    expect(practiseSentence('好', '好的').verdict).toBe('wrong'); // a word, not a sentence
    expect(practiseSentence('我去银行', '我去银行。').verdict).toBe('punctuation_only');
    expect(droppedFunctionChar('我去银行', '我去银行')).toBeNull();
    expect(droppedFunctionChar('I go 银行', '我去了银行')).toBeNull();
  });
});

describe('pinyin helpers', () => {
  it('normalises and strips tones', () => {
    expect(normalizeSpokenPinyin("Xī'ān, nǚ ér")).toBe('xīānnǚér');
    expect(tonelessPinyin('xīānnǚér')).toBe('xiannüer');
  });

  it('the note line', () => {
    expect(spokenVerdictNote('sound', '由')).toBe('Sounded right ✓ — written 由');
    expect(spokenVerdictNote('close', '由')).toBe('Close — the tones are off');
    expect(spokenVerdictNote('exact', '由')).toBeNull();
  });
});

describe('spoken answer inside a sentence (contains — the read card rule)', () => {
  it('the word said inside a sentence counts (Jerome: 他长得很好。 for 长得)', () => {
    expect(checkSpokenAnswer('他长得很好。', '长得', [], 'zhǎngde')).toBe('contains');
    expect(spokenAnswerWithin('他长得很好。', '长得')).toBe('hanzi');
    expect(isAcceptedVerdict('contains')).toBe(true);
    expect(spokenVerdictNote('contains', '长得')).toBeNull();
  });

  it('an alternative inside the sentence counts; numbers / punctuation / traditional are normalised', () => {
    expect(checkSpokenAnswer('老师您好！', '你好', ['您好'])).toBe('contains');
    expect(checkSpokenAnswer('我有7个苹果', '七个')).toBe('contains');
    expect(checkSpokenAnswer('我想去銀行', '银行')).toBe('contains');
  });

  it('a homophone window inside the sentence counts by sound', () => {
    expect(spokenAnswerWithin('我想去银航取钱', '银行')).toBe('sound');
    expect(checkSpokenAnswer('我想去银航取钱', '银行')).toBe('contains');
  });

  it('a neutral syllable of the answer matches any tone (得 de vs the automatic dé)', () => {
    // 涨得 reads zhǎng dé; the card's own pinyin zhǎng de has a neutral de.
    expect(checkSpokenAnswer('涨得', '长得', [], 'zhǎng de')).toBe('sound');
    expect(checkSpokenAnswer('他涨得很好', '长得', [], 'zhǎng de')).toBe('contains');
    // An all-neutral answer gets no allowance: 妈 is not 吗.
    expect(checkSpokenAnswer('妈', '吗')).toBe('close');
    // Pinyin written without any tone mark never accepts every tone.
    expect(checkSpokenAnswer('涨得', '长得', [], 'zhang de')).not.toBe('sound');
  });

  it('a one-character answer inside a long sentence counts, like on the read card', () => {
    expect(checkSpokenAnswer('我今天很好', '好')).toBe('contains');
    expect(checkSpokenAnswer('我想去游泳', '由')).toBe('contains');
  });

  it('the word not said stays wrong (or close)', () => {
    expect(checkSpokenAnswer('他很高', '长得', [], 'zhǎngde')).toBe('wrong');
    expect(spokenAnswerWithin('他很高', '长得', [], 'zhǎngde')).toBeNull();
    expect(checkSpokenAnswer('有', '由')).toBe('close');
    expect(spokenAnswerWithin('you are', '由')).toBeNull();
  });

  it('syllables per character with the 一 / 不 tone changes; null for a non-Han character', () => {
    expect(spokenSyllables('他长得很好。')).toEqual(['tā', 'cháng', 'dé', 'hěn', 'hǎo']);
    expect(spokenSyllables('一个')).toEqual(['yí', 'gè']);
    expect(spokenSyllables('ok你')).toEqual([null, null, 'nǐ']);
  });
});
