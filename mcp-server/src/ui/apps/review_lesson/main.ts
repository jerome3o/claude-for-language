/**
 * Review lesson MCP App — a mini lesson section by section, every exercise
 * rendered by type and editable, saved to the library (or a student's copy),
 * assigned to students, pushed to copies that are behind, or handed to
 * Claude for a revision.
 */
import './app.css';
import { validateLessonSpec } from '../../../../../shared/lesson/validate';
import type {
  AssignResult,
  CustomLessonSpec,
  LessonAssignment,
  LessonExercise,
  LessonPayload,
  LessonSaveResult,
  LessonSection,
  LessonSentence,
} from '../../../tools/apps/types';
import { avatar, busy, confirmButton, h, mediaUrl, mount, playButton, plural, problemsNotice, speakZh, textField, timeAgo, toast, RATING_LABEL } from '../_shared/dom';
import { startApp } from '../_shared/host';
import { pickStudents } from '../_shared/picker';

type ExType = LessonExercise['type'];

const TYPE_LABELS: Record<ExType, string> = {
  note: 'Note',
  scramble: 'Word order',
  choice: 'Multiple choice',
  translate: 'Translate',
  match: 'Match pairs',
  describe_image: 'Describe picture',
  speak: 'Speak',
  listen_choice: 'Listen & pick',
  listen_translate: 'Listen & translate',
};
const LISTENING = new Set<ExType>(['listen_choice', 'listen_translate']);

let data: LessonPayload | null = null;
let spec: CustomLessonSpec | null = null;
let assignments: LessonAssignment[] = [];
let editing = false;
let dirty = false;
let problems: string[] = [];
let askText = '';
const root = document.getElementById('app')!;

const host = startApp<LessonPayload>({
  name: 'review_lesson',
  onData: (d) => {
    data = d;
    spec = clone(d.spec);
    assignments = d.assignments ?? [];
    editing = false;
    dirty = false;
    problems = [];
    render();
  },
  onError: (message) => mount(root, h('div', { class: 'notice notice-danger' }, message)),
});
host.onReady(() => data && render());

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function exerciseText(ex: LessonExercise): string {
  switch (ex.type) {
    case 'note':
      return ex.title ?? (ex.body ?? '').slice(0, 60);
    case 'scramble':
      return ex.correct_order.join('');
    case 'choice':
      return ex.question;
    case 'translate':
      return ex.reference_hanzi;
    case 'match':
      return ex.pairs.map((p) => p.hanzi).join('、');
    case 'describe_image':
      return ex.reference_hanzi;
    case 'speak':
      return ex.prompt;
    case 'listen_choice':
    case 'listen_translate':
      return ex.audio.hanzi;
  }
}

function summary(s: CustomLessonSpec): string {
  const idLabel = data?.target === 'library' ? 'library_item_id' : 'lesson_id';
  return `Lesson "${s.title}" (${idLabel}: ${data?.item.id}):\n${s.sections
    .map((sec, i) => `${i + 1}. ${sec.title ?? 'Section'}\n${sec.exercises.map((e) => `   - [${TYPE_LABELS[e.type]}] ${exerciseText(e)}`).join('\n')}`)
    .join('\n')}`;
}

function markDirty(): void {
  if (!dirty) {
    dirty = true;
    renderActions();
  }
}

// ---------- Actions ----------

async function save(): Promise<boolean> {
  if (!spec || !data) return false;
  problems = validateLessonSpec(spec);
  if (problems.length > 0) {
    render();
    return false;
  }
  const tool = data.target === 'library' ? 'app_save_library_lesson' : 'app_save_lesson';
  const args = data.target === 'library' ? { library_item_id: data.item.id, spec } : { lesson_id: data.item.id, spec };
  const res = await host.callTool<LessonSaveResult>(tool, args);
  if (!res.ok || !res.data) {
    toast(res.text, 'danger');
    return false;
  }
  if (!res.data.ok) {
    problems = res.data.problems ?? ['The server rejected the lesson.'];
    render();
    return false;
  }
  spec = clone(res.data.spec ?? spec);
  data.spec = clone(spec);
  data.item.title = spec.title;
  if (res.data.version !== undefined) data.item.version = res.data.version;
  dirty = false;
  problems = [];
  if (data.target === 'library') for (const a of assignments) a.up_to_date = false;
  toast('Saved');
  void host.updateModelContext(`The tutor edited and saved the lesson in the review app. Current content:\n${summary(spec)}`);
  render();
  return true;
}

function assignSheet(): void {
  if (!data) return;
  const have = new Map(assignments.map((a) => [a.relationship_id, a]));
  pickStudents({
    title: 'Assign this lesson to…',
    rows: data.students.map((s) => {
      const a = have.get(s.relationship_id);
      return { student: s, sub: a ? `Already has it${a.up_to_date ? '' : ' (behind — use Push update)'}` : 'Will appear in their next study session', disabled: !!a };
    }),
    confirmLabel: (n) => (n === 0 ? 'Pick students' : `Assign to ${plural(n, 'student')}`),
    onConfirm: async (students) => {
      if (dirty) {
        const ok = await save();
        if (!ok) throw new Error('Fix the problems and save first.');
      }
      const res = await host.callTool<AssignResult>('app_assign_lesson', { library_item_id: data!.item.id, relationship_ids: students.map((s) => s.relationship_id) });
      if (!res.ok || !res.data) throw new Error(res.text);
      assignments = res.data.assignments ?? assignments;
      const names = students.map((s) => s.name).join(', ');
      void host.updateModelContext(`The tutor assigned lesson "${spec!.title}" (library_item_id ${data!.item.id}) to ${names}.`);
      render();
      const errs = res.data.errors.length > 0 ? ` · ${res.data.errors.length} failed` : '';
      return `Assigned to ${plural(res.data.assigned.length, 'student')}${res.data.already_had.length > 0 ? ` · ${res.data.already_had.length} already had it` : ''}${errs}`;
    },
  });
}

async function pushUpdate(btn: HTMLButtonElement): Promise<void> {
  if (!data) return;
  await busy(btn, async () => {
    if (dirty) {
      const ok = await save();
      if (!ok) return;
    }
    const res = await host.callTool<{ updated: number; skipped: number; assignments: LessonAssignment[] }>('app_push_lesson_update', { library_item_id: data!.item.id });
    if (!res.ok || !res.data) {
      toast(res.text, 'danger');
      return;
    }
    assignments = res.data.assignments ?? assignments;
    toast(res.data.updated > 0 ? `Updated ${plural(res.data.updated, 'copy', 'copies')}` : 'Every copy is already up to date');
    void host.updateModelContext(`The tutor pushed the latest version of lesson "${spec!.title}" to ${res.data.updated} student cop${res.data.updated === 1 ? 'y' : 'ies'}.`);
    render();
  });
}

async function askClaude(instruction: string): Promise<void> {
  if (!data || !spec) return;
  const text = instruction.trim();
  if (!text) {
    toast('Describe the change first', 'danger');
    return;
  }
  if (dirty) {
    const ok = await save();
    if (!ok) return;
  }
  const idLabel = data.target === 'library' ? 'library_item_id' : 'lesson_id';
  const prompt = `Please revise the mini lesson "${spec.title}" (${idLabel}: ${data.item.id}): ${text}\n\nApply the change to the lesson itself in place (keep the exercises I did not mention), then open it again with review_lesson so I can check it.`;
  const sent = await host.sendMessage(prompt);
  if (sent) {
    askText = '';
    toast('Asked Claude to revise');
    render();
  } else toast(host.preview ? 'Preview: message not sent' : 'This host cannot receive messages from the app', 'danger');
}

// ---------- Read view ----------

function sentenceRow(s: LessonSentence, big = true): HTMLElement {
  return h(
    'div',
    { class: 'sentence' },
    playButton(() => speakZh(s.hanzi)),
    h('div', { class: 'text' }, h('div', { class: big ? 'zh' : 'zh-s', lang: 'zh-CN' }, s.hanzi), s.pinyin ? h('div', { class: 'pinyin small' }, s.pinyin) : null, s.english ? h('div', { class: 'small' }, s.english) : null),
  );
}

function optionRow(o: LessonSentence, i: number, correct: number): HTMLElement {
  const ok = i === correct;
  return h(
    'div',
    { class: `option${ok ? ' correct' : ''}` },
    h('span', { class: 'mark' }, ok ? '✓' : String.fromCharCode(65 + i)),
    h('div', { class: 'grow' }, h('span', { class: 'zh', lang: 'zh-CN' }, o.hanzi), o.pinyin ? h('span', { class: 'pinyin small' }, ` ${o.pinyin}`) : null, o.english ? h('div', { class: 'small muted' }, o.english) : null),
    playButton(() => speakZh(o.hanzi)),
  );
}

function reference(hanzi: string, pinyin?: string, english?: string): HTMLElement {
  return h(
    'div',
    { class: 'ref' },
    h('div', { class: 'row' }, h('span', { class: 'zh grow', lang: 'zh-CN' }, hanzi), playButton(() => speakZh(hanzi))),
    pinyin ? h('div', { class: 'pinyin small' }, pinyin) : null,
    english ? h('div', { class: 'small' }, english) : null,
  );
}

function hiddenAudio(s: LessonSentence): HTMLElement {
  return h('div', { class: 'hidden-audio' }, '🎧 Played, text hidden:', h('span', { class: 'zh-s', lang: 'zh-CN', style: 'font-size:1.05rem' }, s.hanzi), playButton(() => speakZh(s.hanzi)));
}

function viewExercise(ex: LessonExercise): HTMLElement {
  const body = h('div', { class: 'ex-body' });
  switch (ex.type) {
    case 'note':
      body.append(ex.title ? h('div', { class: 'bold', style: 'margin-bottom:0.25rem' }, ex.title) : '', ex.body ? h('div', { class: 'note-body' }, ex.body) : '', ...(ex.sentences ?? []).map((s) => sentenceRow(s)));
      break;
    case 'scramble':
      body.append(
        h('div', { class: 'question' }, ex.english),
        h('div', { class: 'tiles' }, ...ex.tiles.map((t) => h('span', { class: 'tile', lang: 'zh-CN' }, t))),
        h('div', { class: 'row small muted' }, '→ ', h('span', { class: 'zh-s', lang: 'zh-CN', style: 'font-size:1.1rem;color:var(--fg)' }, ex.correct_order.join(' ')), playButton(() => speakZh(ex.correct_order.join('')))),
        ex.alt_orders && ex.alt_orders.length > 0 ? h('div', { class: 'xs faint' }, `Also accepted: ${ex.alt_orders.map((a) => a.join(' ')).join(' / ')}`) : '',
      );
      break;
    case 'choice':
      body.append(h('div', { class: 'question' }, ex.question), h('div', { class: 'options' }, ...ex.options.map((o, i) => optionRow(o, i, ex.correct))), ex.explanation ? h('div', { class: 'small muted', style: 'margin-top:0.35rem' }, ex.explanation) : '');
      break;
    case 'translate':
      body.append(h('div', { class: 'question' }, ex.english), reference(ex.reference_hanzi, ex.reference_pinyin), ex.note ? h('div', { class: 'xs faint', style: 'margin-top:0.25rem' }, ex.note) : '');
      break;
    case 'match':
      body.append(h('div', { class: 'pairs' }, ...ex.pairs.flatMap((p) => [h('span', { class: 'zh', lang: 'zh-CN' }, p.hanzi), h('span', null, p.english, p.pinyin ? h('span', { class: 'pinyin small' }, ` ${p.pinyin}`) : null)])));
      break;
    case 'describe_image': {
      const url = mediaUrl(data!.media_base, ex.image_url);
      body.append(
        h('div', { class: 'illus' }, url ? h('img', { src: url, alt: ex.image_prompt }) : h('div', { class: 'pending' }, `Illustration pending: ${ex.image_prompt}`)),
        h('div', { class: 'question' }, ex.task ?? 'Describe the scene.'),
        reference(ex.reference_hanzi, ex.reference_pinyin, ex.reference_english),
      );
      break;
    }
    case 'speak':
      body.append(h('div', { class: 'question' }, ex.prompt), ex.example ? reference(ex.example.hanzi, ex.example.pinyin, ex.example.english) : '');
      break;
    case 'listen_choice':
      body.append(hiddenAudio(ex.audio), ex.question ? h('div', { class: 'question' }, ex.question) : '', h('div', { class: 'options' }, ...ex.options.map((o, i) => optionRow(o, i, ex.correct))), ex.explanation ? h('div', { class: 'small muted', style: 'margin-top:0.35rem' }, ex.explanation) : '');
      break;
    case 'listen_translate':
      body.append(hiddenAudio(ex.audio), h('div', { class: 'small muted' }, 'Answer:'), h('div', { class: 'bold' }, ex.audio.english ?? ''), ex.note ? h('div', { class: 'xs faint' }, ex.note) : '');
      break;
  }
  return body;
}

// ---------- Edit view ----------


function inp(value: string, placeholder: string, onInput: (v: string) => void, zh = false): HTMLInputElement {
  return h('input', { class: `input${zh ? ' input-zh' : ''}`, type: 'text', value, placeholder, lang: zh ? 'zh-CN' : undefined, oninput: (e) => { onInput((e.target as HTMLInputElement).value); markDirty(); } });
}

function sentenceListEditor(list: LessonSentence[], opts: { correct?: { get: () => number; set: (i: number) => void }; min?: number; label: string; requireEnglish?: boolean }): HTMLElement {
  const wrap = h('div', { class: 'edit-grid' });
  const draw = () => {
    mount(
      wrap,
      h('span', { class: 'label' }, opts.label),
      ...list.map((s, i) =>
        h(
          'div',
          { class: 'edit-row' },
          inp(s.hanzi, '汉字', (v) => (s.hanzi = v), true),
          inp(s.pinyin ?? '', 'pīnyīn', (v) => (s.pinyin = v || undefined)),
          inp(s.english ?? '', opts.requireEnglish ? 'English (required)' : 'English', (v) => (s.english = v || undefined)),
          h(
            'div',
            { class: 'row' },
            opts.correct
              ? h('label', { class: 'correct-pick', title: 'Correct answer' }, h('input', { type: 'radio', checked: opts.correct.get() === i, onchange: () => { opts.correct!.set(i); markDirty(); } }), '✓')
              : null,
            h('button', { class: 'btn btn-sm btn-icon btn-ghost', 'aria-label': 'Remove', disabled: list.length <= (opts.min ?? 0), onclick: () => { list.splice(i, 1); if (opts.correct && opts.correct.get() >= list.length) opts.correct.set(Math.max(0, list.length - 1)); markDirty(); draw(); } }, '✕'),
          ),
        ),
      ),
      h('div', null, h('button', { class: 'btn btn-sm', onclick: () => { list.push({ hanzi: '' }); markDirty(); draw(); } }, '+ Add')),
    );
  };
  draw();
  return wrap;
}

function pairsEditor(pairs: Array<{ hanzi: string; pinyin?: string; english: string }>): HTMLElement {
  const wrap = h('div', { class: 'edit-grid' });
  const draw = () => {
    mount(
      wrap,
      h('span', { class: 'label' }, 'Pairs (hanzi ↔ English)'),
      ...pairs.map((p, i) =>
        h(
          'div',
          { class: 'edit-row pairs-row' },
          inp(p.hanzi, '汉字', (v) => (p.hanzi = v), true),
          inp(p.pinyin ?? '', 'pīnyīn', (v) => (p.pinyin = v || undefined)),
          inp(p.english, 'English', (v) => (p.english = v)),
          h('button', { class: 'btn btn-sm btn-icon btn-ghost', 'aria-label': 'Remove', disabled: pairs.length <= 2, onclick: () => { pairs.splice(i, 1); markDirty(); draw(); } }, '✕'),
        ),
      ),
      h('div', null, h('button', { class: 'btn btn-sm', onclick: () => { pairs.push({ hanzi: '', english: '' }); markDirty(); draw(); } }, '+ Add pair')),
    );
  };
  draw();
  return wrap;
}

function shuffled<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (out.length > 1 && out.every((v, i) => v === arr[i])) out.reverse();
  return out;
}

function field(label: string, value: string, on: (v: string) => void, o: { zh?: boolean; multiline?: boolean; placeholder?: string } = {}): HTMLElement {
  return textField({ label, value, zh: o.zh, multiline: o.multiline, placeholder: o.placeholder, onInput: (v) => { on(v); markDirty(); } });
}

function editExercise(ex: LessonExercise): HTMLElement {
  const g = h('div', { class: 'edit-grid' });
  switch (ex.type) {
    case 'note':
      g.append(
        field('Title', ex.title ?? '', (v) => (ex.title = v || undefined)),
        field('Teaching text', ex.body ?? '', (v) => (ex.body = v || undefined), { multiline: true, placeholder: 'Explain the point in plain English; blank line between paragraphs' }),
        sentenceListEditor((ex.sentences ??= []), { label: 'Example sentences' }),
      );
      break;
    case 'scramble':
      g.append(
        field('English meaning', ex.english, (v) => (ex.english = v)),
        field('Correct order (tiles separated by spaces)', ex.correct_order.join(' '), (v) => {
          ex.correct_order = v.split(/\s+/).filter(Boolean);
          ex.tiles = shuffled(ex.correct_order);
        }, { zh: true, placeholder: '我 想 喝 一杯 咖啡' }),
      );
      break;
    case 'choice':
      g.append(
        field('Question / situation', ex.question, (v) => (ex.question = v), { multiline: true }),
        sentenceListEditor(ex.options, { label: 'Options (tick the correct one)', min: 2, correct: { get: () => ex.correct, set: (i) => (ex.correct = i) } }),
        field('Explanation (optional)', ex.explanation ?? '', (v) => (ex.explanation = v || undefined)),
      );
      break;
    case 'translate':
      g.append(
        field('English to translate', ex.english, (v) => (ex.english = v)),
        field('Reference answer (hanzi)', ex.reference_hanzi, (v) => (ex.reference_hanzi = v), { zh: true }),
        field('Reference pinyin', ex.reference_pinyin ?? '', (v) => (ex.reference_pinyin = v || undefined)),
        field('Note shown with the answer (optional)', ex.note ?? '', (v) => (ex.note = v || undefined)),
      );
      break;
    case 'match':
      g.append(pairsEditor(ex.pairs));
      break;
    case 'describe_image':
      g.append(
        field('Illustration prompt (English, no text in the image)', ex.image_prompt, (v) => (ex.image_prompt = v), { multiline: true }),
        field('Task (optional)', ex.task ?? '', (v) => (ex.task = v || undefined), { placeholder: 'Describe what the woman is doing.' }),
        field('Reference description (hanzi)', ex.reference_hanzi, (v) => (ex.reference_hanzi = v), { zh: true, multiline: true }),
        field('Reference pinyin', ex.reference_pinyin ?? '', (v) => (ex.reference_pinyin = v || undefined)),
        field('Reference English', ex.reference_english ?? '', (v) => (ex.reference_english = v || undefined)),
      );
      break;
    case 'speak': {
      const example = (ex.example ??= { hanzi: '' });
      g.append(
        field('What to say', ex.prompt, (v) => (ex.prompt = v), { multiline: true, placeholder: 'Order two coffees, one iced.' }),
        field('Example answer (hanzi, optional)', example.hanzi, (v) => { example.hanzi = v; if (!v.trim()) ex.example = undefined; else ex.example = example; }, { zh: true }),
        field('Example pinyin', example.pinyin ?? '', (v) => (example.pinyin = v || undefined)),
        field('Example English', example.english ?? '', (v) => (example.english = v || undefined)),
      );
      break;
    }
    case 'listen_choice':
      g.append(
        field('Played sentence (hanzi, hidden from the student)', ex.audio.hanzi, (v) => (ex.audio.hanzi = v), { zh: true }),
        field('Its pinyin', ex.audio.pinyin ?? '', (v) => (ex.audio.pinyin = v || undefined)),
        field('Its English', ex.audio.english ?? '', (v) => (ex.audio.english = v || undefined)),
        field('Question (optional)', ex.question ?? '', (v) => (ex.question = v || undefined), { placeholder: 'Which word did you hear?' }),
        sentenceListEditor(ex.options, { label: 'Options (tick the one that matches)', min: 2, correct: { get: () => ex.correct, set: (i) => (ex.correct = i) } }),
        field('Explanation (optional)', ex.explanation ?? '', (v) => (ex.explanation = v || undefined)),
      );
      break;
    case 'listen_translate':
      g.append(
        field('Played sentence (hanzi, hidden from the student)', ex.audio.hanzi, (v) => (ex.audio.hanzi = v), { zh: true }),
        field('Its pinyin', ex.audio.pinyin ?? '', (v) => (ex.audio.pinyin = v || undefined)),
        field('English answer (required)', ex.audio.english ?? '', (v) => (ex.audio.english = v || undefined)),
        field('Note shown with the answer (optional)', ex.note ?? '', (v) => (ex.note = v || undefined)),
      );
      break;
  }
  return g;
}

function newExercise(type: ExType): LessonExercise {
  switch (type) {
    case 'note':
      return { type, title: '', body: '', sentences: [] };
    case 'scramble':
      return { type, english: '', tiles: [], correct_order: [] };
    case 'choice':
      return { type, question: '', options: [{ hanzi: '' }, { hanzi: '' }], correct: 0 };
    case 'translate':
      return { type, english: '', reference_hanzi: '' };
    case 'match':
      return { type, pairs: [{ hanzi: '', english: '' }, { hanzi: '', english: '' }] };
    case 'describe_image':
      return { type, image_prompt: '', reference_hanzi: '' };
    case 'speak':
      return { type, prompt: '' };
    case 'listen_choice':
      return { type, audio: { hanzi: '' }, options: [{ hanzi: '' }, { hanzi: '' }], correct: 0 };
    case 'listen_translate':
      return { type, audio: { hanzi: '', english: '' } };
  }
}

function moveItem<T>(arr: T[], i: number, delta: number): boolean {
  const j = i + delta;
  if (j < 0 || j >= arr.length) return false;
  const [x] = arr.splice(i, 1);
  arr.splice(j, 0, x);
  return true;
}

function exerciseCard(ex: LessonExercise, section: LessonSection, ei: number): HTMLElement {
  const tools = editing
    ? h(
        'div',
        { class: 'ex-tools' },
        h('button', { class: 'btn btn-sm', disabled: ei === 0, onclick: () => { moveItem(section.exercises, ei, -1); markDirty(); render(); } }, '↑'),
        h('button', { class: 'btn btn-sm', disabled: ei === section.exercises.length - 1, onclick: () => { moveItem(section.exercises, ei, 1); markDirty(); render(); } }, '↓'),
        h('span', { class: 'grow' }),
        confirmButton('Remove', () => { section.exercises.splice(ei, 1); markDirty(); render(); }),
      )
    : null;
  return h(
    'div',
    { class: 'exercise' },
    h('div', { class: 'ex-head' }, h('span', { class: `ex-type${LISTENING.has(ex.type) ? ' listen' : ''}` }, TYPE_LABELS[ex.type]), h('span', { class: 'spacer' }), h('span', { class: 'xs faint' }, `${ei + 1}`)),
    editing ? editExercise(ex) : viewExercise(ex),
    tools,
  );
}

function addExerciseRow(section: LessonSection): HTMLElement {
  let type: ExType = 'choice';
  return h(
    'div',
    { class: 'add-ex' },
    h(
      'select',
      { class: 'select', style: 'width:auto;flex:1', onchange: (e) => (type = (e.target as HTMLSelectElement).value as ExType) },
      ...(Object.keys(TYPE_LABELS) as ExType[]).map((t) => {
        const o = h('option', { value: t }, TYPE_LABELS[t]);
        if (t === type) o.selected = true;
        return o;
      }),
    ),
    h('button', { class: 'btn', onclick: () => { section.exercises.push(newExercise(type)); markDirty(); render(); } }, '+ Add exercise'),
  );
}

function sectionCard(section: LessonSection, si: number): HTMLElement {
  const s = spec!;
  return h(
    'div',
    { class: 'card section' },
    h(
      'div',
      { class: 'section-head' },
      editing
        ? h('input', { class: 'input input-sm grow', type: 'text', value: section.title ?? '', placeholder: `Section ${si + 1} title`, oninput: (e) => { section.title = (e.target as HTMLInputElement).value || undefined; markDirty(); } })
        : h('h2', null, section.title ?? `Section ${si + 1}`),
      h('span', { class: 'pill' }, plural(section.exercises.length, 'exercise')),
      editing
        ? h(
            'div',
            { class: 'row' },
            h('button', { class: 'btn btn-sm btn-icon', disabled: si === 0, 'aria-label': 'Move section up', onclick: () => { moveItem(s.sections, si, -1); markDirty(); render(); } }, '↑'),
            h('button', { class: 'btn btn-sm btn-icon', disabled: si === s.sections.length - 1, 'aria-label': 'Move section down', onclick: () => { moveItem(s.sections, si, 1); markDirty(); render(); } }, '↓'),
            confirmButton('Delete', () => { s.sections.splice(si, 1); markDirty(); render(); }, 'btn btn-sm btn-danger btn-icon'),
          )
        : null,
    ),
    h('div', { class: 'section-body' }, ...section.exercises.map((ex, ei) => exerciseCard(ex, section, ei)), editing ? addExerciseRow(section) : null),
  );
}

function assignmentsCard(): HTMLElement | null {
  if (!data || data.target !== 'library') return null;
  const behind = assignments.filter((a) => !a.up_to_date).length;
  return h(
    'div',
    { class: 'card', style: 'margin-top:0.75rem' },
    h('div', { class: 'row between', style: 'margin-bottom:0.25rem' }, h('h2', null, `Assigned to ${plural(assignments.length, 'student')}`), behind > 0 ? h('span', { class: 'pill pill-warn' }, `${behind} behind`) : null),
    assignments.length === 0
      ? h('p', { class: 'small muted' }, 'Nobody has this lesson yet — use Assign.')
      : h(
          'div',
          { class: 'assignments' },
          ...assignments.map((a) =>
            h(
              'div',
              { class: 'assignment' },
              avatar(a.student.name, a.student.picture_url, true),
              h(
                'div',
                { class: 'grow' },
                h('div', { class: 'ellipsis' }, a.student.name ?? a.student.email ?? 'Student'),
                h('div', { class: 'xs muted' }, a.completions > 0 ? `Done ${plural(a.completions, 'time')} · last ${RATING_LABEL[a.last_rating ?? 2]}${a.last_score ? ` (${a.last_score.correct}/${a.last_score.total})` : ''} ${timeAgo(a.last_completed_at)}` : `Assigned ${timeAgo(a.assigned_at)} · not done yet`),
              ),
              h('span', { class: `pill ${a.up_to_date ? 'pill-ok' : 'pill-warn'}` }, a.up_to_date ? 'Up to date' : 'Behind'),
            ),
          ),
        ),
  );
}

let actionsEl: HTMLElement | null = null;
function renderActions(): void {
  if (!actionsEl || !data) return;
  const saveBtn: HTMLButtonElement = h('button', { class: 'btn btn-primary', disabled: !dirty, onclick: () => busy(saveBtn, async () => void (await save())) }, dirty ? 'Save' : 'Saved');
  const behind = assignments.some((a) => !a.up_to_date);
  const pushBtn: HTMLButtonElement = h('button', { class: `btn${behind ? '' : ' btn-ghost'}`, disabled: assignments.length === 0, title: assignments.length === 0 ? 'Assign it first' : '', onclick: () => pushUpdate(pushBtn) }, '⇪ Push update');
  mount(
    actionsEl,
    h('button', { class: 'btn', onclick: () => { editing = !editing; render(); } }, editing ? 'Done editing' : '✎ Edit'),
    saveBtn,
    data.target === 'library' ? h('button', { class: 'btn', disabled: data.students.length === 0, title: data.students.length === 0 ? 'No students yet' : '', onclick: assignSheet }, '📤 Assign') : null,
    data.target === 'library' ? pushBtn : null,
  );
}

function titleBlock(): HTMLElement {
  const s = spec!;
  const d = data!;
  const total = s.sections.reduce((n, sec) => n + sec.exercises.length, 0);
  if (!editing) {
    return h(
      'div',
      null,
      h('div', { class: 'lesson-title' }, h('span', { class: 'lesson-icon' }, s.icon ?? '🎓'), h('span', null, s.title)),
      s.description ? h('div', { class: 'desc' }, s.description) : null,
      h(
        'div',
        { class: 'meta' },
        h('span', { class: 'pill pill-info' }, d.target === 'library' ? `Library${d.item.version ? ` · v${d.item.version}` : ''}` : d.item.is_owner ? 'My lesson' : "Student's copy"),
        h('span', { class: 'pill' }, `${plural(s.sections.length, 'section')} · ${plural(total, 'exercise')}`),
        ...d.item.tags.map((t) => h('span', { class: 'pill' }, `#${t}`)),
      ),
    );
  }
  return h(
    'div',
    { class: 'edit-grid' },
    h('div', { class: 'row' }, h('div', { style: 'width:4.5rem' }, field('Icon', s.icon ?? '', (v) => (s.icon = v || undefined))), h('div', { class: 'grow' }, field('Title', s.title, (v) => (s.title = v)))),
    field('Description', s.description ?? '', (v) => (s.description = v || undefined), { multiline: true }),
  );
}

function askCard(): HTMLElement | null {
  if (!host.caps.message) return null;
  const ask: HTMLButtonElement = h('button', { class: 'btn btn-primary', onclick: () => busy(ask, () => askClaude(askText)) }, 'Ask Claude');
  const chips = ['Add a listening exercise for the trickiest word', 'Make the multiple-choice distractors harder', 'Add a short note explaining the grammar', 'Simplify the vocabulary'];
  return h(
    'div',
    { class: 'card', style: 'margin-top:0.75rem' },
    h('h2', { style: 'margin-bottom:0.25rem' }, 'Ask Claude to revise'),
    h('p', { class: 'small muted', style: 'margin-bottom:0.5rem' }, dirty ? 'Your edits are saved first so Claude works from them.' : 'Say what to change; Claude updates the lesson and reopens it here.'),
    h('div', { class: 'ask' }, textField({ value: askText, multiline: true, placeholder: 'e.g. add two more choice questions about 下雨', onInput: (v) => (askText = v) }), ask),
    h('div', { class: 'chips' }, ...chips.map((c) => h('button', { class: 'chip', onclick: () => busy(ask, () => askClaude(c)) }, c))),
  );
}

function render(): void {
  if (!data || !spec) return;
  actionsEl = h('div', { class: 'actions' });
  const s = spec;
  mount(
    root,
    h('div', { class: 'header' }, h('div', { class: 'grow' }, titleBlock()), actionsEl),
    problems.length > 0 ? h('div', { style: 'margin-bottom:0.75rem' }, problemsNotice(problems)) : null,
    ...s.sections.map(sectionCard),
    editing ? h('div', { style: 'margin-top:0.75rem;text-align:center' }, h('button', { class: 'btn', onclick: () => { s.sections.push({ title: '', exercises: [] }); markDirty(); render(); } }, '+ Add section')) : null,
    assignmentsCard(),
    askCard(),
  );
  renderActions();
}

