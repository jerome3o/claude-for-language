import { describe, expect, it } from 'vitest';
import { applyYiBuToneChanges, syllableTone } from './toneChange';

/** hanzi, raw pinyin (no tone changes, as written in a dictionary), expected. */
const TABLE: Array<[string, string, string]> = [
  ['一个', 'yī gè', 'yí gè'],
  ['一样', 'yī yàng', 'yí yàng'],
  ['一起', 'yī qǐ', 'yì qǐ'],
  ['一天', 'yī tiān', 'yì tiān'],
  ['一年', 'yī nián', 'yì nián'],
  ['第一', 'dì yī', 'dì yī'],
  ['十一', 'shí yī', 'shí yī'],
  ['一月一日', 'yī yuè yī rì', 'yī yuè yī rì'],
  ['看一看', 'kàn yī kàn', 'kàn yi kàn'],
  ['不是', 'bù shì', 'bú shì'],
  ['不对', 'bù duì', 'bú duì'],
  ['不好', 'bù hǎo', 'bù hǎo'],
  ['不去', 'bù qù', 'bú qù'],
  ['对不起', 'duì bù qǐ', 'duì bù qǐ'],
  ['差不多', 'chà bù duō', 'chà bù duō'],
  ['要不要', 'yào bù yào', 'yào bu yào'],
  // more
  ['一', 'yī', 'yī'],
  ['统一', 'tǒng yī', 'tǒng yī'],
  ['统一了', 'tǒng yī le', 'tǒng yī le'],
  ['星期一的', 'xīng qī yī de', 'xīng qī yī de'],
  ['第一个', 'dì yī gè', 'dì yī gè'],
  ['一楼', 'yī lóu', 'yī lóu'],
  ['一年级', 'yī nián jí', 'yī nián jí'],
  ['一二三', 'yī èr sān', 'yī èr sān'],
  ['一百', 'yī bǎi', 'yì bǎi'],
  ['一万', 'yī wàn', 'yí wàn'],
  ['不一样', 'bù yī yàng', 'bù yí yàng'],
  ['一不小心', 'yī bù xiǎo xīn', 'yí bù xiǎo xīn'],
  ['一模一样', 'yī mú yī yàng', 'yì mú yí yàng'],
  ['这是一本书。', 'zhè shì yī běn shū.', 'zhè shì yì běn shū.'],
  ['一，二', 'yī, èr', 'yī, èr'],
  ['不客气', 'bù kè qì', 'bú kè qì'],
  ['好不好', 'hǎo bù hǎo', 'hǎo bu hǎo'],
  ['你好', 'nǐ hǎo', 'nǐ hǎo'],
  ['一点儿', 'yī diǎn ér', 'yì diǎn ér'],
  ['一点儿', 'yīdiǎnr', 'yìdiǎnr'],
  ['一个人', 'yí ge rén', 'yí ge rén'],
  ['一个', 'yī ge', 'yí ge'],
];

describe('applyYiBuToneChanges', () => {
  it.each(TABLE)('%s: %s → %s', (hanzi, raw, expected) => {
    expect(applyYiBuToneChanges(hanzi, raw)).toBe(expected);
  });

  it('works on joined words and keeps capitals', () => {
    expect(applyYiBuToneChanges('一样', 'yīyàng')).toBe('yíyàng');
    expect(applyYiBuToneChanges('不是我。', 'Bù shì wǒ.')).toBe('Bú shì wǒ.');
    expect(applyYiBuToneChanges('我不是学生', 'wǒ bùshì xuéshēng')).toBe('wǒ búshì xuéshēng');
  });

  it('leaves written neutral tones and already-right pinyin alone', () => {
    expect(applyYiBuToneChanges('对不起', 'duìbuqǐ')).toBe('duìbuqǐ');
    expect(applyYiBuToneChanges('看一看', 'kàn yi kàn')).toBe('kàn yi kàn');
    expect(applyYiBuToneChanges('一样', 'yíyàng')).toBe('yíyàng');
  });

  it('fixes a wrong tone change too', () => {
    expect(applyYiBuToneChanges('一天', 'yí tiān')).toBe('yì tiān');
    expect(applyYiBuToneChanges('不好', 'bú hǎo')).toBe('bù hǎo');
  });

  it('never applies third-tone sandhi', () => {
    expect(applyYiBuToneChanges('我也不好', 'wǒ yě bù hǎo')).toBe('wǒ yě bù hǎo');
  });

  it('returns the input when it cannot line up', () => {
    expect(applyYiBuToneChanges('一个', 'yi1 ge4')).toBe('yi1 ge4');
    expect(applyYiBuToneChanges('一个人', 'yī gè')).toBe('yī gè');
    expect(applyYiBuToneChanges('A一个', 'A yī gè')).toBe('A yī gè');
    expect(applyYiBuToneChanges('一个', 'hello world')).toBe('hello world');
    expect(applyYiBuToneChanges('你好', 'nǐ hǎo')).toBe('nǐ hǎo');
    expect(applyYiBuToneChanges('', '')).toBe('');
  });

  it('agrees with pinyin-pro output (already tone-changed) on common words', () => {
    expect(applyYiBuToneChanges('一会儿', 'yí huì er')).toBe('yí huì er');
    expect(applyYiBuToneChanges('一直', 'yì zhí')).toBe('yì zhí');
  });

  it('reads tones', () => {
    expect(syllableTone('mā')).toBe(1);
    expect(syllableTone('ma')).toBe(5);
    expect(syllableTone('lǜ')).toBe(4);
  });
});
