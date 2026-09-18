/**
 * Lesson library, lesson editor and its Claude side-chat.
 *
 * Mounted at /api after the auth middleware, so c.get('user') is set.
 *
 * Library (owner only)          /lesson-library…
 * Lessons (owner or assigning   /lessons/:id, /lessons/:id/export.*
 *   tutor)                      /relationships/:relId/student-lessons
 * Editor chat                   /editor-chat/:targetType/:targetId…
 */

import { Hono, Context } from 'hono';
import {
  CustomLessonSpec,
  validateLessonSpec,
  diffLessonSpecs,
  formatLessonDiff,
  canonicalJson,
  lessonToMarkdown,
  lessonToJson,
  lessonToCsv,
  lessonToExportSpec,
  lessonExportFilename,
  LessonDiff,
} from '@shared/lesson';
import { Env } from '../types';
import * as lib from '../db/lesson-library-queries';
import { queueLessonImages, mergeKeptImages } from '../services/custom-lesson';
import { generateLessonSpec, proposeLessonRevision, CoEditTurn } from '../services/lesson-editor';
import { verifyRelationshipAccess, getMyRole, getOtherUserId } from '../services/relationships';

type AppEnv = { Bindings: Env };
type Ctx = Context<AppEnv>;

const lessonEditor = new Hono<AppEnv>();

// ============ Helpers ============

function parseSpec(json: string): CustomLessonSpec {
  return JSON.parse(json) as CustomLessonSpec;
}

function parseTags(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function cleanTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    const v = t.trim().slice(0, 40);
    if (v && !out.includes(v)) out.push(v);
  }
  return out.slice(0, 20);
}

function libraryItemJson(row: lib.LessonLibraryRow, extra: Record<string, unknown> = {}) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    icon: row.icon,
    tags: parseTags(row.tags),
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at,
    spec: parseSpec(row.spec),
    ...extra,
  };
}

function lessonJson(row: lib.AssignedLessonRow, extra: Record<string, unknown> = {}) {
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    description: row.description,
    icon: row.icon,
    source: row.source,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    library_item_id: row.library_item_id ?? null,
    assigned_by: row.assigned_by ?? null,
    assigned_relationship_id: row.assigned_relationship_id ?? null,
    spec: parseSpec(row.spec),
    ...extra,
  };
}

/** Two specs are "the same lesson content" ignoring server-filled fields. */
function sameContent(a: CustomLessonSpec, b: CustomLessonSpec): boolean {
  return canonicalJson(lessonToExportSpec(a)) === canonicalJson(lessonToExportSpec(b));
}

function exerciseCount(spec: CustomLessonSpec): number {
  return spec.sections.reduce((n, s) => n + s.exercises.length, 0);
}

function exportResponse(spec: CustomLessonSpec, format: string): Response | null {
  let body: string;
  let type: string;
  let ext: 'md' | 'json' | 'csv';
  switch (format) {
    case 'md':
      body = lessonToMarkdown(spec); type = 'text/markdown; charset=utf-8'; ext = 'md'; break;
    case 'json':
      body = lessonToJson(spec); type = 'application/json; charset=utf-8'; ext = 'json'; break;
    case 'csv':
      body = lessonToCsv(spec); type = 'text/csv; charset=utf-8'; ext = 'csv'; break;
    default:
      return null;
  }
  const filename = lessonExportFilename(spec, ext);
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
  return new Response(body, {
    headers: {
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
}

type EditorTarget =
  | { type: 'lesson'; row: lib.AssignedLessonRow; spec: CustomLessonSpec }
  | { type: 'library'; row: lib.LessonLibraryRow; spec: CustomLessonSpec };

/** Resolve an editor-chat target the user may edit, or null. */
async function loadTarget(db: D1Database, targetType: string, targetId: string, userId: string): Promise<EditorTarget | null> {
  if (targetType === 'lesson') {
    const row = await lib.getLessonForEditor(db, targetId, userId);
    return row ? { type: 'lesson', row, spec: parseSpec(row.spec) } : null;
  }
  if (targetType === 'library') {
    const row = await lib.getLibraryItem(db, targetId, userId);
    return row ? { type: 'library', row, spec: parseSpec(row.spec) } : null;
  }
  return null;
}

// ============ Library ============

lessonEditor.get('/lesson-library', async (c) => {
  const userId = c.get('user').id;
  const rows = await lib.listLibraryItems(c.env.DB, userId);
  return c.json({
    items: rows.map(row => {
      const spec = parseSpec(row.spec);
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        icon: row.icon,
        tags: parseTags(row.tags),
        version: row.version,
        created_at: row.created_at,
        updated_at: row.updated_at,
        assignment_count: row.assignment_count,
        exercise_count: exerciseCount(spec),
      };
    }),
  });
});

interface CreateLibraryBody {
  spec?: unknown;
  generate?: { prompt?: string; learner?: string };
  tags?: unknown;
}

async function createFromBody(c: Ctx, body: CreateLibraryBody) {
  const userId = c.get('user').id;
  let spec: CustomLessonSpec;
  if (body.generate) {
    const prompt = (body.generate.prompt ?? '').trim();
    if (!prompt) return c.json({ error: 'generate.prompt is required' }, 400);
    if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'AI is not configured' }, 503);
    try {
      spec = await generateLessonSpec(c.env.ANTHROPIC_API_KEY, prompt, { learner: body.generate.learner });
    } catch (error) {
      console.error('[lesson-library] generate failed:', error);
      return c.json({ error: error instanceof Error ? error.message : 'Could not draft the lesson' }, 502);
    }
  } else {
    const errors = validateLessonSpec(body.spec);
    if (errors.length > 0) return c.json({ error: 'Invalid lesson spec', problems: errors }, 400);
    spec = lessonToExportSpec(body.spec as CustomLessonSpec);
  }
  const row = await lib.createLibraryItem(c.env.DB, userId, {
    title: spec.title,
    description: spec.description ?? null,
    icon: spec.icon ?? null,
    spec: JSON.stringify(spec),
    tags: cleanTags(body.tags),
  });
  return c.json(libraryItemJson(row, { assignment_count: 0 }), 201);
}

lessonEditor.post('/lesson-library', async (c) => {
  const body = await c.req.json<CreateLibraryBody>().catch(() => ({} as CreateLibraryBody));
  return createFromBody(c, body);
});

// Same as create from { spec } — a separate path so the UI's "Import JSON"
// can stay explicit.
lessonEditor.post('/lesson-library/import', async (c) => {
  const body = await c.req.json<CreateLibraryBody>().catch(() => ({} as CreateLibraryBody));
  return createFromBody(c, { spec: body.spec, tags: body.tags });
});

lessonEditor.get('/lesson-library/:id', async (c) => {
  const userId = c.get('user').id;
  const row = await lib.getLibraryItem(c.env.DB, c.req.param('id'), userId);
  if (!row) return c.json({ error: 'Library item not found' }, 404);
  const assignments = await lib.listAssignmentsForItem(c.env.DB, row.id);
  return c.json(libraryItemJson(row, { assignment_count: assignments.length }));
});

lessonEditor.put('/lesson-library/:id', async (c) => {
  const userId = c.get('user').id;
  const existing = await lib.getLibraryItem(c.env.DB, c.req.param('id'), userId);
  if (!existing) return c.json({ error: 'Library item not found' }, 404);
  const body = await c.req.json<{ spec?: unknown; tags?: unknown }>().catch(() => ({} as { spec?: unknown; tags?: unknown }));
  const errors = validateLessonSpec(body.spec);
  if (errors.length > 0) return c.json({ error: 'Invalid lesson spec', problems: errors }, 400);
  const spec = lessonToExportSpec(body.spec as CustomLessonSpec);
  const bump = !sameContent(parseSpec(existing.spec), spec);
  const row = await lib.updateLibraryItem(c.env.DB, existing.id, userId, {
    title: spec.title,
    description: spec.description ?? null,
    icon: spec.icon ?? null,
    spec: JSON.stringify(spec),
    tags: body.tags === undefined ? parseTags(existing.tags) : cleanTags(body.tags),
  }, bump);
  if (!row) return c.json({ error: 'Library item not found' }, 404);
  const assignments = await lib.listAssignmentsForItem(c.env.DB, row.id);
  return c.json(libraryItemJson(row, { assignment_count: assignments.length }));
});

lessonEditor.delete('/lesson-library/:id', async (c) => {
  const userId = c.get('user').id;
  const ok = await lib.archiveLibraryItem(c.env.DB, c.req.param('id'), userId);
  if (!ok) return c.json({ error: 'Library item not found' }, 404);
  return c.json({ ok: true });
});

lessonEditor.post('/lesson-library/:id/duplicate', async (c) => {
  const userId = c.get('user').id;
  const existing = await lib.getLibraryItem(c.env.DB, c.req.param('id'), userId);
  if (!existing) return c.json({ error: 'Library item not found' }, 404);
  const spec = parseSpec(existing.spec);
  spec.title = `Copy of ${spec.title}`.slice(0, 200);
  const row = await lib.createLibraryItem(c.env.DB, userId, {
    title: spec.title,
    description: spec.description ?? null,
    icon: spec.icon ?? null,
    spec: JSON.stringify(spec),
    tags: parseTags(existing.tags),
  });
  return c.json(libraryItemJson(row, { assignment_count: 0 }), 201);
});

lessonEditor.get('/lesson-library/:id/:file{export\\.(md|json|csv)}', async (c) => {
  const userId = c.get('user').id;
  const row = await lib.getLibraryItem(c.env.DB, c.req.param('id'), userId);
  if (!row) return c.json({ error: 'Library item not found' }, 404);
  const res = exportResponse(parseSpec(row.spec), (c.req.param('file') ?? '').replace(/^export\./, ''));
  return res ?? c.json({ error: 'Unknown export format' }, 400);
});

/** Assign to students: one custom_lessons copy per relationship where the
 * caller is the tutor. Students who already have a copy are reported, not
 * duplicated. */
lessonEditor.post('/lesson-library/:id/assign', async (c) => {
  const userId = c.get('user').id;
  const item = await lib.getLibraryItem(c.env.DB, c.req.param('id'), userId);
  if (!item) return c.json({ error: 'Library item not found' }, 404);
  const body = await c.req.json<{ relationship_ids?: unknown }>().catch(() => ({} as { relationship_ids?: unknown }));
  const relIds = Array.isArray(body.relationship_ids) ? body.relationship_ids.filter((r): r is string => typeof r === 'string') : [];
  if (relIds.length === 0) return c.json({ error: 'relationship_ids is required' }, 400);

  const spec = parseSpec(item.spec);
  const assigned: Array<{ relationship_id: string; lesson_id: string; student_id: string }> = [];
  const already_had: Array<{ relationship_id: string; lesson_id: string; student_id: string }> = [];
  const errors: Array<{ relationship_id: string; error: string }> = [];

  for (const relId of relIds) {
    let studentId: string;
    try {
      const rel = await verifyRelationshipAccess(c.env.DB, relId, userId);
      if (getMyRole(rel, userId) !== 'tutor') {
        errors.push({ relationship_id: relId, error: 'You are not the tutor in this connection' });
        continue;
      }
      studentId = getOtherUserId(rel, userId);
    } catch (error) {
      errors.push({ relationship_id: relId, error: error instanceof Error ? error.message : 'Connection not found' });
      continue;
    }
    const existing = await lib.findAssignedCopy(c.env.DB, item.id, studentId);
    if (existing) {
      already_had.push({ relationship_id: relId, lesson_id: existing.id, student_id: studentId });
      continue;
    }
    const copy = await lib.createAssignedLesson(c.env.DB, studentId, {
      title: spec.title,
      description: spec.description ?? null,
      icon: spec.icon ?? null,
      spec: JSON.stringify(spec),
      library_item_id: item.id,
      assigned_by: userId,
      assigned_relationship_id: relId,
    });
    await queueLessonImages(c.env, copy.id, spec);
    assigned.push({ relationship_id: relId, lesson_id: copy.id, student_id: studentId });
  }

  return c.json({ assigned, already_had, errors });
});

lessonEditor.get('/lesson-library/:id/assignments', async (c) => {
  const userId = c.get('user').id;
  const item = await lib.getLibraryItem(c.env.DB, c.req.param('id'), userId);
  if (!item) return c.json({ error: 'Library item not found' }, 404);
  const itemSpec = parseSpec(item.spec);
  const rows = await lib.listAssignmentsForItem(c.env.DB, item.id);
  const aggregates = await lib.aggregateCompletions(c.env.DB, rows.map(r => r.id));
  return c.json({
    assignments: rows.map(row => {
      const agg = aggregates.get(row.id);
      return {
        lesson_id: row.id,
        relationship_id: row.assigned_relationship_id,
        assigned_at: row.created_at,
        student: {
          id: row.user_id,
          name: row.student_name,
          email: row.student_email,
          picture_url: row.student_picture_url,
        },
        completions: agg?.completions ?? 0,
        last_completed_at: agg?.last_completed_at ?? null,
        last_rating: agg?.last_rating ?? null,
        last_score: agg && agg.last_total ? { correct: agg.last_correct ?? 0, total: agg.last_total } : null,
        up_to_date: sameContent(parseSpec(row.spec), itemSpec),
      };
    }),
  });
});

/** Overwrite assigned copies with the library version (same lesson ids, so
 * the students' completion history and FSRS schedule survive). Kept
 * illustrations carry over; new image prompts are queued. */
lessonEditor.post('/lesson-library/:id/push-update', async (c) => {
  const userId = c.get('user').id;
  const item = await lib.getLibraryItem(c.env.DB, c.req.param('id'), userId);
  if (!item) return c.json({ error: 'Library item not found' }, 404);
  const body = await c.req.json<{ relationship_ids?: unknown }>().catch(() => ({} as { relationship_ids?: unknown }));
  const only = Array.isArray(body.relationship_ids)
    ? new Set(body.relationship_ids.filter((r): r is string => typeof r === 'string'))
    : null;

  const itemSpec = parseSpec(item.spec);
  const rows = await lib.listAssignmentsForItem(c.env.DB, item.id);
  let updated = 0;
  let skipped = 0;
  let imageJobs = 0;
  for (const row of rows) {
    if (only && (!row.assigned_relationship_id || !only.has(row.assigned_relationship_id))) continue;
    const copySpec = parseSpec(row.spec);
    if (sameContent(copySpec, itemSpec)) {
      skipped++;
      continue;
    }
    const next = mergeKeptImages(copySpec, JSON.parse(JSON.stringify(itemSpec)) as CustomLessonSpec);
    await lib.updateLessonSpecById(c.env.DB, row.id, {
      title: next.title,
      description: next.description ?? null,
      icon: next.icon ?? null,
      spec: JSON.stringify(next),
    });
    imageJobs += await queueLessonImages(c.env, row.id, next);
    updated++;
  }
  return c.json({ updated, skipped, image_jobs: imageJobs });
});

// ============ Lessons (owner or the tutor who assigned it) ============

lessonEditor.get('/lessons/:id', async (c) => {
  const userId = c.get('user').id;
  const row = await lib.getLessonForEditor(c.env.DB, c.req.param('id'), userId);
  if (!row) return c.json({ error: 'Lesson not found' }, 404);
  return c.json(lessonJson(row, { is_owner: row.user_id === userId }));
});

lessonEditor.put('/lessons/:id', async (c) => {
  const userId = c.get('user').id;
  const existing = await lib.getLessonForEditor(c.env.DB, c.req.param('id'), userId);
  if (!existing) return c.json({ error: 'Lesson not found' }, 404);
  const body = await c.req.json<{ spec?: unknown }>().catch(() => ({} as { spec?: unknown }));
  const errors = validateLessonSpec(body.spec);
  if (errors.length > 0) return c.json({ error: 'Invalid lesson spec', problems: errors }, 400);
  const spec = mergeKeptImages(parseSpec(existing.spec), body.spec as CustomLessonSpec);
  const row = await lib.updateLessonSpecById(c.env.DB, existing.id, {
    title: spec.title,
    description: spec.description ?? null,
    icon: spec.icon ?? null,
    spec: JSON.stringify(spec),
  });
  if (!row) return c.json({ error: 'Lesson not found' }, 404);
  const imageJobs = await queueLessonImages(c.env, row.id, spec);
  return c.json(lessonJson(row, { is_owner: row.user_id === userId, image_jobs: imageJobs }));
});

lessonEditor.get('/lessons/:id/:file{export\\.(md|json|csv)}', async (c) => {
  const userId = c.get('user').id;
  const row = await lib.getLessonForEditor(c.env.DB, c.req.param('id'), userId);
  if (!row) return c.json({ error: 'Lesson not found' }, 404);
  const res = exportResponse(parseSpec(row.spec), (c.req.param('file') ?? '').replace(/^export\./, ''));
  return res ?? c.json({ error: 'Unknown export format' }, 400);
});

/** A student's lessons as seen by their tutor: which were assigned by me,
 * by another tutor, or made by the student/agents, with completion stats. */
lessonEditor.get('/relationships/:relId/student-lessons', async (c) => {
  const userId = c.get('user').id;
  const relId = c.req.param('relId');
  let studentId: string;
  try {
    const rel = await verifyRelationshipAccess(c.env.DB, relId, userId);
    if (getMyRole(rel, userId) !== 'tutor') return c.json({ error: 'Only the tutor can view student lessons' }, 403);
    studentId = getOtherUserId(rel, userId);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Connection not found' }, 404);
  }
  const rows = await lib.listLessonsForUser(c.env.DB, studentId);
  const aggregates = await lib.aggregateCompletions(c.env.DB, rows.map(r => r.id));
  return c.json({
    lessons: rows.map(row => {
      const agg = aggregates.get(row.id);
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        icon: row.icon,
        source: row.source,
        created_at: row.created_at,
        updated_at: row.updated_at,
        exercise_count: exerciseCount(parseSpec(row.spec)),
        library_item_id: row.library_item_id ?? null,
        assigned_by: row.assigned_by ?? null,
        assigned_by_me: row.assigned_by === userId,
        completions: agg?.completions ?? 0,
        last_completed_at: agg?.last_completed_at ?? null,
        last_rating: agg?.last_rating ?? null,
        last_score: agg && agg.last_total ? { correct: agg.last_correct ?? 0, total: agg.last_total } : null,
      };
    }),
  });
});

// ============ Editor chat ============

interface ChatMessageJson {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  proposal_status: 'pending' | 'accepted' | 'rejected' | null;
  proposed_spec: CustomLessonSpec | null;
  /** Assistant proposals: what the proposal changes vs the spec at that time. */
  proposal_diff: LessonDiff | null;
  /** User messages: what the author changed since the previous message. */
  author_changes: string[];
}

function safeParse(json: string | null): CustomLessonSpec | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as CustomLessonSpec;
  } catch {
    return null;
  }
}

function safeDiff(a: CustomLessonSpec | null, b: CustomLessonSpec | null): LessonDiff | null {
  if (!a || !b) return null;
  try {
    return diffLessonSpecs(a, b);
  } catch {
    return null;
  }
}

/** The spec the next message should diff against: the last message's
 * snapshot — or, if that message was a proposal the author accepted, the
 * proposal itself (accepting it is not "an author change"). */
function baselineAfter(row: lib.EditorChatMessageRow | undefined, fallback: CustomLessonSpec): CustomLessonSpec {
  if (!row) return fallback;
  if (row.role === 'assistant' && row.proposal_status === 'accepted') {
    return safeParse(row.proposed_spec) ?? safeParse(row.spec_snapshot) ?? fallback;
  }
  return safeParse(row.spec_snapshot) ?? fallback;
}

function annotateMessages(rows: lib.EditorChatMessageRow[], storedSpec: CustomLessonSpec): ChatMessageJson[] {
  const out: ChatMessageJson[] = [];
  let previous: lib.EditorChatMessageRow | undefined;
  for (const row of rows) {
    const snapshot = safeParse(row.spec_snapshot);
    const proposed = safeParse(row.proposed_spec);
    let authorChanges: string[] = [];
    if (row.role === 'user' && previous) {
      const diff = safeDiff(baselineAfter(previous, storedSpec), snapshot);
      authorChanges = diff ? formatLessonDiff(diff) : [];
    }
    out.push({
      id: row.id,
      role: row.role,
      content: row.content,
      created_at: row.created_at,
      proposal_status: row.proposal_status,
      proposed_spec: proposed,
      proposal_diff: proposed ? safeDiff(snapshot, proposed) : null,
      author_changes: authorChanges,
    });
    previous = row;
  }
  return out;
}

lessonEditor.get('/editor-chat/:targetType/:targetId', async (c) => {
  const userId = c.get('user').id;
  const target = await loadTarget(c.env.DB, c.req.param('targetType'), c.req.param('targetId'), userId);
  if (!target) return c.json({ error: 'Not found' }, 404);
  const chat = await lib.getOrCreateEditorChat(c.env.DB, userId, target.type, target.row.id);
  const rows = await lib.listEditorChatMessages(c.env.DB, chat.id);
  return c.json({
    chat: { id: chat.id, target_type: chat.target_type, target_id: chat.target_id },
    ai_available: !!c.env.ANTHROPIC_API_KEY,
    messages: annotateMessages(rows, target.spec),
  });
});

lessonEditor.post('/editor-chat/:targetType/:targetId/messages', async (c) => {
  const userId = c.get('user').id;
  const target = await loadTarget(c.env.DB, c.req.param('targetType'), c.req.param('targetId'), userId);
  if (!target) return c.json({ error: 'Not found' }, 404);
  if (!c.env.ANTHROPIC_API_KEY) return c.json({ error: 'AI is not configured' }, 503);

  const body = await c.req.json<{ message?: unknown; current_spec?: unknown }>().catch(() => ({} as { message?: unknown; current_spec?: unknown }));
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return c.json({ error: 'message is required' }, 400);
  const current = body.current_spec;
  if (!current || typeof current !== 'object' || !Array.isArray((current as { sections?: unknown }).sections)) {
    return c.json({ error: 'current_spec must be a lesson spec object' }, 400);
  }
  const currentSpec = current as CustomLessonSpec;

  const chat = await lib.getOrCreateEditorChat(c.env.DB, userId, target.type, target.row.id);
  const rows = await lib.listEditorChatMessages(c.env.DB, chat.id);

  const baseline = baselineAfter(rows[rows.length - 1], target.spec);
  const authorDiff = safeDiff(baseline, currentSpec);
  const authorChanges = authorDiff ? formatLessonDiff(authorDiff) : [];

  const history: CoEditTurn[] = rows.map(r => ({
    role: r.role,
    content: r.content,
    hadProposal: !!r.proposed_spec,
    proposalStatus: r.proposal_status,
  }));

  const userRow = await lib.insertEditorChatMessage(c.env.DB, {
    chat_id: chat.id,
    role: 'user',
    content: message,
    spec_snapshot: JSON.stringify(currentSpec),
  });

  let result;
  try {
    result = await proposeLessonRevision(c.env.ANTHROPIC_API_KEY, {
      spec: currentSpec,
      authorChanges,
      history,
      message,
    });
  } catch (error) {
    console.error('[editor-chat] Claude call failed:', error);
    return c.json({
      error: 'Claude is unavailable right now',
      user_message: { id: userRow.id, role: 'user', content: message, created_at: userRow.created_at, author_changes: authorChanges },
    }, 502);
  }

  const proposal = result.proposal ? mergeKeptImages(currentSpec, result.proposal) : null;
  const assistantRow = await lib.insertEditorChatMessage(c.env.DB, {
    chat_id: chat.id,
    role: 'assistant',
    content: result.text,
    spec_snapshot: JSON.stringify(currentSpec),
    proposed_spec: proposal ? JSON.stringify(proposal) : null,
    proposal_status: proposal ? 'pending' : null,
  });

  const proposalDiff = proposal ? safeDiff(currentSpec, proposal) : null;
  return c.json({
    user_message: { id: userRow.id, role: 'user', content: message, created_at: userRow.created_at, author_changes: authorChanges },
    message: {
      id: assistantRow.id,
      role: 'assistant',
      content: assistantRow.content,
      created_at: assistantRow.created_at,
      proposal_status: assistantRow.proposal_status,
      proposed_spec: proposal,
      proposal_diff: proposalDiff,
      author_changes: [],
    },
    proposal: proposal ? { id: assistantRow.id, spec: proposal, diff: proposalDiff } : null,
  });
});

async function setStatus(c: Ctx, status: 'accepted' | 'rejected') {
  const userId = c.get('user').id;
  const target = await loadTarget(c.env.DB, c.req.param('targetType'), c.req.param('targetId'), userId);
  if (!target) return c.json({ error: 'Not found' }, 404);
  const chat = await lib.getOrCreateEditorChat(c.env.DB, userId, target.type, target.row.id);
  const row = await lib.setProposalStatus(c.env.DB, c.req.param('id'), chat.id, status);
  if (!row) return c.json({ error: 'Proposal not found' }, 404);
  return c.json({ id: row.id, proposal_status: row.proposal_status });
}

lessonEditor.post('/editor-chat/:targetType/:targetId/messages/:id/accept', (c) => setStatus(c, 'accepted'));
lessonEditor.post('/editor-chat/:targetType/:targetId/messages/:id/reject', (c) => setStatus(c, 'rejected'));

export default lessonEditor;
