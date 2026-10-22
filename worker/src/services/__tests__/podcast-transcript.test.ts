/**
 * The text of an audio lesson for podcast apps (services/podcast-transcript.ts): the show notes
 * (HTML + plain), the timed transcripts (WebVTT, SRT, Podcasting 2.0 JSON) — cue timing, the
 * three lines per cue, escaping — for all three formats, from the real compilers' scripts.
 */
import { describe, expect, it } from 'vitest';
import {
  buildTimeline,
  compileDialogueLesson,
  compileSleepLesson,
  compileStoryLesson,
  SAMPLE_DIALOGUE_PLAN,
  SAMPLE_SLEEP_PLAN,
  SAMPLE_SLEEP_SOURCE,
  SAMPLE_STORY_PLAN,
  speechKey,
  type AudioLessonScript,
  type AudioLessonTranscriptLine,
} from '@shared/audio-lesson';
import {
  autoLinePinyin,
  cueTimestamp,
  notesByChapter,
  PLAIN_NOTES_MAX_CHARS,
  showNotesHtml,
  showNotesText,
  toPodcastJson,
  toSrt,
  toWebVtt,
  transcriptCues,
  type TranscriptLesson,
} from '../podcast-transcript';
import { cdata } from '../podcast-feed';

/** A lesson as the feed sees it, every clip 48 frames (~1.15 s). */
function lessonOf(script: AudioLessonScript): TranscriptLesson {
  const frames = new Map<string, number>();
  for (const s of script.segments) if (s.kind === 'speech') frames.set(speechKey(s), 48);
  const t = buildTimeline(script, frames, 24, 1);
  return { format: script.format, duration_ms: t.duration_ms, words: script.words, chapters: t.chapters, transcript: t.transcript, speakers: script.speakers };
}

const dialogue = () => lessonOf(compileDialogueLesson(SAMPLE_DIALOGUE_PLAN));
const sleep = () => lessonOf(compileSleepLesson(SAMPLE_SLEEP_PLAN, { sourceText: SAMPLE_SLEEP_SOURCE }));
const story = () => lessonOf(compileStoryLesson(SAMPLE_STORY_PLAN));

function line(start_ms: number, text: string, extra: Partial<AudioLessonTranscriptLine> = {}): AudioLessonTranscriptLine {
  return { start_ms, lang: 'zh', voice: 'teacher', text, chapter: 0, ...extra };
}

describe('timed cues', () => {
  it('a story chunk is ONE cue spanning its three plays, its English and the plays after (no flicker)', () => {
    const l = story();
    const cues = transcriptCues(l);
    const lines = l.transcript;
    expect(cues.length).toBe(5);
    expect(cues.length).toBeLessThan(lines.length);
    expect(cues[0]).toMatchObject({ text: '明慧：你好！你今天想喝什么？', pinyin: 'nǐ hǎo! nǐ jīntiān xiǎng hē shénme?', english: 'Hi! What would you like to drink today?', repeat: '×3 +2' });
    // Back to back, in order, the last one ends with the lesson.
    for (let i = 1; i < cues.length; i++) expect(cues[i].start_ms).toBe(cues[i - 1].end_ms);
    expect(cues[0].start_ms).toBe(lines[0].start_ms);
    expect(cues[cues.length - 1].end_ms).toBe(l.duration_ms);
    // A story's lines carry their speaker label in the text already: no second one.
    expect(cues.every((c) => !c.speaker)).toBe(true);
  });

  it('a dialogue names its speakers; narration has no pinyin; a Chinese line without pinyin gets the automatic one', () => {
    const cues = transcriptCues(dialogue());
    expect(cues.find((c) => c.text === '你好，吃什么？')).toMatchObject({ speaker: 'Cook', pinyin: 'nǐ hǎo, chī shénme?', english: 'Hi, what are you having?' });
    expect(cues.find((c) => c.text === '我要一碗牛肉面。')?.speaker).toBe('Customer');
    const intro = cues[0];
    expect(intro.lang).toBe('en');
    expect(intro.pinyin).toBeUndefined();
    expect(cues.find((c) => c.text === '少放点' && !c.english)?.pinyin).toBe('shǎo fàng diǎn');
  });

  it('automatic pinyin: tone marks, the 一 / 不 changes, ASCII punctuation', () => {
    expect(autoLinePinyin('你好。')).toBe('nǐ hǎo.');
    expect(autoLinePinyin('现在，我们学一个新词。')).toBe('xiàn zài, wǒ men xué yí gè xīn cí.');
    expect(autoLinePinyin('不是！')).toBe('bú shì!');
    expect(autoLinePinyin('Hello')).toBe('');
  });

  it('formats timestamps for WebVTT and SRT', () => {
    expect(cueTimestamp(0)).toBe('00:00:00.000');
    expect(cueTimestamp(3_723_456)).toBe('01:02:03.456');
    expect(cueTimestamp(65_024, ',')).toBe('00:01:05,024');
  });

  it('WebVTT: header, numbered cues, hanzi / pinyin / English lines, a <v> span, escaped', () => {
    const vtt = toWebVtt(transcriptCues(dialogue()));
    expect(vtt).toMatch(/^WEBVTT\n\n1\n00:00:00\.\d{3} --> /);
    expect(vtt).toMatch(/\n<v Cook>你好，吃什么？\nnǐ hǎo, chī shénme\?\nHi, what are you having\?\n\n/);
    // Every cue: number, timing, 1–3 text lines, blank line.
    for (const block of vtt.split('\n\n').slice(1).filter(Boolean)) {
      const [n, timing, ...text] = block.split('\n');
      expect(n).toMatch(/^\d+$/);
      expect(timing).toMatch(/^\d\d:\d\d:\d\d\.\d{3} --> \d\d:\d\d:\d\d\.\d{3}$/);
      expect(text.length).toBeGreaterThanOrEqual(1);
      expect(text.length).toBeLessThanOrEqual(3);
    }
    const nasty = toWebVtt(
      transcriptCues({
        format: 'dialogue', duration_ms: 5000, words: [], chapters: [], speakers: [{ role: 'speaker_a', name: 'A<b>', gender: 'female' }],
        transcript: [line(0, '你<好> & 他 --> 我\n第二行', { voice: 'speaker_a', english: 'Fish & chips <now>' })],
      }),
    );
    expect(nasty).toContain('<v A&lt;b&gt;>你&lt;好&gt; &amp; 他 → 我 第二行\n');
    expect(nasty).toContain('Fish &amp; chips &lt;now&gt;');
    expect(nasty.split('-->').length).toBe(2);
  });

  it('SRT: numbered cues with comma timestamps; "Name: " leads a dialogue line, other ": " become "："', () => {
    const srt = toSrt(transcriptCues(dialogue()));
    expect(srt).toMatch(/^1\n00:00:00,\d{3} --> /);
    expect(srt).toContain('\nCook: 你好，吃什么？\nnǐ hǎo, chī shénme?\nHi, what are you having?\n');
    // The intro "…at the counter: the kind of noodle…" must not read as a speaker called "You're at…".
    const intro = srt.split('\n\n')[0];
    expect(intro).toContain('counter：the kind');
    expect(intro).not.toMatch(/: /);
  });

  it('Podcasting 2.0 JSON: segments in seconds with speaker and a three-line body', () => {
    const doc = toPodcastJson(transcriptCues(dialogue()));
    expect(doc.version).toBe('1.0.0');
    const seg = doc.segments.find((s) => s.body.startsWith('你好'))!;
    expect(seg.speaker).toBe('Cook');
    expect(seg.body).toBe('你好，吃什么？\nnǐ hǎo, chī shénme?\nHi, what are you having?');
    expect(Number.isFinite(seg.startTime) && seg.endTime > seg.startTime).toBe(true);
    expect(doc.segments[0].speaker).toBeUndefined();
  });

  it('no transcript: no cues', () => {
    const empty: TranscriptLesson = { format: 'sleep', duration_ms: 1000, words: [], chapters: [], transcript: [], speakers: [] };
    expect(transcriptCues(empty)).toEqual([]);
    expect(toWebVtt([])).toBe('WEBVTT\n');
    expect(toSrt([])).toBe('');
  });
});

describe('show notes', () => {
  it('a dialogue: chapter headings with times, the conversation once, later listens point back to it', () => {
    const l = dialogue();
    const notes = notesByChapter(l);
    expect(notes.map((c) => c.title)).toEqual([
      'Introduction', 'First listen', 'Second listen', 'Third listen, a little slower', 'Line by line',
      '粗 cū — thick', '少放点 shǎo fàng diǎn — put in a bit less', '加 jiā — to add', '一个 yí gè — one (of something)', 'Final listen',
    ]);
    const html = showNotesHtml(l);
    expect(html).toContain('<h3>0:00 · Introduction</h3>');
    expect(html.match(/你好，吃什么？/g)?.length).toBe(1);
    expect(html.match(/\(The same 6 lines as in “First listen”\.\)/g)?.length).toBe(4);
    expect(html).toContain('<p>Let&#39;s hear it again.</p>');
    expect(html).toContain('粗 <small>×2</small><br/><em>cū</em><br/>thick');
    expect(html).toContain('<strong>Words (4)</strong>');
  });

  it('a sleep lesson: every explanation line with pinyin, the sentences with English', () => {
    const html = showNotesHtml(sleep());
    expect(html).toContain('<p>邮局是一个地方。<br/><em>yóu jú shì yí gè dì fāng.</em></p>');
    expect(html).toContain('<p>邮局在银行旁边。 <small>×3</small><br/><em>yóujú zài yínháng pángbiān.</em><br/>The post office is next to the bank.</p>');
    expect(html).toContain('<p>The word was 邮局: post office, the place where you send letters and parcels.</p>');
    expect(html).toMatch(/<h3>\d+:\d\d · 原文 yuán wén<\/h3>\n<p>最后，我们慢慢地听一遍原文。<br\/><em>/);
  });

  it('a story: each chunk once with its English', () => {
    const html = showNotesHtml(story());
    expect(html).toContain('<h3>0:00 · 在咖啡馆 zài kā fēi guǎn</h3>');
    expect(html).toContain('<p>明慧：你好！你今天想喝什么？ <small>×3 +2</small><br/><em>nǐ hǎo! nǐ jīntiān xiǎng hē shénme?</em><br/>Hi! What would you like to drink today?</p>');
    expect(html.match(/你今天想喝什么/g)?.length).toBe(1);
  });

  it('the short version (feed budget spent): no transcript, the chapters and a pointer', () => {
    const html = showNotesHtml(sleep(), { full: false });
    expect(html).not.toContain('邮局是一个地方');
    expect(html).toContain('<strong>Chapters</strong><br/>0:00 开始 kāi shǐ');
    expect(html).toContain('this episode’s transcript');
  });

  it('plain text: chapters, then the transcript, cut at the limit with a pointer', () => {
    const l = story();
    const text = showNotesText(l);
    expect(text).toContain('Chapters:\n0:00 在咖啡馆 zài kā fēi guǎn');
    expect(text).toContain('Transcript:\n\n— 0:00 在咖啡馆 zài kā fēi guǎn —\n\n明慧：你好！你今天想喝什么？ ×3 +2\nnǐ hǎo! nǐ jīntiān xiǎng hē shénme?\nHi! What would you like to drink today?');
    const long = showNotesText(sleep());
    expect(long.length).toBeLessThanOrEqual(PLAIN_NOTES_MAX_CHARS);
    const short = showNotesText(sleep(), 800);
    expect(short.length).toBeLessThanOrEqual(800);
    expect(short.endsWith('The full transcript (hanzi, pinyin, English) is in the show notes and the episode’s transcript.')).toBe(true);
  });

  it('HTML is escaped; CDATA never closes early', () => {
    const l: TranscriptLesson = {
      format: 'story', duration_ms: 2000, words: [], chapters: [{ title: '<b>&', start_ms: 0 }], speakers: [],
      transcript: [line(0, '你好]]>，<script>', { english: 'a & b "c" ]]>' })],
    };
    const html = showNotesHtml(l);
    expect(html).toContain('<h3>0:00 · &lt;b&gt;&amp;</h3>');
    expect(html).toContain('你好]]&gt;，&lt;script&gt;');
    expect(html).toContain('a &amp; b &quot;c&quot; ]]&gt;');
    expect(cdata('x]]>y')).toBe('<![CDATA[x]]]]><![CDATA[>y]]>');
  });
});
