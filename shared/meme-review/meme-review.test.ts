import { describe, expect, it } from 'vitest';
import { pinyin } from 'pinyin-pro';
import { applyYiBuToneChanges } from '../pinyin/toneChange';
import {
  SAMPLE_MEME_SEEN_URLS,
  SAMPLE_MEME_SUBMISSION,
  coverageWindow,
  isMemeMonth,
  memeAudioLines,
  memeCardFields,
  memeCoversLabel,
  memeLinkLabel,
  memeMonthLabel,
  memeMonthLabelZh,
  memeMonthOf,
  memeQuizScoreLine,
  memeRegisterChips,
  memeVerdictLabel,
  parseStoredMemeIssue,
  platformOf,
  rederivePinyin,
  urlKey,
  validateMemeIssue,
  youtubeThumbnail,
  type DerivePinyin,
} from './index';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** The app's path (worker podcasts/segments.ts pinyinLine, minus tidying). */
const derive: DerivePinyin = (text) =>
  /\p{Script=Han}/u.test(text) ? applyYiBuToneChanges(text, pinyin(text, { toneType: 'symbol', type: 'string', nonZh: 'consecutive' })) : null;

const ctx = { month: '2026-10', today: '2026-10-18', seenUrls: SAMPLE_MEME_SEEN_URLS, derivePinyin: derive };

describe('validateMemeIssue', () => {
  it('accepts the sample, numbering items and working out platforms', () => {
    const { issue, problems, notes } = validateMemeIssue(SAMPLE_MEME_SUBMISSION, ctx);
    expect(problems).toEqual([]);
    expect(issue).not.toBeNull();
    expect(issue!.items.map((i) => i.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
    expect(issue!.covers).toEqual({ from: '2026-08-23', to: '2026-10-18' });
    const city = issue!.items[0];
    expect(city.media.map((m) => [m.platform, m.kind])).toEqual([['bilibili', 'video'], ['youtube', 'video']]);
    expect(city.media[1].thumbnail_url).toBe('https://img.youtube.com/vi/sampleVid01/hqdefault.jpg');
    expect(city.media[0].thumbnail_url).toBeNull();
    expect(issue!.quiz).toHaveLength(4);
    expect(issue!.quiz[0].item_id).toBe('m1');
    // The made-up URL in 情绪价值's sources was dropped, with a note saying why.
    const emo = issue!.items.find((i) => i.hanzi === '情绪价值')!;
    expect(emo.sources.map((s) => s.platform)).toEqual(['baidu', 'news']);
    expect(notes.some((n) => n.includes('example.com') && n.includes('not in your search'))).toBe(true);
  });

  it('only keeps URLs the tools returned (scheme, www, tracking params and slashes do not count)', () => {
    const raw = clone(SAMPLE_MEME_SUBMISSION);
    raw.items[0].sources = [
      { url: 'http://baike.baidu.com/item/City不City/64306284/#history', title: 'same page' },
      { url: 'https://baike.baidu.com/item/City不City/99999999', title: 'never returned' },
    ];
    const { issue, notes } = validateMemeIssue(raw, ctx);
    expect(issue!.items[0].sources).toHaveLength(1);
    expect(notes.some((n) => n.includes('99999999'))).toBe(true);
  });

  it('drops an item whose every source is invented, and refuses an issue that falls under six items', () => {
    const raw = clone(SAMPLE_MEME_SUBMISSION);
    raw.items[1].sources = [{ url: 'https://zh.wikipedia.org/wiki/搭子', title: 'from memory' }];
    const { issue, problems, notes } = validateMemeIssue(raw, ctx);
    expect(issue).toBeNull();
    expect(problems[0]).toMatch(/only 5 usable memes/);
    expect(notes.some((n) => n.startsWith('"搭子": no source from your search results'))).toBe(true);
  });

  it('drops low-confidence origins, messy headwords and duplicates', () => {
    const raw = clone(SAMPLE_MEME_SUBMISSION);
    raw.items.push(clone(raw.items[0]));
    raw.items.push({ ...clone(raw.items[1]), hanzi: '绷不住/绷住' });
    raw.items.push({ ...clone(raw.items[2]), hanzi: '牛马', origin: { text: '?', when: '', confidence: 'low' } });
    const { issue, notes } = validateMemeIssue(raw, ctx);
    expect(issue!.items).toHaveLength(6);
    expect(notes.some((n) => n.includes('appears twice'))).toBe(true);
    expect(notes.some((n) => n.startsWith('"绷不住/绷住": the headword must be ONE clean form'))).toBe(true);
    expect(notes.some((n) => n.startsWith('"牛马": origin confidence is low'))).toBe(true);
  });

  it('needs a title, an intro and at least three quiz questions', () => {
    const raw = clone(SAMPLE_MEME_SUBMISSION) as Record<string, unknown>;
    raw.title = '';
    raw.intro_zh = '';
    raw.quiz = [{ prompt: 'x', options: ['a', 'a'], answer: 0 }];
    const { problems } = validateMemeIssue(raw, ctx);
    expect(problems).toEqual(expect.arrayContaining([
      'title (Chinese) is missing',
      'intro_zh is missing',
      'the quiz needs 3–5 questions (has 0 usable)',
    ]));
  });

  it('caps at ten items', () => {
    const raw = clone(SAMPLE_MEME_SUBMISSION);
    const extra = Array.from({ length: 6 }, (_, i) => ({ ...clone(raw.items[1]), hanzi: `搭子${i}号` }));
    raw.items.push(...extra);
    const { issue, notes } = validateMemeIssue(raw, ctx);
    expect(issue!.items).toHaveLength(10);
    expect(notes.some((n) => n.includes('kept the first 10'))).toBe(true);
  });
});

describe('rederivePinyin', () => {
  it('uses the app’s pinyin, keeping the model’s spacing only when every syllable matches', () => {
    expect(rederivePinyin('情绪价值', 'qíngxù jiàzhí', derive)).toBe('qíngxù jiàzhí');
    // A wrong tone loses to the app's own.
    expect(rederivePinyin('情绪价值', 'qíngxū jiàzhí', derive)).toBe('qíng xù jià zhí');
    // A missed 一 change loses too: the derived pinyin carries it.
    expect(rederivePinyin('一个', 'yī gè', derive)).toBe('yí gè');
    // Latin letters stay as they are.
    expect(rederivePinyin('City不City', 'City bù City', derive)).toBe('City bù City');
    expect(rederivePinyin('City不City', undefined, derive)).toBe('City bù City');
    expect(rederivePinyin('hello', 'x', derive)).toBe('');
  });

  it('lets the model write a neutral tone only on a typically neutral syllable', () => {
    expect(derive('搭子')).toBe('dā zǐ');
    expect(rederivePinyin('搭子', 'dāzi', derive)).toBe('dāzi');
    expect(rederivePinyin('看看', 'kànkan', derive)).toBe('kànkan');
    // Not on the first syllable, not on an ordinary character, never everywhere.
    expect(rederivePinyin('搭子', 'dazi', derive)).toBe('dā zǐ');
    expect(rederivePinyin('情绪', 'qíngxu', derive)).toBe('qíng xù');
    expect(rederivePinyin('我在找', 'wo zai zhao', derive)).toBe(derive('我在找'));
  });

  it('is applied to every line of an issue', () => {
    const raw = clone(SAMPLE_MEME_SUBMISSION);
    raw.items[1].pinyin = 'dǎzi';
    raw.items[1].examples[0].pinyin = 'wo zai zhao';
    const { issue } = validateMemeIssue(raw, ctx);
    expect(issue!.items[1].pinyin).toBe('dā zǐ');
    expect(issue!.items[1].examples[0].pinyin).toBe(derive('我在找一个健身搭子。'));
  });
});

describe('urls', () => {
  it('urlKey ignores what does not change the page', () => {
    expect(urlKey('https://www.bilibili.com/video/BV1x/?spm_id_from=1&p=2#t=3')).toBe('bilibili.com/video/BV1x?p=2');
    expect(urlKey('http://m.weibo.cn/status/1')).toBe('weibo.cn/status/1');
    expect(urlKey('javascript:alert(1)')).toBeNull();
    expect(urlKey('not a url')).toBeNull();
  });

  it('platformOf and youtubeThumbnail', () => {
    expect(platformOf('https://b23.tv/abc')).toBe('bilibili');
    expect(platformOf('https://v.douyin.com/abc')).toBe('douyin');
    expect(platformOf('https://www.thepaper.cn/x')).toBe('news');
    expect(platformOf('https://example.org')).toBe('other');
    expect(youtubeThumbnail('https://youtu.be/dQw4w9WgXcQ')).toBe('https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    expect(youtubeThumbnail('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    expect(youtubeThumbnail('https://www.bilibili.com/video/BV1x')).toBeNull();
  });
});

describe('labels', () => {
  it('months and coverage', () => {
    expect(isMemeMonth('2026-10')).toBe(true);
    expect(isMemeMonth('2026-13')).toBe(false);
    expect(memeMonthOf(Date.UTC(2026, 10, 1, 3))).toBe('2026-11');
    expect(memeMonthLabel('2026-10')).toBe('October 2026');
    expect(memeMonthLabelZh('2026-03')).toBe('2026年3月');
    expect(coverageWindow('2026-11-01')).toEqual({ from: '2026-09-06', to: '2026-11-01' });
    expect(memeCoversLabel({ from: '2026-08-23', to: '2026-10-18' })).toBe('23 Aug – 18 Oct 2026');
    expect(memeCoversLabel({ from: '2026-12-06', to: '2027-01-31' })).toBe('6 Dec 2026 – 31 Jan 2027');
  });

  it('chips, links, verdicts, quiz line', () => {
    expect(memeLinkLabel({ kind: 'video', platform: 'bilibili' })).toBe('▶ Watch on Bilibili');
    expect(memeLinkLabel({ kind: 'post', platform: 'weibo' })).toBe('↗ Open on Weibo');
    expect(memeVerdictLabel('cringe')).toBe('😬 A bit cringe from you');
    expect(memeRegisterChips({ who: 'Gen Z', tone: 'Ironic', where: 'online', crude: true, note: '' })).toEqual(['Gen Z', 'Ironic', 'Online (typed)', '⚠ Crude']);
    expect(memeQuizScoreLine(4, 4)).toMatch(/^4 \/ 4 — 你很懂梗/);
    expect(memeQuizScoreLine(2, 4)).toMatch(/nearly/);
    expect(memeQuizScoreLine(1, 4)).toMatch(/once more/);
    expect(memeQuizScoreLine(0, 0)).toBe('');
  });

  it('memeCardFields: the gist, an explanation and a clean example as the clue', () => {
    const { issue } = validateMemeIssue(SAMPLE_MEME_SUBMISSION, ctx);
    const card = memeCardFields(issue!.items[1], '2026-10');
    expect(card.hanzi).toBe('搭子');
    expect(card.english).toBe('An activity buddy');
    expect(card.fun_facts).toContain('Origin (October 2026 meme review)');
    expect(card.fun_facts).toContain('Would you say it? 👍 Fine to say');
    expect(card.sentence_clue).toBe('我在找一个健身搭子。');
    expect(memeAudioLines(issue!)).toContain('搭子');
  });
});

describe('parseStoredMemeIssue', () => {
  it('round-trips a valid issue and refuses junk', () => {
    const { issue } = validateMemeIssue(SAMPLE_MEME_SUBMISSION, ctx);
    expect(parseStoredMemeIssue(clone(issue))).toEqual(issue);
    expect(parseStoredMemeIssue({ month: 'x', items: [] })).toBeNull();
    expect(parseStoredMemeIssue(null)).toBeNull();
  });
});
