/**
 * SQL for the session-notes agent (tutor_note_jobs, migration 0071) and the
 * read-only lookups its tools make on the student's account. Writes to decks /
 * notes / lessons / readers never happen here — the agent goes through the
 * content service, the lesson library and the reader queries like every other
 * caller.
 */

export type TutorNotesJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type TutorNotesPriority = 'core' | 'non_urgent';

export interface TutorNotesStep {
  at: string;
  /** Short line for the progress list ("Added 12 cards to 'Restaurant'"). */
  text: string;
  kind: 'info' | 'tool' | 'warn' | 'done' | 'error';
}

export interface TutorNotesResult {
  deck?: { id: string; name: string; note_count: number; target_deck_id?: string; shared_at?: string };
  lessons?: Array<{ library_item_id: string; title: string; lesson_id?: string; exercise_count: number }>;
  reader?: { id: string; title_english: string; title_chinese: string; page_count: number; target_reader_id?: string };
  /** The agent's closing note to the tutor: what was made, what was skipped and why. */
  summary?: string;
  skipped?: string[];
}

export interface TutorNotesJobRow {
  id: string;
  relationship_id: string;
  tutor_id: string;
  student_id: string;
  title: string | null;
  notes: string;
  lesson_at: string | null;
  priority: TutorNotesPriority;
  auto_share: number;
  status: TutorNotesJobStatus;
  progress: string | null;
  steps: string;
  transcript: string | null;
  rounds: number;
  result: string;
  error: string | null;
  lesson_log_id: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface TutorNotesJob extends Omit<TutorNotesJobRow, 'steps' | 'result' | 'transcript'> {
  steps: TutorNotesStep[];
  result: TutorNotesResult;
  transcript: unknown[] | null;
}

export function parseJob(row: TutorNotesJobRow): TutorNotesJob {
  return {
    ...row,
    steps: safeJson<TutorNotesStep[]>(row.steps, []),
    result: safeJson<TutorNotesResult>(row.result, {}),
    transcript: row.transcript ? safeJson<unknown[] | null>(row.transcript, null) : null,
  };
}

function safeJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export interface CreateJobInput {
  relationship_id: string;
  tutor_id: string;
  student_id: string;
  title: string | null;
  notes: string;
  lesson_at: string | null;
  priority: TutorNotesPriority;
  auto_share: boolean;
  lesson_log_id: string | null;
}

export async function createJob(db: D1Database, input: CreateJobInput): Promise<TutorNotesJob> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO tutor_note_jobs (id, relationship_id, tutor_id, student_id, title, notes, lesson_at, priority, auto_share, lesson_log_id, progress)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Waiting to start')`
    )
    .bind(
      id,
      input.relationship_id,
      input.tutor_id,
      input.student_id,
      input.title,
      input.notes,
      input.lesson_at,
      input.priority,
      input.auto_share ? 1 : 0,
      input.lesson_log_id
    )
    .run();
  return (await getJob(db, id))!;
}

export async function getJob(db: D1Database, id: string): Promise<TutorNotesJob | null> {
  const row = await db.prepare(`SELECT * FROM tutor_note_jobs WHERE id = ?`).bind(id).first<TutorNotesJobRow>();
  return row ? parseJob(row) : null;
}

export async function getJobInRelationship(db: D1Database, relationshipId: string, id: string): Promise<TutorNotesJob | null> {
  const row = await db
    .prepare(`SELECT * FROM tutor_note_jobs WHERE id = ? AND relationship_id = ?`)
    .bind(id, relationshipId)
    .first<TutorNotesJobRow>();
  return row ? parseJob(row) : null;
}

/** Jobs newest first, without the transcript (it is only for resumption). */
export async function listJobs(db: D1Database, relationshipId: string, limit = 50): Promise<TutorNotesJob[]> {
  const rows = await db
    .prepare(
      `SELECT id, relationship_id, tutor_id, student_id, title, notes, lesson_at, priority, auto_share, status, progress, steps,
              NULL AS transcript, rounds, result, error, lesson_log_id, created_at, updated_at, started_at, finished_at
       FROM tutor_note_jobs WHERE relationship_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .bind(relationshipId, limit)
    .all<TutorNotesJobRow>();
  return rows.results.map(parseJob);
}

export async function countRunningJobs(db: D1Database, relationshipId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM tutor_note_jobs WHERE relationship_id = ? AND status IN ('queued', 'running')`)
    .bind(relationshipId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export interface JobPatch {
  status?: TutorNotesJobStatus;
  progress?: string | null;
  steps?: TutorNotesStep[];
  transcript?: unknown[] | null;
  rounds?: number;
  result?: TutorNotesResult;
  error?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
}

/** One UPDATE for whatever changed; `updated_at` always moves. */
export async function patchJob(db: D1Database, id: string, patch: JobPatch): Promise<void> {
  const sets: string[] = [`updated_at = datetime('now')`];
  const binds: unknown[] = [];
  const set = (col: string, value: unknown) => {
    sets.push(`${col} = ?`);
    binds.push(value);
  };
  if (patch.status !== undefined) set('status', patch.status);
  if (patch.progress !== undefined) set('progress', patch.progress);
  if (patch.steps !== undefined) set('steps', JSON.stringify(patch.steps));
  if (patch.transcript !== undefined) set('transcript', patch.transcript === null ? null : JSON.stringify(patch.transcript));
  if (patch.rounds !== undefined) set('rounds', patch.rounds);
  if (patch.result !== undefined) set('result', JSON.stringify(patch.result));
  if (patch.error !== undefined) set('error', patch.error);
  if (patch.started_at !== undefined) set('started_at', patch.started_at);
  if (patch.finished_at !== undefined) set('finished_at', patch.finished_at);
  binds.push(id);
  await db.prepare(`UPDATE tutor_note_jobs SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
}

export async function deleteJob(db: D1Database, relationshipId: string, id: string): Promise<boolean> {
  const r = await db.prepare(`DELETE FROM tutor_note_jobs WHERE id = ? AND relationship_id = ?`).bind(id, relationshipId).run();
  return (r.meta.changes ?? 0) > 0;
}

/** Closing summaries of earlier jobs in this relationship, for the agent's briefing. */
export async function listRecentJobSummaries(
  db: D1Database,
  relationshipId: string,
  excludeId: string,
  limit = 5
): Promise<Array<{ created_at: string; title: string | null; result: TutorNotesResult }>> {
  const rows = await db
    .prepare(
      `SELECT created_at, title, result FROM tutor_note_jobs
       WHERE relationship_id = ? AND id != ? AND status = 'done' ORDER BY created_at DESC LIMIT ?`
    )
    .bind(relationshipId, excludeId, limit)
    .all<{ created_at: string; title: string | null; result: string }>();
  return rows.results.map(r => ({ created_at: r.created_at, title: r.title, result: safeJson<TutorNotesResult>(r.result, {}) }));
}

// ============ Read-only lookups on the student's account ============

export interface StudentWordMatch {
  hanzi: string;
  pinyin: string;
  english: string;
  deck_name: string;
  /** Highest card state of the note's cards: new | learning | review | relearning. */
  state: 'new' | 'learning' | 'review' | 'relearning';
  reps: number;
  lapses: number;
  /** Longest current interval in days across the note's cards. */
  interval_days: number;
}

const STATE_NAMES: Record<number, StudentWordMatch['state']> = { 0: 'new', 1: 'learning', 2: 'review', 3: 'relearning' };

interface WordRow {
  hanzi: string;
  pinyin: string;
  english: string;
  deck_name: string;
  max_queue: number | null;
  reps: number | null;
  lapses: number | null;
  interval: number | null;
}

function toMatch(r: WordRow): StudentWordMatch {
  return {
    hanzi: r.hanzi,
    pinyin: r.pinyin,
    english: r.english,
    deck_name: r.deck_name,
    state: STATE_NAMES[r.max_queue ?? 0] ?? 'new',
    reps: r.reps ?? 0,
    lapses: r.lapses ?? 0,
    interval_days: r.interval ?? 0,
  };
}

const WORD_SELECT = `
  SELECT n.hanzi, n.pinyin, n.english, d.name AS deck_name,
         MAX(c.queue) AS max_queue, MAX(c.repetitions) AS reps, MAX(c.lapses) AS lapses, MAX(c.interval) AS interval
  FROM notes n
  JOIN decks d ON d.id = n.deck_id
  LEFT JOIN cards c ON c.note_id = n.id
  WHERE d.user_id = ?`;

/** Which of these words the student already has a card for (exact hanzi, whitespace-trimmed). */
export async function findStudentWords(db: D1Database, studentId: string, hanzi: string[]): Promise<Map<string, StudentWordMatch[]>> {
  const out = new Map<string, StudentWordMatch[]>();
  const unique = Array.from(new Set(hanzi.map(h => h.trim()).filter(Boolean)));
  for (let i = 0; i < unique.length; i += 40) {
    const chunk = unique.slice(i, i + 40);
    const rows = await db
      .prepare(`${WORD_SELECT} AND n.hanzi IN (${chunk.map(() => '?').join(',')}) GROUP BY n.id`)
      .bind(studentId, ...chunk)
      .all<WordRow>();
    for (const r of rows.results) {
      const list = out.get(r.hanzi) ?? [];
      list.push(toMatch(r));
      out.set(r.hanzi, list);
    }
  }
  return out;
}

/** Free-text search of the student's notes (hanzi / pinyin / english / sentence). */
export async function searchStudentWords(db: D1Database, studentId: string, query: string, limit = 20): Promise<StudentWordMatch[]> {
  const like = `%${query.trim().toLowerCase()}%`;
  const rows = await db
    .prepare(
      `${WORD_SELECT} AND (LOWER(n.hanzi) LIKE ? OR LOWER(n.pinyin) LIKE ? OR LOWER(n.english) LIKE ? OR LOWER(COALESCE(n.sentence_clue, '')) LIKE ?)
       GROUP BY n.id ORDER BY n.created_at DESC LIMIT ?`
    )
    .bind(studentId, like, like, like, like, limit)
    .all<WordRow>();
  return rows.results.map(toMatch);
}

export interface StudentDeckSummary {
  id: string;
  name: string;
  note_count: number;
  /** Notes with at least one card past the learning phase. */
  started: number;
  mastered: number;
  from_tutor: boolean;
}

export async function listStudentDecks(db: D1Database, studentId: string): Promise<StudentDeckSummary[]> {
  const rows = await db
    .prepare(
      `SELECT d.id, d.name,
              (SELECT COUNT(*) FROM notes n WHERE n.deck_id = d.id) AS note_count,
              (SELECT COUNT(DISTINCT n.id) FROM notes n JOIN cards c ON c.note_id = n.id WHERE n.deck_id = d.id AND c.queue > 0) AS started,
              (SELECT COUNT(DISTINCT n.id) FROM notes n JOIN cards c ON c.note_id = n.id WHERE n.deck_id = d.id AND c.interval >= 21) AS mastered,
              EXISTS(SELECT 1 FROM shared_decks s WHERE s.target_deck_id = d.id) AS from_tutor
       FROM decks d WHERE d.user_id = ? ORDER BY d.study_priority DESC, d.created_at DESC`
    )
    .bind(studentId)
    .all<{ id: string; name: string; note_count: number; started: number; mastered: number; from_tutor: number }>();
  return rows.results.map(r => ({ ...r, from_tutor: !!r.from_tutor }));
}

/** Every word in one of the student's decks (for "what did I already send"). */
export async function listStudentDeckWords(db: D1Database, studentId: string, deckId: string, limit = 400): Promise<StudentWordMatch[]> {
  const rows = await db
    .prepare(`${WORD_SELECT} AND d.id = ? GROUP BY n.id ORDER BY n.created_at ASC LIMIT ?`)
    .bind(studentId, deckId, limit)
    .all<WordRow>();
  return rows.results.map(toMatch);
}

/** Hanzi already in one of the tutor's decks (so add_cards can skip duplicates within the job's deck). */
export async function listDeckHanzi(db: D1Database, deckId: string): Promise<Set<string>> {
  const rows = await db.prepare(`SELECT hanzi FROM notes WHERE deck_id = ?`).bind(deckId).all<{ hanzi: string }>();
  return new Set(rows.results.map(r => r.hanzi));
}

export async function getUserBrief(db: D1Database, userId: string): Promise<{ name: string | null; bio: string | null } | null> {
  const row = await db.prepare(`SELECT name, email, bio FROM users WHERE id = ?`).bind(userId).first<{ name: string | null; email: string | null; bio: string | null }>();
  if (!row) return null;
  return { name: row.name || row.email || null, bio: row.bio ?? null };
}
