/**
 * Golden vectors for the Kotlin port of shared/clips (android-lab/core/…/clips/Clips.kt): the
 * sample specs (decoded by the Kotlin data classes), each spec's timeline / length / utterances
 * (text + voice) / audio clips / pictures / topic, story casts for assorted speaker lists, the TTS
 * text rule, progress segments, the clip clock driven through scripted runs (tick / answer), story
 * lines shown, the Learn more offers, and the pending-event overlay. Writes clips.json; checked by
 * core/…/ClipsParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLIP_VOICE_IDS,
  SAMPLE_CLIP,
  SAMPLE_STORY_CLIP,
  clipAnswerQuiz,
  clipAudioClips,
  clipDurationMs,
  clipImagePrompts,
  clipProgressSegments,
  clipQuizRight,
  clipQuizWaiting,
  clipSceneFill,
  clipStart,
  clipTick,
  clipTimeline,
  clipTopic,
  clipTtsText,
  clipUtterances,
  formatClipDuration,
  isNarratorSpeaker,
  learnMoreOffers,
  learnMoreTitle,
  sampleClipInTheme,
  storyCast,
  storyLinesShown,
  type ClipLessonState,
  type ClipPlayState,
  type ClipSpec,
} from '../../../shared/clips';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

// A third spec: story with a voice (only the voice is read), a list without (its items), named
// speakers incl. Narrator, a voiced fact with an " / ", no ending.
const third = clone(SAMPLE_STORY_CLIP) as ClipSpec;
third.title = 'i人 / e人';
delete third.ending;
delete third.topic;
third.scenes.push(
  { layout: 'story', duration_ms: 6000, voice: { text: '听听他们怎么说。', lang: 'zh', voice: 'narrator' }, story: { lines: [{ speaker: '秦始皇', hanzi: '我要长生不老。', pinyin: 'Wǒ yào chángshēng bù lǎo.', english: 'I want to live forever.' }, { speaker: '徐福', hanzi: '好的，我去找。', pinyin: 'Hǎo de, wǒ qù zhǎo.', english: 'OK, I will go and look.' }] } },
  { layout: 'list', duration_ms: 5000, list: { items: [{ hanzi: 'i人', pinyin: 'i rén', english: 'introvert' }, { hanzi: 'e人', pinyin: 'e rén', english: 'extrovert' }] } },
  { layout: 'fact', duration_ms: 3000, voice: { text: '你是i人 / e人？', lang: 'zh', voice: 'female' }, fact: { text_en: 'From the MBTI craze.' } },
);
third.scenes.splice(1, 0, { layout: 'story', duration_ms: 5000, story: { lines: [{ speaker: 'Narrator', hanzi: '从前……', pinyin: 'Cóngqián……', english: 'Once…' }, { speaker: '秦始皇', hanzi: '来人！', pinyin: 'Lái rén!', english: 'Guards!' }, { speaker: '徐福', hanzi: '在！', pinyin: 'Zài!', english: 'Here!' }, { speaker: '老板', hanzi: '我也在。', pinyin: 'Wǒ yě zài.', english: 'Me too.' }, { hanzi: '没有名字。', pinyin: 'Méiyǒu míngzi.', english: 'No name.' }] } });

const SPECS: ClipSpec[] = [SAMPLE_CLIP, SAMPLE_STORY_CLIP, third, sampleClipInTheme('retro')];

const specs = SPECS.map((spec) => ({
  spec,
  timeline: clipTimeline(spec),
  duration: clipDurationMs(spec),
  duration_label: formatClipDuration(clipDurationMs(spec)),
  utterances: clipUtterances(spec),
  audio: clipAudioClips(spec),
  images: clipImagePrompts(spec),
  topic: clipTopic(spec),
  title: learnMoreTitle(clipTopic(spec)),
}));

const castLists = [
  ['A', 'B', 'A', 'B'],
  ['旁白', '小王', '小李', '旁白'],
  ['Narrator', '秦始皇', '徐福', '秦始皇', '', '老板', 'narrator', ' 解说 ', '画外音', 'C', 'D', 'E', 'F'],
  [],
  ['', '', ''],
];
const casts = castLists.map((labels) => ({ labels, cast: storyCast(labels.map((s) => ({ speaker: s || undefined }))), narrator: labels.map((l) => isNarratorSpeaker(l)) }));

const ttsCases = ['你是i人 / e人？', '刚／刚才', ' 我  刚到。 ', 'a/b/c', 'How long is 一会儿, really?'];
const tts = ttsCases.map((text) => ({ text, out: clipTtsText(text) }));

const progress = [
  [0, 0], [1, 2000], [1, 99999], [4, 400], [8, 0], [7, 4000],
].map(([scene, elapsed]) => ({ scene, elapsed, out: clipProgressSegments(SAMPLE_CLIP, scene, elapsed) }));

// The clock: scripted runs (t = tick dt speaking, a = answer option).
type Op = ['t', number, boolean] | ['a', number];
const runs: Array<{ spec: number; start: number; ops: Op[] }> = [
  { spec: 0, start: 0, ops: [['t', 2000, false], ['t', 1000, true], ['t', 16, true], ['t', 16, false], ['t', 4100, false], ['t', 100, false]] },
  { spec: 0, start: 4, ops: [['t', 3000, false], ['a', 1], ['a', 0], ['t', 2000, false], ['t', 600, true], ['t', 10, false]] },
  { spec: 0, start: 4, ops: [['t', 7999, false], ['t', 1, false], ['a', 0], ['t', 2499, false], ['t', 1, false]] },
  { spec: 0, start: 7, ops: [['t', 3999, false], ['t', 1, false], ['t', 100, false]] },
  { spec: 1, start: 0, ops: Array.from({ length: 40 }, (_, i): Op => ['t', 997, i % 7 === 3]) },
  { spec: 2, start: 0, ops: [['t', -50, false], ['t', 250, false], ['t', 2750, false], ['t', 100000, false]] },
];
const step = (state: ClipPlayState, spec: ClipSpec, op: Op): ClipPlayState => (op[0] === 't' ? clipTick(spec, state, op[1], op[2]) : clipAnswerQuiz(state, op[1]));
const clock = runs.map((r) => {
  const spec = SPECS[r.spec];
  let state = clipStart(spec, r.start);
  const states = [{ state, waiting: clipQuizWaiting(state), right: clipQuizRight(spec, state), fill: clipSceneFill(spec, state) }];
  for (const op of r.ops) {
    state = step(state, spec, op);
    states.push({ state, waiting: clipQuizWaiting(state), right: clipQuizRight(spec, state), fill: clipSceneFill(spec, state) });
  }
  return { ...r, states };
});
const starts = [-3, 0, 3, 8, 99].map((scene) => ({ scene, state: clipStart(SAMPLE_CLIP, scene) }));

const storyShown: Array<{ lines: number; duration: number; elapsed: number; spoken: number; out: number }> = [];
for (const lines of [0, 1, 2, 4, 6]) {
  for (const duration of [5000, 7000, 8000, 9000]) {
    for (const elapsed of [0, 1, 999, 1600, 2800, 3333, 4999, 5600, 6300, 9000]) {
      for (const spoken of [-1, 0, 2, 5]) storyShown.push({ lines, duration, elapsed, spoken, out: storyLinesShown(lines, duration, elapsed, spoken) });
    }
  }
}

const lessonStates: Array<ClipLessonState | null> = [
  null,
  { status: 'generating', lesson_id: null, error: null },
  { status: 'ready', lesson_id: 'l1', error: null },
  { status: 'ready', lesson_id: null, error: null },
  { status: 'failed', lesson_id: null, error: 'x' },
];
const oneWord = clone(SAMPLE_CLIP);
oneWord.words = oneWord.words.slice(0, 1);
const offers = [SAMPLE_CLIP, oneWord].flatMap((spec) => lessonStates.map((lesson) => ({ words: spec.words.length, lesson, offers: learnMoreOffers(spec, lesson) })));

writeFileSync(
  join(OUT, 'clips.json'),
  JSON.stringify({ voice_ids: CLIP_VOICE_IDS, specs, casts, tts, progress, clock, starts, story_shown: storyShown, offers, titles: ['', '  刚 ', 'x'].map((t) => ({ topic: t, title: learnMoreTitle(t) })) }, null, 1),
);
