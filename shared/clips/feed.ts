/**
 * The clip feed's order and the "Learn more" sheet's offers (pure; the worker orders
 * `GET /api/clips` with `rankClipFeed`; both apps build the sheet from `learnMoreOffers`, the Lab
 * port is parity-tested).
 */
import type { ClipLearnMoreAction, ClipLessonState, ClipSpec, ClipUserState } from './types';

export interface RankableClip {
  id: string;
  created_at: string;
  words: string[];
  tags: string[];
  topic: string | null;
  state: ClipUserState;
}

export interface FeedContext {
  /** Hanzi the learner has studied recently (their recent reviews / new words). */
  studying: ReadonlySet<string>;
  /** Hanzi of cards they struggle with (Again / Hard lately). */
  struggling: ReadonlySet<string>;
  /** Tags / topics of clips they liked or saved. */
  likedTags: ReadonlySet<string>;
}

/** Unseen = 0, seen but not finished = 1, finished = 2. */
export function clipFeedTier(state: ClipUserState): 0 | 1 | 2 {
  if (state.completed) return 2;
  if (state.viewed) return 1;
  return 0;
}

/** How well a clip fits the learner (higher first within a tier). */
export function clipScore(clip: RankableClip, ctx: FeedContext): number {
  let score = 0;
  for (const w of clip.words) {
    if (ctx.struggling.has(w)) score += 4;
    else if (ctx.studying.has(w)) score += 3;
    else if ([...w].some((ch) => [...ctx.studying].some((s) => s.includes(ch)))) score += 1;
  }
  const tags = [...clip.tags, ...(clip.topic ? [clip.topic] : [])].map((t) => t.toLowerCase());
  for (const t of new Set(tags)) if (ctx.likedTags.has(t)) score += 2;
  if (clip.state.liked) score += 2;
  if (clip.state.saved) score += 1;
  score -= Math.min(clip.state.skips, 3) * 2;
  return score;
}

/**
 * The feed: unseen first, then seen-not-finished, then finished; inside a tier by score, then
 * newest first, then id (stable).
 */
export function rankClipFeed<T extends RankableClip>(clips: readonly T[], ctx: FeedContext): T[] {
  const scored = clips.map((c) => ({ c, tier: clipFeedTier(c.state), score: clipScore(c, ctx) }));
  scored.sort((a, b) => a.tier - b.tier || b.score - a.score || (a.c.created_at < b.c.created_at ? 1 : a.c.created_at > b.c.created_at ? -1 : 0) || (a.c.id < b.c.id ? -1 : 1));
  return scored.map((s) => s.c);
}

/** The liked / saved clips' tags (+ topic), lower-cased: the feed context's `likedTags`. */
export function likedTagsOf(clips: readonly Pick<RankableClip, 'tags' | 'topic' | 'state'>[]): Set<string> {
  const out = new Set<string>();
  for (const c of clips) {
    if (!c.state.liked && !c.state.saved) continue;
    for (const t of c.tags) out.add(t.toLowerCase());
    if (c.topic) out.add(c.topic.toLowerCase());
  }
  return out;
}

export interface LearnMoreOffer {
  action: ClipLearnMoreAction;
  icon: string;
  label: string;
  detail: string;
  /** Needs a connection (generation). */
  online: boolean;
}

/**
 * The "Keep going with <topic>" sheet, in order. The mini lesson says "Open" once it exists and
 * "Writing…" while it is being written; everything that generates needs a connection.
 */
export function learnMoreOffers(spec: Pick<ClipSpec, 'words'>, lesson: ClipLessonState | null): LearnMoreOffer[] {
  const n = spec.words.length;
  const words = n === 1 ? 'this word' : `these ${n} words`;
  const lessonOffer: LearnMoreOffer =
    lesson?.status === 'ready' && lesson.lesson_id
      ? { action: 'lesson', icon: '✨', label: 'Open the mini lesson', detail: 'Made from this clip — ready to play', online: false }
      : lesson?.status === 'generating'
        ? { action: 'lesson', icon: '✨', label: 'Mini lesson — writing…', detail: 'It opens here when it is ready', online: true }
        : { action: 'lesson', icon: '✨', label: 'Mini lesson', detail: `~8 min drilling ${words} and the idea`, online: true };
  return [
    lessonOffer,
    { action: 'reader', icon: '📖', label: 'Graded reader', detail: 'A short story that uses them', online: true },
    { action: 'podcast', icon: '🎧', label: 'Podcast', detail: 'A dialogue audio lesson on this topic', online: true },
    { action: 'study_words', icon: '⚡', label: `Study ${words} today`, detail: 'Cards you have go to the front of today', online: false },
    { action: 'add_card', icon: '＋', label: n === 1 ? 'Add as card' : 'Add as cards', detail: 'New words into a deck', online: false },
    { action: 'more', icon: '🎬', label: 'More clips like this', detail: 'Two more on this topic', online: true },
  ];
}

/** "Keep going with <topic>": the sheet's title. */
export function learnMoreTitle(topic: string): string {
  const t = topic.trim();
  return t ? `Keep going with ${t}` : 'Keep going';
}
