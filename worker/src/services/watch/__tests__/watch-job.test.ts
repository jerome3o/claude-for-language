import { describe, expect, it, vi } from 'vitest';
import { createSqliteD1 } from '../../__tests__/sqlite-d1';
import type { Env } from '../../../types';
import { getVideo, insertVideo, linkVideoUser, parseChunks, parseLines, savePosition, getVideoUser, videoDetail } from '../store';
import { resetFailedVideo, runWatchTranscriptJob, type WatchTranscriptMessage } from '../job';
import { ClipOffsetsUnsupported, fakeWatchTranscriber, geminiWatchTranscriber, watchPrompt, type WatchTranscriber } from '../transcribe';
import { resetGeminiModelMemory } from '../../gemini';
import { fakeSegmentTranslate } from '../../podcasts/translate';

const VID = 'abcdefghijk';

async function setup(durationMs = 11 * 60_000) {
  const db = await createSqliteD1();
  await db.prepare("INSERT INTO users (id, email, name) VALUES ('u1', 'u1@example.com', 'U')").run();
  await insertVideo(db, { id: VID, title: '小欢喜 第1集', channel: 'Channel', duration_ms: durationMs, userId: 'u1' });
  await linkVideoUser(db, 'u1', VID);
  const env = { DB: db, GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' } as unknown as Env;
  const sent: Array<{ msg: WatchTranscriptMessage; delay: number }> = [];
  const requeue = async (msg: WatchTranscriptMessage, delay: number) => {
    sent.push({ msg, delay });
  };
  return { db, env, sent, requeue };
}

async function runToEnd(env: Env, deps: Parameters<typeof runWatchTranscriptJob>[2]) {
  const outs: string[] = [];
  for (let i = 0; i < 30; i++) {
    const out = await runWatchTranscriptJob(env, VID, deps);
    outs.push(out);
    if (out !== 'continue' && out !== 'waiting') break;
  }
  return outs;
}

describe('runWatchTranscriptJob', () => {
  it('reads every window, tidies the lines with pinyin, translates, and is ready', async () => {
    const { env, db, requeue } = await setup();
    const transcriber = vi.fn(fakeWatchTranscriber());
    const outs = await runToEnd(env, { transcriber, translate: fakeSegmentTranslate(), requeue });
    expect(outs[outs.length - 1]).toBe('done');
    expect(transcriber).toHaveBeenCalledTimes(2); // 0–5:00 and 5:00–11:00
    const row = (await getVideo(db, VID))!;
    expect(row.status).toBe('ready');
    expect(row.chunks_done).toBe(2);
    const lines = parseLines(row.lines_json);
    expect(lines.length).toBeGreaterThan(100);
    expect(lines[0]).toMatchObject({ i: 0, start_ms: 2000, zh: '你怎么才回来？饭都凉了。', speaker: '妈妈' });
    expect(lines[0].pinyin).toMatch(/nǐ/);
    expect(lines.every((l) => l.english)).toBe(true);
    expect(lines.every((l, i) => i === 0 || l.start_ms > lines[i - 1].start_ms)).toBe(true);
    expect(JSON.parse(row.usage_json!).cost_usd).toBeGreaterThan(0);
  });

  it('shows the lines of finished windows while the rest is still being read', async () => {
    const { env, db, requeue } = await setup();
    let calls = 0;
    const fake = fakeWatchTranscriber();
    const transcriber: WatchTranscriber = async (req) => {
      calls++;
      if (calls === 2) throw new Error('Gemini 503: overloaded');
      return fake(req);
    };
    expect(await runWatchTranscriptJob(env, VID, { transcriber, translate: fakeSegmentTranslate(), requeue })).toBe('waiting');
    const row = (await getVideo(db, VID))!;
    expect(row.status).toBe('transcribing');
    expect(row.chunks_done).toBe(1);
    const detail = videoDetail(row, await getVideoUser(db, 'u1', VID));
    expect(detail.lines.length).toBeGreaterThan(50);
    expect(detail.lines.every((l) => l.start_ms < 300_000)).toBe(true);
    expect(detail.error).toMatch(/overloaded/);
  });

  it('skips a window that keeps failing (a gap) and still finishes', async () => {
    const { env, db, requeue } = await setup();
    const fake = fakeWatchTranscriber();
    const transcriber: WatchTranscriber = async (req) => {
      if (req.window.start_ms > 0) throw new Error('bad window');
      return fake(req);
    };
    const outs = await runToEnd(env, { transcriber, translate: fakeSegmentTranslate(), requeue });
    expect(outs[outs.length - 1]).toBe('done');
    const row = (await getVideo(db, VID))!;
    const detail = videoDetail(row, null);
    expect(detail.gaps).toEqual([{ start_ms: 300_000, end_ms: 660_000 }]);
    // Retry tries the skipped window again.
    await db.prepare("UPDATE watch_videos SET status = 'failed' WHERE id = ?").bind(VID).run();
    await resetFailedVideo(db, (await getVideo(db, VID))!);
    const again = (await getVideo(db, VID))!;
    expect(again.status).toBe('transcribing');
    expect(parseChunks(again.chunks_json).map((c) => c.status)).toEqual(['done', 'pending']);
  });

  it('fails readably when nothing could be read', async () => {
    const { env, db, requeue } = await setup();
    const transcriber: WatchTranscriber = async () => {
      throw new Error('Gemini 400: video unavailable');
    };
    const outs = await runToEnd(env, { transcriber, translate: null, requeue });
    expect(outs[outs.length - 1]).toBe('failed');
    expect((await getVideo(db, VID))!.error).toMatch(/video unavailable/);
  });

  it('reads the whole video when clipping offsets are refused', async () => {
    const { env, db, requeue } = await setup();
    const fake = fakeWatchTranscriber();
    const seen: Array<boolean | undefined> = [];
    const transcriber: WatchTranscriber = async (req) => {
      seen.push(req.whole);
      if (!req.whole) throw new ClipOffsetsUnsupported('video_metadata is not supported');
      return fake(req);
    };
    const outs = await runToEnd(env, { transcriber, translate: null, requeue });
    expect(outs[outs.length - 1]).toBe('done');
    expect(seen).toEqual([undefined, true]);
    const row = (await getVideo(db, VID))!;
    expect(parseLines(row.lines_json).at(-1)!.start_ms).toBeGreaterThan(600_000);
    // No Claude: ready with pinyin, English empty.
    expect(parseLines(row.lines_json)[0].english).toBeNull();
  });

  it('saves my position', async () => {
    const { db } = await setup();
    expect(await savePosition(db, 'u1', VID, 12_345.6)).toBe(true);
    expect((await getVideoUser(db, 'u1', VID))!.position_ms).toBe(12_346);
    expect(await savePosition(db, 'u2', VID, 1)).toBe(false);
  });
});

describe('geminiWatchTranscriber', () => {
  it('sends the YouTube URL with clipping offsets, low resolution, and parses absolute times', async () => {
    resetGeminiModelMemory();
    const bodies: Array<Record<string, any>> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init!.body)));
      const text = JSON.stringify([
        { start: '5:01.5', end: '5:03.0', zh: '你回来啦？', speaker: '妈妈' },
        { start: '5:04.0', end: '5:06.2', zh: '嗯，刚到。' },
      ]);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 30000, candidatesTokenCount: 900 } }), { status: 200 });
    });
    const t = geminiWatchTranscriber('key', fetchImpl as never);
    const out = await t({ videoId: VID, title: 'x', window: { start_ms: 300_000, end_ms: 600_000 } });
    expect(out.lines.map((l) => [l.start_ms, l.end_ms, l.zh])).toEqual([
      [301_500, 303_000, '你回来啦？'],
      [304_000, 306_200, '嗯，刚到。'],
    ]);
    expect(out.usage).toEqual({ input_tokens: 30000, output_tokens: 900 });
    const part = bodies[0].contents[0].parts[0];
    expect(part.file_data.file_uri).toBe(`https://www.youtube.com/watch?v=${VID}`);
    expect(part.video_metadata).toEqual({ start_offset: '300s', end_offset: '600s' });
    expect(bodies[0].generationConfig.mediaResolution).toBe('MEDIA_RESOLUTION_LOW');
  });

  it('turns a refusal of the offsets into ClipOffsetsUnsupported', async () => {
    resetGeminiModelMemory();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'Invalid video_metadata: start_offset not supported' } }), { status: 400 }));
    const t = geminiWatchTranscriber('key', fetchImpl as never);
    await expect(t({ videoId: VID, title: 'x', window: { start_ms: 0, end_ms: 300_000 } })).rejects.toBeInstanceOf(ClipOffsetsUnsupported);
  });

  it('asks for subtitles first and times from the start of the whole video', () => {
    const p = watchPrompt({ videoId: VID, title: '小欢喜', window: { start_ms: 300_000, end_ms: 600_000 } });
    expect(p).toMatch(/burned-in Chinese subtitles/);
    expect(p).toMatch(/START OF THE WHOLE VIDEO/);
    expect(p).toMatch(/5:00 to 10:00/);
  });
});
