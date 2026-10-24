/**
 * 🎬 Clips (experimental; worker routes/clips.ts, shared/clips, docs/CLIPS.md): short vertical
 * learning clips the apps play from a JSON script (spec v1). Every tool works in the SIGNED-IN
 * user's own account and sends nothing to anyone:
 *   create_clip     — import a hand-written spec (pre-checked with validateClipSpec; POST /api/clips)
 *   list_clips      — the feed, trimmed (title, status, theme, words, liked / watched)
 *   get_clip        — one clip's full spec
 *   generate_clips  — Claude writes 1–3 clips in the background (POST /api/clips/generate)
 */
import { z } from 'zod';
import { CLIP_SPEC_DOC } from '../../../shared/clips/doc';
import { validateClipSpec } from '../../../shared/clips/validate';
import { clipDurationMs, formatClipDuration } from '../../../shared/clips/timeline';
import type { ClipRecord } from '../../../shared/clips/types';
import type { PinyinFix } from '../../../shared/pinyin/fixes';
import type { ToolContext } from './context.js';
import { errorResult, guard, jsonResult } from './context.js';

const appPath = (id: string) => `/clips/${id}`;

/** A clip for a chat: no picture keys, the spec only when asked for. */
export function shapeClip(clip: ClipRecord, withSpec = false) {
  const spec = clip.spec;
  return {
    id: clip.id,
    status: clip.status,
    source: clip.source,
    title: clip.title,
    topic: clip.topic,
    theme: clip.theme,
    ...(spec
      ? {
          hook: spec.hook,
          words: spec.words.map((w) => `${w.hanzi} (${w.pinyin}) ${w.english}`),
          scenes: spec.scenes.length,
          length: formatClipDuration(clipDurationMs(spec)),
        }
      : {}),
    ...(clip.status === 'generating' ? { progress: clip.progress } : {}),
    ...(clip.status === 'failed' ? { error: clip.error } : {}),
    watched: clip.state.completed ? 'finished' : clip.state.viewed ? 'started' : 'not yet',
    liked: clip.state.liked,
    saved: clip.state.saved,
    ...(clip.lesson ? { mini_lesson: clip.lesson } : {}),
    app_path: appPath(clip.id),
    ...(withSpec && spec ? { spec } : {}),
  };
}

export function registerClipTools(ctx: ToolContext): void {
  const { server, api } = ctx;

  server.tool(
    'create_clip',
    `Import ONE 🎬 clip (experimental: a short vertical "TikTok"-style learning clip the app plays from a JSON script) into the signed-in user's own clip feed. Write the spec exactly as documented below; it is checked first and any problems come back as a list to fix. Impossible pinyin is corrected on import (listed in pinyin_fixes). The voice lines and pictures are made in the background so it plays instantly. Sends nothing to anyone.\n\n${CLIP_SPEC_DOC}`,
    {
      spec: z.record(z.unknown()).describe('The clip spec v1 (the JSON object documented above).'),
    },
    async ({ spec }) =>
      guard(async () => {
        const problems = validateClipSpec(spec);
        if (problems.length) return errorResult(`The clip isn't valid yet — fix these and call create_clip again:\n${problems.map((p) => `- ${p}`).join('\n')}`);
        const res = await api.post<{ clip: ClipRecord; pinyin_fixes: PinyinFix[] }>('/api/clips', { spec, source: 'agent' });
        return jsonResult({
          clip: shapeClip(res.clip),
          ...(res.pinyin_fixes?.length ? { pinyin_fixes: res.pinyin_fixes.map((f) => ({ where: f.where, hanzi: f.hanzi, before: f.before, after: f.after })) } : {}),
          note: `Saved in the user's clip feed (open ${appPath(res.clip.id)} in the app).`,
        });
      }),
  );

  server.tool(
    'list_clips',
    'List the signed-in user\'s 🎬 clips (experimental) in feed order — unseen first, then by how well they fit what they are studying: title, status (ready / generating / failed), theme, focus words, length, whether they watched / liked / saved it, and its mini lesson if one was made. Read only.',
    {
      status: z.enum(['ready', 'generating', 'failed']).optional().describe('Only clips in this state.'),
      limit: z.number().int().min(1).max(80).optional().describe('At most this many (default 30).'),
    },
    async ({ status, limit }) =>
      guard(async () => {
        const { clips } = await api.get<{ clips: ClipRecord[] }>('/api/clips');
        const picked = clips.filter((c) => !status || c.status === status).slice(0, limit ?? 30);
        return jsonResult({ total: clips.length, clips: picked.map((c) => shapeClip(c)) });
      }),
  );

  server.tool(
    'get_clip',
    'One 🎬 clip of the signed-in user with its full spec (scenes, voice lines, words) — fetch it before writing a similar one. Read only.',
    { clip_id: z.string().describe('The clip id (from list_clips / create_clip).') },
    async ({ clip_id }) =>
      guard(async () => {
        const { clip } = await api.get<{ clip: ClipRecord }>(`/api/clips/${encodeURIComponent(clip_id)}`);
        return jsonResult({ clip: shapeClip(clip, true) });
      }),
  );

  server.tool(
    'generate_clips',
    'Have Claude write 1–3 new 🎬 clips (experimental) for the signed-in user in the background, around a topic and/or focus words, using what they are studying and struggling with lately. They appear in the feed in about a minute (poll with list_clips). Costs a little model time; use when the user asked for clips. Sends nothing to anyone.',
    {
      topic: z.string().max(120).optional().describe('What the clips are about, e.g. "刚 vs 刚才" or "ordering coffee".'),
      words: z.array(z.string()).max(6).optional().describe('Focus words (hanzi) to build them around.'),
      count: z.number().int().min(1).max(3).optional().describe('How many (default 1; each takes a different angle).'),
    },
    async ({ topic, words, count }) =>
      guard(async () => {
        const res = await api.post<{ clips: ClipRecord[] }>('/api/clips/generate', { ...(topic ? { topic } : {}), ...(words?.length ? { words } : {}), count: count ?? 1, via: 'mcp' });
        return jsonResult({ started: res.clips.length, clips: res.clips.map((c) => shapeClip(c)), note: 'Being written — call list_clips in a minute or two.' });
      }),
  );
}
