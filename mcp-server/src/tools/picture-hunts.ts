/**
 * Picture hunts (看图找词, worker routes/picture-hunts.ts): the learner types the
 * Chinese names of things in a picture. These tools list the user's hunts and
 * start a new one from a scene description; playing happens in the app
 * (/picture-hunt/<id>). Building takes a minute or two in the background.
 */
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { guard, jsonResult } from './context.js';

interface HuntSummary {
  id: string;
  title: string;
  source: string;
  status: string;
  progress: string | null;
  error: string | null;
  object_count: number;
  best_found: number | null;
  play_count: number;
  created_at: string;
}

export function trimHunt(h: HuntSummary) {
  return {
    id: h.id,
    title: h.title,
    source: h.source,
    status: h.status,
    ...(h.status === 'generating' ? { progress: h.progress } : {}),
    ...(h.status === 'error' ? { error: h.error } : {}),
    object_count: h.object_count,
    best_found: h.best_found,
    play_count: h.play_count,
    created_at: h.created_at,
    play_path: `/picture-hunt/${h.id}`,
  };
}

export function registerPictureHuntTools(ctx: ToolContext): void {
  const { server, api } = ctx;

  server.tool(
    'list_picture_hunts',
    'The user\'s picture hunts (看图找词): pictures whose objects are named in Chinese for the learner to find by typing. Each has status (generating with a progress stage / ready / error), object count and the learner\'s best score (objects found) and play count. Play one in the app at play_path.',
    {},
    async () =>
      guard(async () => {
        const { hunts } = await api.get<{ hunts: HuntSummary[] }>('/api/picture-hunts');
        return jsonResult({ hunts: hunts.map(trimHunt) });
      })
  );

  server.tool(
    'create_picture_hunt',
    'Start a new picture hunt: a picture is generated from the scene description (e.g. "a busy street market in Chengdu"), its objects found and named in Chinese in the background (a minute or two; poll list_picture_hunts). By default the picture leans toward words the learner is studying (all decks, or deck_ids).',
    {
      prompt: z.string().min(1).max(300).describe('What the picture shows — a scene full of nameable things.'),
      deck_ids: z.array(z.string()).max(50).optional().describe('Lean toward words from these decks (default: all decks).'),
      use_learning_words: z.boolean().optional().describe('false = don\'t lean toward the learner\'s words.'),
    },
    async ({ prompt, deck_ids, use_learning_words }) =>
      guard(async () => {
        const { hunt } = await api.post<{ hunt: HuntSummary }>('/api/picture-hunts', { prompt, deck_ids, use_learning_words });
        return jsonResult({ hunt: trimHunt(hunt), note: 'Building in the background — check list_picture_hunts in a minute or two.' });
      })
  );
}
