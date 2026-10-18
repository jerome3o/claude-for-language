/**
 * Golden vectors for the Kotlin port of shared/meme-review (android-lab/core/…/memereview/MemeReview.kt):
 * month / coverage labels, platform / link / verdict labels, register chips, the quiz score line,
 * the "+ Add as card" fields and the ▶ lines of the sample issue (validated by the web's own
 * validator with the app's pinyin) and of variants. The issue is written as JSON so the Kotlin
 * data classes are checked to decode it. Writes meme-review.json; checked by
 * core/…/memereview/MemeReviewParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pinyin } from 'pinyin-pro';
import { applyYiBuToneChanges } from '../../../shared/pinyin/toneChange';
import {
  SAMPLE_MEME_SEEN_URLS,
  SAMPLE_MEME_SUBMISSION,
  isMemeMonth,
  memeAudioLines,
  memeCardFields,
  memeCoversLabel,
  memeLinkLabel,
  memeMonthLabel,
  memeMonthLabelZh,
  memePlatformName,
  memeQuizScoreLine,
  memeRegisterChips,
  memeVerdictLabel,
  validateMemeIssue,
  type MemeIssue,
  type MemePlatform,
  type MemeRegister,
  type MemeVerdict,
} from '../../../shared/meme-review';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const derive = (t: string) => (/\p{Script=Han}/u.test(t) ? applyYiBuToneChanges(t, pinyin(t, { toneType: 'symbol', type: 'string', nonZh: 'consecutive' })) : null);
const issue = validateMemeIssue(SAMPLE_MEME_SUBMISSION, { month: '2026-10', today: '2026-10-18', seenUrls: SAMPLE_MEME_SEEN_URLS, derivePinyin: derive }).issue as MemeIssue;

const variant = (patch: (i: MemeIssue) => void): MemeIssue => {
  const v = JSON.parse(JSON.stringify(issue)) as MemeIssue;
  patch(v);
  return v;
};

const ISSUES: MemeIssue[] = [
  issue,
  variant((v) => {
    v.month = '2027-01';
    v.items.forEach((it) => {
      it.origin.confidence = 'medium';
      it.related = [];
      it.register = { who: '', tone: ' ', where: 'spoken', crude: true, note: '' };
      it.say_it = { verdict: 'avoid', note: '' };
      it.meaning.english = '';
      it.examples = it.examples.map((e, i) => (i === 0 ? { ...e, hanzi: `${e.hanzi}……` } : e));
    });
  }),
];

const PLATFORMS: MemePlatform[] = ['bilibili', 'youtube', 'douyin', 'weibo', 'xiaohongshu', 'zhihu', 'baidu', 'wechat', 'news', 'other'];
const REGISTERS: MemeRegister[] = [
  { who: 'Gen Z', tone: 'Ironic', where: 'online', crude: false, note: '' },
  { who: ' ', tone: '', where: 'both', crude: true, note: 'x' },
  { who: 'Office workers', tone: 'Self-mocking', where: 'spoken', crude: false, note: '' },
];

const out = {
  months: ['2026-10', '2027-01', '2026-13', '26-10', '', '2026-1'].map((m) => ({ month: m, valid: isMemeMonth(m), label: memeMonthLabel(m), zh: memeMonthLabelZh(m) })),
  covers: [
    { from: '2026-08-23', to: '2026-10-18' },
    { from: '2026-12-06', to: '2027-01-31' },
    { from: 'x', to: '2026-10-01' },
  ].map((c) => ({ ...c, label: memeCoversLabel(c) })),
  platforms: PLATFORMS.map((p) => ({ platform: p, name: memePlatformName(p), video: memeLinkLabel({ kind: 'video', platform: p }), post: memeLinkLabel({ kind: 'post', platform: p }) })),
  verdicts: (['fine', 'cute', 'cringe', 'avoid', 'nope'] as MemeVerdict[]).map((v) => ({ verdict: v, label: memeVerdictLabel(v) })),
  registers: REGISTERS.map((r) => ({ register: r, chips: memeRegisterChips(r) })),
  scores: [[0, 0], [0, 1], [1, 1], [1, 3], [2, 4], [3, 4], [4, 4], [0, 5]].map(([c, t]) => ({ correct: c, total: t, line: memeQuizScoreLine(c, t) })),
  issues: ISSUES.map((i) => ({
    issue: i,
    cards: i.items.map((it) => memeCardFields(it, i.month)),
    audio: memeAudioLines(i),
    covers_label: memeCoversLabel(i.covers),
  })),
};

writeFileSync(join(OUT, 'meme-review.json'), JSON.stringify(out, null, 1));
