/**
 * 📺 Watch — Gemini reads a public YouTube video (docs/WATCH.md "How the transcript is made").
 *
 * The Gemini API takes a public YouTube URL as `file_data.file_uri`: it hears the audio and sees
 * the frames (1 per second by default), so it can copy the burned-in Chinese subtitles these
 * dramas have. We ask for one ~5-minute window at a time (`video_metadata.start_offset` /
 * `end_offset`) at low media resolution, and for JSON lines with times from the start of the
 * WHOLE video. If a model refuses the clipping offsets (a 400 that names them) the job falls back
 * to reading the whole video in one call (videos up to WATCH_WHOLE_MAX_MS).
 *
 * Nothing of YouTube's is downloaded, stored or proxied: Google fetches the video itself.
 */
import { GEMINI_FLASH_MODELS, GeminiError, geminiGenerateContent, leastThinking, type FetchLike } from '../gemini';
import { checkWatchChunk, parseGeminiWatchLines, watchClock, youtubeWatchUrl, type RawWatchLine } from '@shared/watch';

export interface WatchWindowRequest {
  videoId: string;
  title: string;
  /** The window, in ms from the start of the video. `whole` = no clipping offsets. */
  window: { start_ms: number; end_ms: number };
  whole?: boolean;
}

export interface WatchWindowResult {
  lines: RawWatchLine[];
  model: string;
  usage?: { input_tokens: number; output_tokens: number };
}

export type WatchTranscriber = (req: WatchWindowRequest) => Promise<WatchWindowResult>;

/** The model refused the clipping offsets: read the whole video instead. */
export class ClipOffsetsUnsupported extends Error {}

/** A whole-video fallback reads at most this much (one answer has to hold every line). */
export const WATCH_WHOLE_MAX_MS = 60 * 60 * 1000;

/** Gemini 3.x Flash list prices per million tokens (input incl. video / audio, output). */
export const WATCH_GEMINI_PRICE = { input: 0.75, output: 3.75 };

const SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      start: { type: 'STRING' },
      end: { type: 'STRING' },
      zh: { type: 'STRING' },
      speaker: { type: 'STRING' },
    },
    required: ['start', 'end', 'zh'],
    propertyOrdering: ['start', 'end', 'zh', 'speaker'],
  },
};

export function watchPrompt(req: WatchWindowRequest): string {
  const where = req.whole
    ? 'the whole video'
    : `the part of the video from ${watchClock(req.window.start_ms)} to ${watchClock(req.window.end_ms)} (times of the whole video)`;
  return `This is a Chinese TV drama episode on YouTube${req.title ? ` ("${req.title}")` : ''}. A learner of Chinese will watch it line by line with your transcript under the video.

Make a timed transcript of every line of dialogue in ${where}. For each line give:
- start, end: when the line is spoken, as "MM:SS.s" (or "H:MM:SS.s") counted from the START OF THE WHOLE VIDEO — not from the start of the part you were given. Be as precise as you can (tenths of a second).
- zh: the line in simplified Chinese characters. When the video shows burned-in Chinese subtitles, copy the subtitle text exactly — it is the most reliable record of the line; when there are none, write what is said. Convert traditional characters to simplified. Keep the sentence punctuation (，。？！); add it if the subtitle has none.
- speaker: the character's name when it is clearly known from the video, otherwise leave it out.

One subtitle (or one spoken sentence) = one line: never merge several into one line. Skip the opening and closing credits, song lyrics, on-screen titles, signs, adverts and narration in other languages. Never translate and never add pinyin. If nothing is said in this part, return an empty list.`;
}

/** Gemini reading one window of a YouTube video. */
export function geminiWatchTranscriber(apiKey: string, fetchImpl?: FetchLike): WatchTranscriber {
  return async (req) => {
    const videoPart: Record<string, unknown> = { file_data: { file_uri: youtubeWatchUrl(req.videoId) } };
    if (!req.whole) {
      videoPart.video_metadata = {
        start_offset: `${Math.floor(req.window.start_ms / 1000)}s`,
        end_offset: `${Math.ceil(req.window.end_ms / 1000)}s`,
      };
    }
    let result: { data: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }; model: string };
    try {
      result = await geminiGenerateContent({
        apiKey,
        models: GEMINI_FLASH_MODELS,
        fetch: fetchImpl,
        label: 'watch transcript',
        body: (m) => {
          const thinkingConfig = leastThinking(m);
          return {
            contents: [{ parts: [videoPart, { text: watchPrompt(req) }] }],
            generationConfig: {
              temperature: 0,
              responseMimeType: 'application/json',
              responseSchema: SCHEMA,
              mediaResolution: 'MEDIA_RESOLUTION_LOW',
              maxOutputTokens: req.whole ? 65_536 : 16_384,
              ...(thinkingConfig ? { thinkingConfig } : {}),
            },
          };
        },
      });
    } catch (err) {
      if (!req.whole && err instanceof GeminiError && err.status === 400 && /offset|video_metadata|videoMetadata|clip/i.test(err.googleMessage)) {
        throw new ClipOffsetsUnsupported(err.googleMessage);
      }
      throw err;
    }
    const cand = result.data.candidates?.[0];
    const text = cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!text.trim()) throw new Error(`Gemini gave no transcript${cand?.finishReason ? ` (${cand.finishReason})` : ''}`);
    const lines = parseGeminiWatchLines(text, req.window);
    const problem = checkWatchChunk(lines, req.window);
    if (problem) throw new Error(`Gemini's transcript looks wrong: ${problem}`);
    const u = result.data.usageMetadata;
    return { lines, model: result.model, usage: u ? { input_tokens: u.promptTokenCount ?? 0, output_tokens: u.candidatesTokenCount ?? 0 } : undefined };
  };
}

/**
 * E2E_TEST_MODE: the stand-in transcript (self-written dialogue, not from any show) — a family
 * evening before an exam, a line every ~4 s from 0:02, for whatever window is asked.
 */
export const FAKE_WATCH_LINES: Array<{ zh: string; speaker: string }> = [
  { zh: '你怎么才回来？饭都凉了。', speaker: '妈妈' },
  { zh: '学校今天开家长会，老师留我们说了几句。', speaker: '儿子' },
  { zh: '老师说什么了？是不是又说你上课不认真？', speaker: '妈妈' },
  { zh: '没有，她说我最近进步挺大的。', speaker: '儿子' },
  { zh: '真的吗？那太好了，快坐下吃饭吧。', speaker: '妈妈' },
  { zh: '爸爸呢？他今天又加班吗？', speaker: '儿子' },
  { zh: '他说马上就到，让我们先吃。', speaker: '妈妈' },
  { zh: '我明天想跟同学去图书馆复习。', speaker: '儿子' },
  { zh: '可以啊，不过晚上十点以前一定要回家。', speaker: '妈妈' },
  { zh: '知道了，你放心吧。', speaker: '儿子' },
  { zh: '我回来了！今天的菜好香啊。', speaker: '爸爸' },
  { zh: '你来得正好，儿子有好消息告诉你。', speaker: '妈妈' },
];

export const FAKE_LINE_EVERY_MS = 4000;

export function fakeWatchTranscriber(): WatchTranscriber {
  return async (req) => {
    const lines: RawWatchLine[] = [];
    for (let t = Math.ceil(req.window.start_ms / FAKE_LINE_EVERY_MS) * FAKE_LINE_EVERY_MS + 2000; t + 3000 <= req.window.end_ms; t += FAKE_LINE_EVERY_MS) {
      const n = Math.floor((t - 2000) / FAKE_LINE_EVERY_MS);
      const l = FAKE_WATCH_LINES[n % FAKE_WATCH_LINES.length];
      lines.push({ start_ms: t, end_ms: t + 3200, zh: l.zh, speaker: l.speaker });
    }
    return { lines, model: 'fake', usage: { input_tokens: 1000, output_tokens: 200 } };
  };
}
