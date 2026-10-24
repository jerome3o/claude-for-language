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
  CLIP_MUSIC_TRACKS,
  CLIP_VOICE_IDS,
  SAMPLE_CLIP,
  SAMPLE_INTERACTIVE_CLIP,
  SAMPLE_STORY_CLIP,
  clipAnswerOption,
  clipAnswerOrder,
  clipContinue,
  clipFlip,
  clipHash,
  clipMusicFor,
  clipMusicShouldPlay,
  clipMusicStep,
  clipMusicTarget,
  clipOrderRight,
  clipOrderShuffle,
  clipRevealMs,
  clipSkip,
  clipSkipShown,
  clipSpeakResult,
  karaokeActive,
  karaokeStates,
  karaokeTimeline,
  sceneRevealUtterances,
  clipAudioClips,
  clipDurationMs,
  clipImagePrompts,
  clipProgressSegments,
  clipQuizRight,
  clipWaiting,
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

const SPECS: ClipSpec[] = [SAMPLE_CLIP, SAMPLE_STORY_CLIP, third, sampleClipInTheme('retro'), SAMPLE_INTERACTIVE_CLIP];

const specs = SPECS.map((spec) => ({
  spec,
  timeline: clipTimeline(spec),
  duration: clipDurationMs(spec),
  duration_label: formatClipDuration(clipDurationMs(spec)),
  utterances: clipUtterances(spec),
  reveal_utterances: spec.scenes.map((sc, i) => sceneRevealUtterances(sc, i)),
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

// The clock: scripted runs (t = tick dt speaking, a = answer option, o = order answer, f = flip, s = skip,
// v = speak verdict, c = continue).
type Op = ['t', number, boolean] | ['a', number] | ['o', number[]] | ['f'] | ['s'] | ['v', 'exact' | 'sound' | 'close' | 'wrong'] | ['c'];
const runs: Array<{ spec: number; start: number; ops: Op[] }> = [
  { spec: 0, start: 0, ops: [['t', 2000, false], ['t', 1000, true], ['t', 16, true], ['t', 16, false], ['t', 4100, false], ['t', 100, false]] },
  { spec: 0, start: 4, ops: [['t', 3000, false], ['a', 1], ['a', 0], ['t', 2000, false], ['t', 600, true], ['t', 10, false]] },
  { spec: 0, start: 4, ops: [['t', 7999, false], ['t', 1, false], ['a', 0], ['t', 2499, false], ['t', 1, false]] },
  { spec: 0, start: 7, ops: [['t', 3999, false], ['t', 1, false], ['t', 100, false]] },
  { spec: 1, start: 0, ops: Array.from({ length: 40 }, (_, i): Op => ['t', 997, i % 7 === 3]) },
  { spec: 2, start: 0, ops: [['t', -50, false], ['t', 250, false], ['t', 2750, false], ['t', 100000, false]] },
  { spec: 0, start: 4, ops: [['t', 5999, false], ['t', 1, false], ['t', 60000, false], ['s'], ['a', 1], ['t', 2499, true], ['t', 5, true], ['t', 5, false]] },
  { spec: 4, start: 3, ops: [['o', [0, 1, 2, 3, 4]], ['a', 2], ['t', 2500, false], ['a', 0], ['o', [0, 1, 2, 3, 4]], ['t', 100, false], ['c'], ['f'], ['t', 2999, false], ['t', 1, false], ['v', 'close'], ['t', 3499, false], ['t', 1, false], ['t', 10, false]] },
  { spec: 4, start: 4, ops: [['o', [1, 0, 2, 3, 4]], ['t', 2999, false], ['t', 1, false], ['c'], ['s'], ['t', 2500, false]] },
  { spec: 4, start: 6, ops: [['v', 'sound'], ['c'], ['c'], ['t', 100, false]] },
  { spec: 4, start: 6, ops: [['v', 'wrong'], ['t', 3500, false]] },
];
const step = (state: ClipPlayState, spec: ClipSpec, op: Op): ClipPlayState => {
  switch (op[0]) {
    case 't': return clipTick(spec, state, op[1], op[2]);
    case 'a': return clipAnswerOption(spec, state, op[1]);
    case 'o': return clipAnswerOrder(spec, state, op[1]);
    case 'f': return clipFlip(state);
    case 's': return clipSkip(state);
    case 'v': return clipSpeakResult(state, op[1]);
    case 'c': return clipContinue(spec, state);
  }
};
const snapshot = (spec: ClipSpec, state: ClipPlayState) => ({ state, waiting: clipWaiting(state), skip: clipSkipShown(state), right: clipQuizRight(spec, state), fill: clipSceneFill(spec, state) });
const clock = runs.map((r) => {
  const spec = SPECS[r.spec];
  let state = clipStart(spec, r.start);
  const states = [snapshot(spec, state)];
  for (const op of r.ops) {
    state = step(state, spec, op);
    states.push(snapshot(spec, state));
  }
  return { ...r, states };
});
const reveal_ms = (['quiz', 'listen', 'order', 'reveal', 'speak', 'title'] as const).flatMap((layout) =>
  (['right', 'wrong', 'close', 'done', 'skipped'] as const).map((result) => ({ layout, result, out: clipRevealMs(layout, result) })),
);

// order: the hash and the shuffle.
const hashes = ['', 'a', 'clip-1:4', '顺便', '𠮷野家', 'x'.repeat(100)].map((text) => ({ text, out: clipHash(text) }));
const tileSets = [['我', '下班', '顺便', '去', '银行'], ['我', '我', '你'], ['一'], ['刚才', '我', '在', '开会'], ['a', 'b'], ['好', '好', '不', '好']];
const shuffles = tileSets.flatMap((tiles) => ['', 'c1:4', 'clip-abc:2', 'z', '顺便:0'].map((seed) => ({ tiles, seed, out: clipOrderShuffle(tiles, seed) })));
const orderRight = [
  { tiles: ['我', '我', '你'], order: [1, 0, 2] },
  { tiles: ['我', '我', '你'], order: [2, 0, 1] },
  { tiles: ['a', 'b', 'c'], order: [0, 1] },
  { tiles: ['a', 'b', 'c'], order: [0, 1, 2] },
].map((c) => ({ ...c, out: clipOrderRight(c.tiles, c.order) }));

// Karaoke: lines × durations × segmentations, and the active word over time.
const karaokeLines: Array<{ text: string; lang: 'zh' | 'en'; words: string[] | null }> = [
  { text: '刚和刚才，有什么不一样？', lang: 'zh', words: ['刚', '和', '刚才', '，', '有', '什么', '不', '一样', '？'] },
  { text: '刚和刚才，有什么不一样？', lang: 'zh', words: null },
  { text: '我刚才吃了饭。', lang: 'zh', words: ['我', '刚', '才'] },
  { text: '你是i人，e人？', lang: 'zh', words: ['你', '是', 'i人', '，', 'e人', '？'] },
  { text: '2026年我去了北京。', lang: 'zh', words: null },
  { text: 'How long is 一会儿, really?', lang: 'en', words: null },
  { text: '马上 literally means on horseback.', lang: 'en', words: ['ignored'] },
  { text: '"Wait — what?!"  OK...', lang: 'en', words: null },
  { text: '。', lang: 'zh', words: null },
  { text: '', lang: 'zh', words: null },
  { text: "Here's a word that saves you a trip.", lang: 'en', words: null },
];
const karaoke = karaokeLines.flatMap((l) =>
  [0, 200, 1234, 3000, 6100].map((duration) => {
    const timeline = karaokeTimeline(l.text, l.lang, duration, l.words);
    const at = [0, 50, 119, 120, 400, 999, 1500, 2600, 5000, 7000].map((t) => {
      const active = karaokeActive(timeline, t);
      return { t, active, states: karaokeStates(timeline, active) };
    });
    return { ...l, duration, timeline, at };
  }),
);

// Music.
const music = {
  tracks: CLIP_MUSIC_TRACKS,
  by_theme: ['neon', 'paper', 'chalk', 'comic', 'sunset', 'mono', 'ink', 'retro', '', 'nope'].map((theme) => ({ theme, id: clipMusicFor(theme).id })),
  target: [true, false].map((speaking) => ({ speaking, out: clipMusicTarget({ speaking }) })),
  steps: [[0.22, 0.07, 100], [0.145, 0.07, 1000], [0.07, 0.22, 100], [0.07, 0.22, -5], [0.2, 0.2, 50], [0.1, 0.22, 16], [0.22, 0.07, 16]].map(([c, t, dt]) => ({ current: c, target: t, dt, out: clipMusicStep(c, t, dt) })),
  play: [true, false].flatMap((playing) => [true, false].flatMap((muted) => [true, false].map((m) => ({ playing, muted, music: m, out: clipMusicShouldPlay({ playing, muted, music: m }) })))),
};
const starts = [-3, 0, 3, 4, 8, 99].map((scene) => ({ scene, state: clipStart(SAMPLE_CLIP, scene) }));

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
  JSON.stringify({ voice_ids: CLIP_VOICE_IDS, specs, casts, tts, progress, clock, starts, story_shown: storyShown, offers, titles: ['', '  刚 ', 'x'].map((t) => ({ topic: t, title: learnMoreTitle(t) })), reveal_ms, hashes, shuffles, order_right: orderRight, karaoke, music }, null, 1),
);
