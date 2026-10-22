/**
 * The text of an audio lesson for podcast apps (docs/AUDIO_LESSONS.md "Podcast feed → Transcripts"):
 *
 * - show notes: the whole transcript, chapter by chapter, each Chinese line as hanzi / pinyin /
 *   English — `showNotesHtml` (the item's `content:encoded`) and `showNotesText` (plain text for
 *   `description` / `itunes:summary`, cut to a length every app shows whole);
 * - timed transcripts for `<podcast:transcript>`: WebVTT, SRT and the Podcasting 2.0 JSON
 *   (https://github.com/Podcastindex-org/podcast-namespace/blob/main/transcripts/transcripts.md).
 *
 * Built from the stored timeline (`timeline_json.transcript`, one line per spoken clip, in ms)
 * grouped into the player's rows (`transcriptRows`): a line said three times, its English and the
 * line again is ONE row. A timed cue is one row, from its start to the next row's start, so the
 * hanzi / pinyin / English stay on screen while the line is repeated and translated instead of
 * flickering through four identical cues. A Chinese line the lesson stored without pinyin (a sleep
 * lesson's explanations) gets the app's automatic pinyin (pinyin-pro + the 一 / 不 tone changes,
 * what the in-app player shows too).
 *
 * Pure: no database, no token — the routes pass the URLs in.
 */
import { pinyin as pinyinPro } from 'pinyin-pro';
import {
  chapterTitleWithPinyin,
  formatClock,
  repeatLabel,
  transcriptRows,
  type AudioLessonChapter,
  type AudioLessonFormat,
  type AudioLessonTranscriptLine,
  type LessonWord,
  type ScriptSpeaker,
  type TranscriptRow,
} from '@shared/audio-lesson';
import { applyYiBuToneChanges } from '@shared/pinyin/toneChange';

export interface TranscriptLesson {
  format: AudioLessonFormat;
  duration_ms: number;
  words: LessonWord[];
  chapters: AudioLessonChapter[];
  transcript: AudioLessonTranscriptLine[];
  /** A dialogue's two speakers (their names label the lines); empty otherwise. */
  speakers: ScriptSpeaker[];
}

export interface TranscriptCue {
  start_ms: number;
  end_ms: number;
  chapter: number;
  lang: 'zh' | 'en';
  /** A dialogue speaker's name ("Customer"), else absent. */
  speaker?: string;
  /** The line as shown: hanzi for a Chinese line, the English for narration. */
  text: string;
  pinyin?: string;
  english?: string;
  /** "×3 +1" — how often the line is said; '' when once. */
  repeat: string;
}

const HAN = /\p{Script=Han}/u;

/** Pinyin of a whole Chinese line, as the apps make it on the device (punctuation kept). */
export function autoLinePinyin(text: string): string {
  if (!HAN.test(text)) return '';
  try {
    const raw = pinyinPro(text, { toneType: 'symbol', type: 'string', nonZh: 'consecutive' });
    // Written like the lessons' own pinyin: ASCII punctuation ("nǐ hǎo, chī shénme?").
    const ascii: Record<string, string> = { '，': ',', '、': ',', '。': '.', '！': '!', '？': '?', '：': ':', '；': ';', '（': '(', '）': ')' };
    return applyYiBuToneChanges(text, raw)
      .replace(/[，、。！？：；（）]/g, (ch) => ascii[ch])
      .replace(/\s+([”’」』,.!?;:)])/g, '$1')
      .replace(/([“‘「『(])\s+/g, '$1')
      .replace(/([,.!?;:])(?=[^\s,.!?;:”’」』)])/g, '$1 ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

function speakerName(lesson: TranscriptLesson, line: AudioLessonTranscriptLine | undefined): string | undefined {
  // A story's lines carry their label in the text already ("明慧：你好"); only a dialogue names them.
  if (!line || lesson.format !== 'dialogue') return undefined;
  if (line.voice !== 'speaker_a' && line.voice !== 'speaker_b') return undefined;
  const name = lesson.speakers.find((s) => s.role === line.voice)?.name?.trim();
  return name || undefined;
}

/** One cue per transcript row, in order, timed in ms (end = the next row's start). */
export function transcriptCues(lesson: TranscriptLesson): TranscriptCue[] {
  const lines = lesson.transcript ?? [];
  const rows: TranscriptRow[] = transcriptRows(lines);
  const end = Math.max(lesson.duration_ms || 0, lines.length ? lines[lines.length - 1].start_ms : 0);
  const cues: TranscriptCue[] = [];
  rows.forEach((r, i) => {
    const text = r.text.trim();
    if (!text) return;
    const next = rows[i + 1]?.start_ms ?? end;
    const cue: TranscriptCue = {
      start_ms: Math.max(0, Math.round(r.start_ms)),
      end_ms: Math.max(Math.round(r.start_ms) + 1, Math.round(next)),
      chapter: lines[r.first]?.chapter ?? 0,
      lang: r.lang,
      text,
      repeat: repeatLabel(r).text,
    };
    const speaker = speakerName(lesson, lines[r.first]);
    if (speaker) cue.speaker = speaker;
    if (r.lang === 'zh') {
      const pinyin = r.pinyin?.trim() || autoLinePinyin(text);
      if (pinyin) cue.pinyin = pinyin;
    }
    if (r.english?.trim()) cue.english = r.english.trim();
    cues.push(cue);
  });
  return cues;
}

// ---------------- Timed formats ----------------

/** "00:01:05.024" (WebVTT) / "00:01:05,024" (SRT). */
export function cueTimestamp(ms: number, sep: '.' | ',' = '.'): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const f = t % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(f).padStart(3, '0')}`;
}

/** A cue line may not be empty, hold a line break or "-->" (both formats end / start a cue there). */
function cueLine(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s*[\r\n]+\s*/g, ' ').replace(/-->/g, '→').trim();
}

function cueLines(c: TranscriptCue): string[] {
  return [c.text, c.pinyin ?? '', c.english ?? ''].map(cueLine).filter(Boolean);
}

function escapeVtt(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** WebVTT: hanzi on line 1, pinyin on line 2, English on line 3; a dialogue speaker as a `<v Name>` voice span. */
export function toWebVtt(cues: TranscriptCue[]): string {
  const out = ['WEBVTT', ''];
  cues.forEach((c, i) => {
    const lines = cueLines(c).map(escapeVtt);
    if (!lines.length) return;
    if (c.speaker) lines[0] = `<v ${escapeVtt(cueLine(c.speaker)).replace(/>/g, '')}>${lines[0]}`;
    out.push(String(i + 1), `${cueTimestamp(c.start_ms, '.')} --> ${cueTimestamp(c.end_ms, '.')}`, ...lines, '');
  });
  return out.join('\n');
}

/**
 * SRT: the same three lines. Some players (AntennaPod) read "Name: " at the start of a cue as its
 * speaker and drop what follows a second colon, so a dialogue speaker leads the cue as "Name: " and
 * any other ": " inside the text becomes "：".
 */
export function toSrt(cues: TranscriptCue[]): string {
  const out: string[] = [];
  let n = 0;
  for (const c of cues) {
    const lines = cueLines(c).map((l) => l.replace(/:\s+/g, '：'));
    if (!lines.length) continue;
    if (c.speaker) lines[0] = `${cueLine(c.speaker).replace(/:/g, '')}: ${lines[0]}`;
    n += 1;
    out.push(String(n), `${cueTimestamp(c.start_ms, ',')} --> ${cueTimestamp(c.end_ms, ',')}`, ...lines, '');
  }
  return out.join('\n');
}

/** Podcasting 2.0 JSON transcript: one segment per cue, `body` = the lines joined by line breaks. */
export function toPodcastJson(cues: TranscriptCue[]): { version: string; segments: Array<{ speaker?: string; startTime: number; endTime: number; body: string }> } {
  return {
    version: '1.0.0',
    segments: cues
      .map((c) => ({
        ...(c.speaker ? { speaker: cueLine(c.speaker) } : {}),
        startTime: c.start_ms / 1000,
        endTime: c.end_ms / 1000,
        body: cueLines(c).join('\n'),
      }))
      .filter((s) => s.body),
  };
}

// ---------------- Show notes ----------------

export function introLine(format: AudioLessonFormat): string {
  return format === 'sleep'
    ? 'Sleep lesson — slow Chinese to fall asleep to.'
    : format === 'story'
      ? 'Listen & repeat — a story or conversation, each line three times slowly, then its English, then twice more.'
      : 'Dialogue lesson — a Chinese conversation, explained in English.';
}

export interface NoteChapter {
  title: string;
  start_ms: number;
  /** Rows in order; `same` stands for a run of Chinese lines identical to an earlier chapter's. */
  items: Array<{ cue: TranscriptCue } | { same: { count: number; chapter: string } }>;
}

/**
 * The transcript by chapter. A chapter whose Chinese lines are exactly an earlier chapter's (a
 * dialogue's second / third / final listen and its line by line; a story's "再听一遍") shows its
 * narration and one "the same N lines as in …" note instead of the whole conversation again —
 * the timed transcript still has every line.
 */
export function notesByChapter(lesson: TranscriptLesson, cues: TranscriptCue[] = transcriptCues(lesson)): NoteChapter[] {
  const chapters: NoteChapter[] = (lesson.chapters ?? []).map((c) => ({ title: chapterTitleWithPinyin(c.title, lesson.words ?? []), start_ms: c.start_ms, items: [] }));
  if (!chapters.length && cues.length) chapters.push({ title: '', start_ms: 0, items: [] });
  const byChapter = new Map<number, TranscriptCue[]>();
  for (const c of cues) {
    const idx = c.chapter >= 0 && c.chapter < chapters.length ? c.chapter : chapters.length - 1;
    const list = byChapter.get(idx);
    if (list) list.push(c);
    else byChapter.set(idx, [c]);
  }
  const seen: Array<{ key: string; title: string }> = [];
  chapters.forEach((ch, i) => {
    const list = byChapter.get(i) ?? [];
    const zh = list.filter((c) => c.lang === 'zh');
    const key = zh.map((c) => c.text).join('\u0001');
    const earlier = zh.length >= 2 ? seen.find((s) => s.key === key) : undefined;
    if (zh.length >= 2 && !earlier) seen.push({ key, title: ch.title || `chapter ${i + 1}` });
    let noted = false;
    for (const c of list) {
      if (earlier && c.lang === 'zh') {
        if (!noted) ch.items.push({ same: { count: zh.length, chapter: earlier.title } });
        noted = true;
        continue;
      }
      ch.items.push({ cue: c });
    }
  });
  return chapters;
}

function escapeHtml(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function sameNote(n: { count: number; chapter: string }): string {
  return `(The same ${n.count} lines as in “${n.chapter}”.)`;
}

function wordsHtml(words: LessonWord[]): string {
  if (!words.length) return '';
  const rows = words.slice(0, 30).map((w) => `${escapeHtml(w.hanzi)} <em>${escapeHtml(w.pinyin)}</em> — ${escapeHtml(w.english)}`);
  return `<p><strong>Words (${words.length})</strong><br/>${rows.join('<br/>')}</p>`;
}

/**
 * The item's HTML show notes (`content:encoded`): what it is, the words, then the whole transcript
 * by chapter — "1:05 · 银行 yínháng" headings (podcast apps make the time tappable), each Chinese line
 * as hanzi (+ speaker, + "×3 +1") / pinyin / English, narration as plain paragraphs.
 * `full: false` = without the transcript (the feed's size budget ran out for this older episode).
 */
export function showNotesHtml(lesson: TranscriptLesson, opts: { full?: boolean; notes?: NoteChapter[] } = {}): string {
  const parts: string[] = [`<p>${escapeHtml(introLine(lesson.format))}</p>`];
  const words = wordsHtml(lesson.words ?? []);
  if (words) parts.push(words);
  const chapters = opts.notes ?? notesByChapter(lesson);
  if (opts.full === false || !chapters.some((c) => c.items.length)) {
    if (lesson.chapters.length) {
      parts.push(`<p><strong>Chapters</strong><br/>${chapters.map((c) => `${formatClock(c.start_ms)} ${escapeHtml(c.title)}`).join('<br/>')}</p>`);
    }
    if (opts.full === false) parts.push('<p><em>The full transcript (hanzi, pinyin, English) is in this episode’s transcript, and in the app.</em></p>');
    return parts.join('\n');
  }
  parts.push('<p><strong>Transcript</strong> — hanzi, pinyin and English, chapter by chapter.</p>');
  for (const ch of chapters) {
    if (ch.title) parts.push(`<h3>${formatClock(ch.start_ms)} · ${escapeHtml(ch.title)}</h3>`);
    for (const item of ch.items) {
      if ('same' in item) {
        parts.push(`<p><em>${escapeHtml(sameNote(item.same))}</em></p>`);
        continue;
      }
      const c = item.cue;
      if (c.lang === 'en' && !c.pinyin && !c.english) {
        parts.push(`<p>${escapeHtml(c.text)}</p>`);
        continue;
      }
      const head = `${c.speaker ? `<strong>${escapeHtml(c.speaker)}:</strong> ` : ''}${escapeHtml(c.text)}${c.repeat ? ` <small>${escapeHtml(c.repeat)}</small>` : ''}`;
      const lines = [head];
      if (c.pinyin) lines.push(`<em>${escapeHtml(c.pinyin)}</em>`);
      if (c.english) lines.push(escapeHtml(c.english));
      parts.push(`<p>${lines.join('<br/>')}</p>`);
    }
  }
  return parts.join('\n');
}

/** Plain-text show notes (`description`, `itunes:summary`) are cut here: some apps show only the first ~4,000 characters. */
export const PLAIN_NOTES_MAX_CHARS = 4000;
const MORE = '… The full transcript (hanzi, pinyin, English) is in the show notes and the episode’s transcript.';

/**
 * Plain text: the intro, the words, the chapters as "0:00 开始 kāi shǐ" timestamps, then the
 * transcript's first lines (hanzi / pinyin / English on their own lines) up to `maxChars`.
 */
export function showNotesText(lesson: TranscriptLesson, maxChars = PLAIN_NOTES_MAX_CHARS, notes?: NoteChapter[]): string {
  const lines: string[] = [introLine(lesson.format)];
  const words = lesson.words ?? [];
  if (words.length) {
    lines.push('', `Words (${words.length}):`);
    for (const w of words.slice(0, 30)) lines.push(`${w.hanzi} ${w.pinyin} — ${w.english}`);
  }
  if (lesson.chapters.length) {
    lines.push('', 'Chapters:');
    for (const c of lesson.chapters) lines.push(`${formatClock(c.start_ms)} ${chapterTitleWithPinyin(c.title, words)}`);
  }
  const head = lines.join('\n');
  const chapters = notes ?? notesByChapter(lesson);
  if (!chapters.some((c) => c.items.length)) return head.slice(0, maxChars);

  const blocks: string[] = [];
  for (const ch of chapters) {
    if (ch.title && ch.items.length) blocks.push(`— ${formatClock(ch.start_ms)} ${ch.title} —`);
    for (const item of ch.items) {
      if ('same' in item) {
        blocks.push(sameNote(item.same));
        continue;
      }
      const c = item.cue;
      const first = `${c.speaker ? `${c.speaker}: ` : ''}${c.text}${c.repeat ? ` ${c.repeat}` : ''}`;
      blocks.push([first, c.pinyin, c.english].filter(Boolean).join('\n'));
    }
  }
  let out = `${head}\n\nTranscript:`;
  for (const b of blocks) {
    const next = `${out}\n\n${b}`;
    if (next.length + MORE.length + 2 > maxChars) {
      return `${out}\n\n${MORE}`.slice(0, maxChars);
    }
    out = next;
  }
  return out;
}

/** Characters of HTML show notes a whole feed carries before older episodes get the short version (~3 MB). */
export const FEED_NOTES_BUDGET_CHARS = 3_000_000;
