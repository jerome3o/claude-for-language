/**
 * Prepared in-call activities (shared/call-activities/prepared.ts) + the coverage headline
 * (shared/students/coverage.ts): ids, ordering, copy and the preview lines both apps show.
 * Writes prepared-activities.json; checked by core/…/calls/PreparedActivitiesParityTest.kt.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACTIVITY_CATALOGUE,
  activityPreview,
  firstName,
  orderPrepared,
  parseGeneratedActivity,
  preparedActivityId,
  preparedHeadline,
  preparedRowId,
  preparedSectionTitle,
  type ActivitySpec,
  type PreparedActivity,
} from '../../../shared/call-activities';
import { coverageHeadline } from '../../../shared/students/coverage';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const ids = ['prepared:job-1-2', 'prepared:', 'prepared: x', 'prepared:a b', 'dictation-everyday-1', 'review-together', 'prepared:abc:def_1', `prepared:${'x'.repeat(101)}`, 'PREPARED:x'];

// A generated-shaped spec of each kind beside the catalogue, plus odd ones (no emoji, empty prompt, audio-only quiz).
const generated: ActivitySpec[] = [];
for (const s of ACTIVITY_CATALOGUE) {
  const { id: _id, ...raw } = JSON.parse(JSON.stringify(s));
  const p = parseGeneratedActivity({ ...raw, why: 'w' }, `gen-${s.id}`);
  if (p.spec) generated.push(p.spec);
}
const odd: ActivitySpec[] = [
  { id: 'o1', kind: 'describe', title: 't', level: 'beginner', topic: 't', summary: 's', role_names: { a: 'A', b: 'B' }, tutor_role: 'b', items: [{ emoji: '', hanzi: '头疼', pinyin: '', english: 'headache', hints: [] }, { emoji: '🤒', hanzi: '发烧', pinyin: 'fāshāo', english: '', hints: [] }] },
  { id: 'o2', kind: 'quiz', title: 't', level: 'beginner', topic: 't', summary: 's', role_names: { a: 'A', b: 'B' }, tutor_role: 'a', questions: [{ prompt: '', audio: '买', options: ['mǎi', 'mài'], answer: 0 }, { prompt: '', options: ['x'], answer: 4 }] },
  { id: 'o3', kind: 'roleplay', title: 't', level: 'beginner', topic: 't', summary: 's', role_names: { a: 'A', b: 'B' }, tutor_role: 'a', setting: '', speakers: { a: '', b: '病人' }, lines: [{ speaker: 'a', hanzi: '你好', pinyin: '', english: '' }, { speaker: 'b', hanzi: '你好', pinyin: '', english: '' }] },
  { id: 'o4', kind: 'info_gap', title: 't', level: 'beginner', topic: 't', summary: 's', role_names: { a: 'A', b: 'B' }, tutor_role: 'a', prompt: '', columns: ['A'], rows: [{ label: '一', cells: [{ value: 'x', owner: 'a' }, { value: 'y', owner: 'b' }] }], choices: [] },
];
const specs = [...ACTIVITY_CATALOGUE, ...generated, ...odd];
const previews = specs.flatMap((spec) => [12, 5, 3, 2].map((max) => ({ spec, max, lines: activityPreview(spec, max) })));

const row = (id: string, status: PreparedActivity['status'], created_at: string, position: number, used_at: string | null = null): PreparedActivity => ({
  id, status, created_at, position, used_at, relationship_id: 'rel', job_id: 'j', spec: ACTIVITY_CATALOGUE[0], why: 'w', source_lesson_id: null, source_label: null, used_in_call_id: null,
});
const lists: PreparedActivity[][] = [
  [],
  [
    row('old-1', 'ready', '2026-10-01 10:00:00', 0),
    row('new-2', 'ready', '2026-10-05 10:00:00', 1),
    row('new-1', 'ready', '2026-10-05 10:00:00', 0),
    row('u-early', 'used', '2026-10-01 10:00:00', 1, '2026-10-02 09:00:00'),
    row('u-late', 'used', '2026-10-01 10:00:00', 2, '2026-10-04 09:00:00'),
    row('gone', 'dismissed', '2026-10-06 10:00:00', 0),
  ],
  [row('b', 'ready', 'x', 0), row('a', 'ready', 'x', 0), row('c', 'used', 'x', 0, null), row('d', 'used', 'x', 0, null), row('e', 'used', 'x', 0, '2026')],
];

const names = ['Jerome Swannack', '  明慧 ', '', null, 'Anna\tMaria', 'X'];
const coverages = [
  { words: { known: 140, learning: 172 }, characters: { known: 300, learning: 120 }, lesson_count: 9 },
  { words: { known: 0, learning: 1 }, characters: { known: 0, learning: 1 }, lesson_count: 1 },
  { words: { known: 0, learning: 0 }, characters: { known: 0, learning: 0 }, lesson_count: 0 },
  { words: { known: 5, learning: 0 }, characters: { known: 0, learning: 0 }, lesson_count: 0 },
  { words: { known: 0, learning: 0 }, characters: { known: 2, learning: 0 }, lesson_count: 3 },
];

writeFileSync(
  join(OUT, 'prepared-activities.json'),
  JSON.stringify({
    ids: ids.map((id) => ({ id, row: preparedRowId(id) })),
    activity_id: preparedActivityId('job-1-2'),
    headlines: [0, 1, 2, 5, -1].map((n) => ({ n, text: preparedHeadline(n) })),
    names: names.map((name) => ({ name, first: firstName(name), section: preparedSectionTitle(name) })),
    previews,
    orders: lists.map((list) => ({ list, ids: orderPrepared(list).map((r) => r.id) })),
    coverages: coverages.map((c) => ({ coverage: { ...c, lessons: [], recent_words: [], recent_corrections: [] }, headline: coverageHeadline(c) })),
  }),
);
