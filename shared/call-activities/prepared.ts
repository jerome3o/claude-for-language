/**
 * Prepared activities (docs/VIDEO_CALLS.md "Prepared activities"): in-call
 * activities written FOR ONE STUDENT from their previous lessons — the last
 * lesson report (new words, corrections, topics), the board, the words they
 * struggle with / mix up, recent homework and the tutor's private profile.
 * They are the tutor's material: made in the background after a lesson (and
 * on demand), listed first in the call's ⋯ → 🎲 Activities and on the tutor's
 * student page, never shown or sent to the student until the tutor starts one
 * in a call.
 *
 * A prepared activity is an ordinary ActivitySpec (./types.ts) plus a one-line
 * "why"; the call room starts it from `activity_start { activity_id:
 * "prepared:<id>" }` exactly like a catalogue activity.
 *
 * The rules the two apps share (ordering, headline copy, preview lines) are
 * ported to the Lab app (`core/…/calls/PreparedActivities.kt`) and
 * parity-tested (android-lab/parity/fixtures/call-activities.ts).
 */

import { validateActivitySpec } from './catalogue';
import type { ActivityKind, ActivityLevel, ActivityRole, ActivitySpec, ActivityWord } from './types';

export const PREPARED_ACTIVITY_PREFIX = 'prepared:';
/** The `activity_id` a client starts a prepared activity with. */
export const preparedActivityId = (rowId: string) => `${PREPARED_ACTIVITY_PREFIX}${rowId}`;
/** The prepared row id inside an `activity_id`, or null for a catalogue / review id. */
export function preparedRowId(activityId: string): string | null {
  if (!activityId.startsWith(PREPARED_ACTIVITY_PREFIX)) return null;
  const id = activityId.slice(PREPARED_ACTIVITY_PREFIX.length).trim();
  return /^[A-Za-z0-9_:-]{1,100}$/.test(id) ? id : null;
}

export type PreparedStatus = 'ready' | 'used' | 'dismissed';
export type PrepareTrigger = 'lesson' | 'nightly' | 'manual';
export type PrepareJobStatus = 'queued' | 'running' | 'done' | 'failed';

/** The kinds the generator writes (`review` is built in the call from the recordings queue). */
export const PREPARED_KINDS: ActivityKind[] = ['describe', 'info_gap', 'roleplay', 'build', 'quiz', 'dictation'];
/** How many one generation aims for, and the most it may write. */
export const DEFAULT_PREPARE_COUNT = 5;
export const MAX_PREPARE_COUNT = 6;
/** The "why" line is one short sentence. */
export const MAX_WHY_CHARS = 140;

export interface PreparedActivity {
  id: string;
  relationship_id: string;
  /** The generation it came from. */
  job_id: string;
  spec: ActivitySpec;
  /** One line: why this one, e.g. "Last lesson: 把 sentences — 3 corrections". */
  why: string;
  status: PreparedStatus;
  /** The call lesson it was made from (null = lesson-log notes / no lesson yet). */
  source_lesson_id: string | null;
  /** "Lesson 3 Oct" — what it came from, for the list. */
  source_label: string | null;
  position: number;
  created_at: string;
  used_at: string | null;
  used_in_call_id: string | null;
}

export interface PrepareJob {
  id: string;
  relationship_id: string;
  trigger: PrepareTrigger;
  status: PrepareJobStatus;
  source_lesson_id: string | null;
  created_count: number;
  error: string | null;
  cost_usd: number | null;
  created_at: string;
  finished_at: string | null;
}

/** True while a job is still working (the UIs poll and show "Preparing…"). */
export const prepareJobActive = (job: Pick<PrepareJob, 'status'> | null | undefined) => job?.status === 'queued' || job?.status === 'running';

/**
 * The order both apps list them in: ready ones first (newest batch first, then
 * position), then the used ones (most recently used first). Dismissed ones are
 * left out.
 */
export function orderPrepared<T extends Pick<PreparedActivity, 'status' | 'position' | 'created_at' | 'used_at' | 'id'>>(list: readonly T[]): T[] {
  const ready = list.filter((a) => a.status === 'ready');
  const used = list.filter((a) => a.status === 'used');
  ready.sort((x, y) => (x.created_at === y.created_at ? x.position - y.position || cmp(x.id, y.id) : cmp(y.created_at, x.created_at)));
  used.sort((x, y) => cmp(y.used_at ?? '', x.used_at ?? '') || cmp(x.id, y.id));
  return [...ready, ...used];
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The first name, for short labels ("Jerome Swannack" → "Jerome"). */
export function firstName(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  if (!n) return 'your student';
  return n.split(/\s+/)[0];
}

/** "Ready for next lesson: 5 activities" / "1 activity" / none yet. */
export function preparedHeadline(readyCount: number): string {
  if (readyCount <= 0) return 'No activities ready for the next lesson yet';
  return `Ready for next lesson: ${readyCount} ${readyCount === 1 ? 'activity' : 'activities'}`;
}

/** The call menu's section title: "For Jerome · from last lesson". */
export function preparedSectionTitle(studentName: string | null | undefined): string {
  return `For ${firstName(studentName)} · from last lesson`;
}

const preview = (w: Pick<ActivityWord, 'hanzi' | 'pinyin' | 'english'>) =>
  `${w.hanzi}${w.pinyin ? ` ${w.pinyin}` : ''}${w.english ? ` — ${w.english}` : ''}`;

/**
 * What's inside, as short lines for the preview (the student page, the call
 * menu's expanded row): the words / sentences / questions / lines, at most `max`.
 */
export function activityPreview(spec: ActivitySpec, max = 12): string[] {
  const out: string[] = [];
  switch (spec.kind) {
    case 'describe':
      for (const it of spec.items) out.push(`${it.emoji ? `${it.emoji} ` : ''}${preview(it)}`);
      break;
    case 'info_gap':
      out.push(spec.prompt);
      for (const r of spec.rows) out.push(`${r.label}: ${r.cells.map((c) => c.value).join(' · ')}`);
      break;
    case 'roleplay':
      for (const l of spec.lines) out.push(`${spec.speakers[l.speaker] || l.speaker.toUpperCase()}: ${l.hanzi}`);
      break;
    case 'build':
      for (const it of spec.items) out.push(`${it.tiles.join('')} — ${it.english}`);
      break;
    case 'quiz':
      for (const q of spec.questions) {
        const right = q.options[q.answer] ?? '';
        out.push(`${q.prompt || (q.audio ? `🔊 ${q.audio}` : '?')} → ${right}`);
      }
      break;
    case 'dictation':
    case 'review':
      for (const it of spec.items) out.push(preview(it));
      break;
  }
  if (out.length > max) return [...out.slice(0, max - 1), `… and ${out.length - (max - 1)} more`];
  return out;
}

// ------------------------------------------------------------------ parsing a generated activity

/** The defaults per kind (as the catalogue's samples): role names and the tutor's side. */
export const KIND_ROLE_DEFAULTS: Record<Exclude<ActivityKind, 'review'>, { role_names: { a: string; b: string }; tutor_role: ActivityRole }> = {
  // The STUDENT describes (they do the talking), the tutor guesses.
  describe: { role_names: { a: 'Describer', b: 'Guesser' }, tutor_role: 'b' },
  info_gap: { role_names: { a: 'Partner A', b: 'Partner B' }, tutor_role: 'a' },
  roleplay: { role_names: { a: 'A', b: 'B' }, tutor_role: 'a' },
  build: { role_names: { a: 'Builder', b: 'Builder' }, tutor_role: 'a' },
  quiz: { role_names: { a: 'Asker', b: 'Answerer' }, tutor_role: 'a' },
  dictation: { role_names: { a: 'Reader', b: 'Writer' }, tutor_role: 'a' },
};

const LIMITS = { items: 10, lines: 16, questions: 10, options: 6, rows: 6, columns: 4, choices: 14, tiles: 12, hints: 4, text: 300 };
const LEVELS: ActivityLevel[] = ['beginner', 'elementary', 'intermediate'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = LIMITS.text): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const role = (v: unknown): ActivityRole | null => (v === 'a' || v === 'b' ? v : null);

function word(v: unknown): ActivityWord | null {
  if (!isObj(v)) return null;
  const hanzi = str(v.hanzi, 60);
  if (!hanzi) return null;
  return { hanzi, pinyin: str(v.pinyin, 160), english: str(v.english, 160) };
}

function words(v: unknown, max: number): ActivityWord[] {
  const out: ActivityWord[] = [];
  for (const w of arr(v)) {
    const x = word(w);
    if (x && !out.some((o) => o.hanzi === x.hanzi)) out.push(x);
    if (out.length >= max) break;
  }
  return out;
}

export interface ParsedGeneratedActivity {
  spec: ActivitySpec | null;
  why: string;
  problems: string[];
}

/**
 * One activity as the model wrote it → a spec the engine can play, or the
 * problems to send back in a repair round. Structural checks (types, sizes,
 * caps) first, then `validateActivitySpec` — the same rule the catalogue meets.
 * Small slips are fixed instead of refused: a describe hint with no glossary
 * entry is dropped, missing role names / tutor side take the kind's defaults.
 */
export function parseGeneratedActivity(raw: unknown, id: string, fallbackLevel: ActivityLevel = 'elementary'): ParsedGeneratedActivity {
  const problems: string[] = [];
  if (!isObj(raw)) return { spec: null, why: '', problems: ['not an object'] };
  const kind = raw.kind as ActivityKind;
  if (!PREPARED_KINDS.includes(kind)) return { spec: null, why: str(raw.why, MAX_WHY_CHARS), problems: [`kind must be one of ${PREPARED_KINDS.join(', ')}`] };
  const defaults = KIND_ROLE_DEFAULTS[kind as Exclude<ActivityKind, 'review'>];
  const rn = isObj(raw.role_names) ? raw.role_names : {};
  const titleZh = str(raw.title_zh, 40);
  const base = {
    id,
    title: str(raw.title, 80),
    ...(titleZh ? { title_zh: titleZh } : {}),
    level: LEVELS.includes(raw.level as ActivityLevel) ? (raw.level as ActivityLevel) : fallbackLevel,
    topic: str(raw.topic, 60) || 'Last lesson',
    summary: str(raw.summary, 240),
    role_names: { a: str(rn.a, 30) || defaults.role_names.a, b: str(rn.b, 30) || defaults.role_names.b },
    tutor_role: role(raw.tutor_role) ?? defaults.tutor_role,
  };
  const why = str(raw.why, MAX_WHY_CHARS);
  if (!base.title) problems.push('title is required');
  if (!base.summary) problems.push('summary is required');
  if (!why) problems.push('why is required (one line: what from the last lessons this practises)');

  let spec: ActivitySpec | null = null;
  switch (kind) {
    case 'describe': {
      const glossary = words(raw.glossary, 40);
      const items: Extract<ActivitySpec, { kind: 'describe' }>['items'] = [];
      for (const it of arr(raw.items)) {
        const w = word(it);
        if (!w || !isObj(it) || items.some((x) => x.hanzi === w.hanzi)) continue;
        const hints = arr(it.hints)
          .map((h) => str(h, 30))
          .filter(Boolean)
          .filter((h) => glossary.length === 0 || glossary.some((g) => g.hanzi === h))
          .slice(0, LIMITS.hints);
        items.push({ ...w, emoji: str(it.emoji, 8), hints });
        if (items.length >= LIMITS.items) break;
      }
      const distractors = words(raw.distractors, 8).filter((d) => !items.some((i) => i.hanzi === d.hanzi));
      spec = { ...base, kind, items, distractors, ...(glossary.length ? { glossary } : {}) };
      break;
    }
    case 'info_gap': {
      const columns = arr(raw.columns).map((c) => str(c, 30)).filter(Boolean).slice(0, LIMITS.columns);
      const rows = arr(raw.rows)
        .filter(isObj)
        .slice(0, LIMITS.rows)
        .map((r) => ({
          label: str(r.label, 40),
          cells: arr(r.cells)
            .filter(isObj)
            .map((c) => ({ value: str(c.value, 40), owner: role(c.owner) ?? ('a' as ActivityRole) })),
        }));
      if (columns.length < 1) problems.push('info_gap needs columns');
      if (rows.length < 2) problems.push('info_gap needs at least 2 rows');
      const owners = new Set(rows.flatMap((r) => r.cells.map((c) => c.owner)));
      if (rows.length > 0 && owners.size < 2) problems.push('info_gap: each person must own some cells (owner a AND b)');
      const prompt = str(raw.prompt, 200);
      if (!prompt) problems.push('info_gap needs a prompt (what to ask)');
      spec = { ...base, kind, prompt, phrases: words(raw.phrases, 5), columns, rows, choices: words(raw.choices, LIMITS.choices) };
      break;
    }
    case 'roleplay': {
      const sp = isObj(raw.speakers) ? raw.speakers : {};
      const lines = arr(raw.lines)
        .filter(isObj)
        .map((l) => ({ ...(word(l) ?? { hanzi: '', pinyin: '', english: '' }), speaker: role(l.speaker) ?? ('a' as ActivityRole) }))
        .filter((l) => l.hanzi)
        .slice(0, LIMITS.lines);
      if (lines.length < 4) problems.push('a role-play needs at least 4 lines');
      spec = { ...base, kind, setting: str(raw.setting, 200), speakers: { a: str(sp.a, 20) || base.role_names.a, b: str(sp.b, 20) || base.role_names.b }, lines };
      break;
    }
    case 'build': {
      const items = arr(raw.items)
        .filter(isObj)
        .map((it) => ({ tiles: arr(it.tiles).map((t) => str(t, 20)).filter(Boolean).slice(0, LIMITS.tiles), pinyin: str(it.pinyin, 200), english: str(it.english, 200) }))
        .slice(0, LIMITS.items);
      if (items.length < 2) problems.push('build needs at least 2 sentences');
      spec = { ...base, kind, items };
      break;
    }
    case 'quiz': {
      const questions = arr(raw.questions)
        .filter(isObj)
        .map((q) => {
          const audio = str(q.audio, 60);
          const explanation = str(q.explanation, 240);
          return {
            prompt: str(q.prompt, 200),
            ...(audio ? { audio } : {}),
            options: arr(q.options).map((o) => str(o, 80)).filter(Boolean).slice(0, LIMITS.options),
            answer: typeof q.answer === 'number' && Number.isInteger(q.answer) ? q.answer : -1,
            ...(explanation ? { explanation } : {}),
          };
        })
        .slice(0, LIMITS.questions);
      if (questions.length < 3) problems.push('a quiz needs at least 3 questions');
      questions.forEach((q, i) => {
        if (new Set(q.options).size !== q.options.length) problems.push(`question ${i + 1}: options must differ`);
      });
      spec = { ...base, kind, questions };
      break;
    }
    case 'dictation': {
      const items = words(raw.items, LIMITS.items);
      if (items.length < 3) problems.push('dictation needs at least 3 words');
      spec = { ...base, kind, items };
      break;
    }
  }
  if (spec) problems.push(...validateActivitySpec(spec));
  return { spec: problems.length === 0 ? spec : null, why, problems };
}
