/**
 * 🎯 Structures to use in a video call — the worker's half (rules in shared/calls/goals.ts,
 * docs/VIDEO_CALLS.md "Structures to use").
 *
 * - `initCallGoals`: the room's list on the first join. A call in a lesson whose earlier call had a
 *   list carries that list on (a dropped call doesn't start over); otherwise 3–5 structures from
 *   the student's mini lessons (`getLearnerStructures`), preferring ones he hasn't used in an earlier
 *   call (`usedGoalNames`). Never throws: no list is an empty list.
 * - `saveCallGoals`: the room's list → `call_goals` (migration 0159), the call's rows replaced.
 * - `lessonGoals`: a lesson's goals for the review page, the report and the homework agent.
 * - `checkStructureUse`: "is the structure really used here, in its sense?" — one small model call
 *   (structuredCall, forced tool, thinking off), cached per structure + sentence; E2E_TEST_MODE
 *   answers with `fakeStructureCheck` first.
 */
import {
  goalsFromStructures,
  mergeLessonGoals,
  pickCallGoals,
  sanitizeCallGoals,
  type CallGoal,
  type CallGoals,
} from '@shared/calls';
import { getLearnerStructures } from '../learner-structures';
import { structuredCall } from '../structured-call';
import { HAIKU_MODEL } from '../models';

/** The relationship's student (null in a solo call → the caller), and their name. */
export async function goalsStudent(db: D1Database, call: { relationship_id: string | null; created_by: string }, tutorId: string | null): Promise<{ id: string; name: string } | null> {
  let studentId: string | null = call.created_by;
  if (call.relationship_id) {
    const rel = await db
      .prepare('SELECT requester_id, recipient_id FROM tutor_relationships WHERE id = ?')
      .bind(call.relationship_id)
      .first<{ requester_id: string; recipient_id: string }>();
    if (!rel) return null;
    studentId = tutorId === rel.requester_id ? rel.recipient_id : tutorId === rel.recipient_id ? rel.requester_id : null;
  }
  if (!studentId) return null;
  const user = await db.prepare('SELECT name FROM users WHERE id = ?').bind(studentId).first<{ name: string | null }>();
  return { id: studentId, name: user?.name ?? '' };
}

/** Structures he used (ticked) in any earlier call. */
export async function usedGoalNames(db: D1Database, studentId: string): Promise<string[]> {
  const rows = await db
    .prepare(`SELECT DISTINCT name FROM call_goals WHERE student_id = ? AND status = 'used' LIMIT 500`)
    .bind(studentId)
    .all<{ name: string }>();
  return (rows.results ?? []).map((r) => r.name);
}

async function goalsOfCall(db: D1Database, callId: string): Promise<CallGoal[]> {
  const rows = await db
    .prepare('SELECT goal_json FROM call_goals WHERE call_id = ? ORDER BY position')
    .bind(callId)
    .all<{ goal_json: string }>();
  const goals: CallGoal[] = [];
  for (const r of rows.results ?? []) {
    try {
      goals.push(JSON.parse(r.goal_json) as CallGoal);
    } catch {
      /* a broken row is skipped */
    }
  }
  return sanitizeCallGoals({ goals })?.goals ?? [];
}

export interface GoalsCall {
  id: string;
  relationship_id: string | null;
  lesson_id: string | null;
  created_by: string;
}

/** The list a call starts with (see the file comment). */
export async function initCallGoals(db: D1Database, call: GoalsCall, tutorId: string | null, now: number, newId: () => string = () => crypto.randomUUID()): Promise<CallGoals | null> {
  const student = await goalsStudent(db, call, tutorId);
  if (!student) return null;
  // The lesson's earlier call (the connection dropped, someone switched device): carry its list on.
  if (call.lesson_id) {
    const prev = await db
      .prepare(`SELECT g.call_id FROM call_goals g JOIN calls c ON c.id = g.call_id WHERE c.lesson_id = ? AND g.call_id != ? ORDER BY c.created_at DESC LIMIT 1`)
      .bind(call.lesson_id, call.id)
      .first<{ call_id: string }>();
    if (prev) {
      const carried = await goalsOfCall(db, prev.call_id);
      if (carried.length) {
        return { student_id: student.id, student_name: student.name, goals: carried.map((g) => (g.status === 'checking' ? { ...g, status: 'open' as const, checking: null } : g)), v: 1, available: carried.length };
      }
    }
  }
  const structures = await getLearnerStructures(db, student.id);
  const used = await usedGoalNames(db, student.id);
  const picked = pickCallGoals(structures, used, now);
  return { student_id: student.id, student_name: student.name, goals: goalsFromStructures(picked, newId), v: 1, available: structures.length };
}

/** The room's list → `call_goals` (that call's rows replaced). */
export async function saveCallGoals(db: D1Database, where: { callId: string; lessonId: string | null; relationshipId: string | null }, goals: CallGoals, now = Date.now()): Promise<void> {
  const stmts = [db.prepare('DELETE FROM call_goals WHERE call_id = ?').bind(where.callId)];
  goals.goals.forEach((g, i) => {
    stmts.push(
      db
        .prepare(
          `INSERT INTO call_goals (id, call_id, lesson_id, relationship_id, student_id, position, name, goal_json, status, used_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(g.id, where.callId, where.lessonId, where.relationshipId, goals.student_id, i, g.name, JSON.stringify(g), g.status, g.used?.at ?? null, now),
    );
  });
  await db.batch(stmts);
}

/** A lesson's goals from its calls (oldest call first; a structure used in any call stays used). */
export async function lessonGoals(db: D1Database, callIds: string[]): Promise<CallGoal[]> {
  const lists: CallGoal[][] = [];
  for (const id of callIds) lists.push(await goalsOfCall(db, id));
  return mergeLessonGoals(lists);
}

// ------------------------------------------------------------------ the check

export interface StructureCheckInput {
  name: string;
  line?: string | null;
  meaning?: string | null;
  fixed: string[];
  sentence: string;
}

export interface StructureCheck {
  ok: boolean;
  /** One short line (English) — why not, or what it means; never shown as a grade. */
  reason: string;
}

export const STRUCTURE_CHECK_MODEL = HAIKU_MODEL;
const CACHE_MAX = 1_000;
const cache = new Map<string, StructureCheck>();

export function structureCheckKey(i: Pick<StructureCheckInput, 'name' | 'sentence'>): string {
  return `${i.name.trim()}\u0000${i.sentence.replace(/\s+/g, ' ').trim()}`;
}

export function cachedStructureCheck(i: Pick<StructureCheckInput, 'name' | 'sentence'>): StructureCheck | null {
  return cache.get(structureCheckKey(i)) ?? null;
}

function remember(i: StructureCheckInput, r: StructureCheck): void {
  const key = structureCheckKey(i);
  cache.delete(key);
  cache.set(key, r);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

/**
 * E2E_TEST_MODE's stand-in (checked FIRST, never only when no key is set): the words already matched,
 * so it says yes — unless the sentence holds 随便 ("just random words"), the specs' near miss.
 */
export function fakeStructureCheck(i: StructureCheckInput): StructureCheck {
  return i.sentence.includes('随便')
    ? { ok: false, reason: 'The words are there, but not used as the structure.' }
    : { ok: true, reason: `Uses ${i.name}.` };
}

const SYSTEM = `A Chinese learner is trying to use a grammar structure while talking with his tutor in a video lesson. His speech was transcribed by speech recognition (punctuation and homophones may be off — never hold that against him). Every fixed word of the structure is in the sentence, in order: decide whether he actually USES THE STRUCTURE in its meaning, the way it is taught — not just says those words by coincidence (e.g. 一 as the number "one" next to an unrelated 就 is not 一…就…; 还 meaning "give back" is not 除了…还…). Small grammar slips elsewhere in the sentence don't matter; a structure used clumsily but recognisably in its sense counts. Answer with the judge tool: used (true / false) and one short English reason (at most 15 words).`;

const TOOL = {
  name: 'judge',
  description: 'Whether the sentence uses the structure in its sense.',
  input_schema: {
    type: 'object' as const,
    properties: {
      used: { type: 'boolean' },
      reason: { type: 'string' },
    },
    required: ['used', 'reason'],
  },
};

/** The model's answer, cleaned. */
export function cleanStructureCheck(input: unknown): StructureCheck {
  const r = (input ?? {}) as { used?: unknown; reason?: unknown };
  if (typeof r.used !== 'boolean') throw new Error('No verdict');
  return { ok: r.used, reason: typeof r.reason === 'string' ? r.reason.replace(/\s+/g, ' ').trim().slice(0, 160) : '' };
}

/** One check (cached). Throws StructuredCallError when the model can't answer. */
export async function checkStructureUse(
  env: { ANTHROPIC_API_KEY?: string; E2E_TEST_MODE?: string },
  input: StructureCheckInput,
  opts: { client?: Parameters<typeof structuredCall>[0]['client']; onUsage?: (u: { input_tokens: number; output_tokens: number }, model: string) => void } = {},
): Promise<StructureCheck & { cached: boolean }> {
  const hit = cachedStructureCheck(input);
  if (hit) return { ...hit, cached: true };
  let result: StructureCheck;
  if (env.E2E_TEST_MODE === 'true') {
    result = fakeStructureCheck(input);
  } else {
    if (!env.ANTHROPIC_API_KEY) throw new Error('no key');
    const user = [
      `Structure: ${input.name}${input.line ? ` (${input.line})` : ''}${input.meaning ? ` — ${input.meaning}` : ''}`,
      `Fixed words, in order: ${input.fixed.join(' … ')}`,
      `What he said: ${input.sentence}`,
    ].join('\n');
    result = await structuredCall<StructureCheck>({
      apiKey: env.ANTHROPIC_API_KEY,
      model: STRUCTURE_CHECK_MODEL,
      fallbackModel: null,
      attempts: 2,
      timeoutMs: 8_000,
      maxRetries: 0,
      system: SYSTEM,
      user,
      tool: TOOL,
      maxTokens: 200,
      validate: cleanStructureCheck,
      client: opts.client,
      onUsage: opts.onUsage,
    });
  }
  remember(input, result);
  return { ...result, cached: false };
}
