/**
 * Review reader MCP App — a graded reader page by page, editable in place,
 * saved whole, sent to a student, or handed to Claude for a revision.
 */
import './app.css';
import { validateReaderSpec } from '../../../../../shared/reader/validate';
import type { ReaderPageSpec, ReaderPayload, ReaderSaveResult, ReaderSpec } from '../../../tools/apps/types';
import { busy, confirmButton, h, mediaUrl, mount, plural, problemsNotice, speakZh, textField, toast } from '../_shared/dom';
import { startApp } from '../_shared/host';
import { pickStudent } from '../_shared/picker';

const DIFFICULTIES = ['beginner', 'elementary', 'intermediate', 'advanced'] as const;

let data: ReaderPayload | null = null;
let spec: ReaderSpec | null = null;
let editing = false;
let dirty = false;
let problems: string[] = [];
let askText = '';
const root = document.getElementById('app')!;

const host = startApp<ReaderPayload>({
  name: 'review_reader',
  onData: (d) => {
    data = d;
    spec = clone(d.spec);
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

function summary(s: ReaderSpec): string {
  return `Reader ${data?.reader.id} 《${s.title_chinese}》 ${s.title_english} (${s.difficulty_level}), ${plural(s.pages.length, 'page')}:\n${s.pages
    .map((p, i) => `${i + 1}. ${p.content_chinese} — ${p.content_english}`)
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
  problems = validateReaderSpec(spec);
  if (problems.length > 0) {
    render();
    return false;
  }
  const res = await host.callTool<ReaderSaveResult>('app_save_reader_spec', { reader_id: data.reader.id, spec });
  if (!res.ok || !res.data) {
    toast(res.text, 'danger');
    return false;
  }
  if (!res.data.ok) {
    problems = res.data.problems ?? ['The server rejected the reader.'];
    render();
    return false;
  }
  spec = clone(res.data.spec ?? spec);
  data.spec = clone(spec);
  dirty = false;
  problems = [];
  const jobs = res.data.image_jobs ?? 0;
  toast(jobs > 0 ? `Saved · ${plural(jobs, 'illustration')} queued` : 'Saved');
  void host.updateModelContext(`The tutor edited and saved the reader in the review app. Current content:\n${summary(spec)}`);
  render();
  return true;
}

function sendToStudent(): void {
  if (!data) return;
  pickStudent({
    title: 'Send this reader to…',
    rows: data.students.map((s) => ({
      student: s,
      sub: s.already_shared ? 'Already has this reader — sending again makes a fresh copy' : 'Will appear in their Readers list',
      action: s.already_shared ? 'Send again' : 'Send',
    })),
    onPick: async (s) => {
      if (dirty) {
        const ok = await save();
        if (!ok) throw new Error('Fix the problems and save first.');
      }
      const res = await host.callTool('app_share_reader', { relationship_id: s.relationship_id, reader_id: data!.reader.id });
      if (!res.ok) throw new Error(res.text);
      s.already_shared = true;
      void host.updateModelContext(`The tutor sent reader ${data!.reader.id} 《${spec!.title_chinese}》 to ${s.name} (relationship ${s.relationship_id}).`);
      return `Sent to ${s.name}`;
    },
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
  const prompt = `Please revise the graded reader 《${spec.title_chinese}》 (reader_id: ${data.reader.id}): ${text}\n\nApply the change to the reader itself (update_reader), keeping the pages I did not mention, then open it again with review_reader so I can check it.`;
  const sent = await host.sendMessage(prompt);
  if (sent) {
    askText = '';
    toast('Asked Claude to revise');
    render();
  } else toast(host.preview ? 'Preview: message not sent' : 'This host cannot receive messages from the app', 'danger');
}

// ---------- Page editing ----------

function blankPage(): ReaderPageSpec {
  return { content_chinese: '', content_pinyin: '', content_english: '', image_prompt: null };
}

function movePage(i: number, delta: number): void {
  if (!spec) return;
  const j = i + delta;
  if (j < 0 || j >= spec.pages.length) return;
  const [p] = spec.pages.splice(i, 1);
  spec.pages.splice(j, 0, p);
  markDirty();
  render();
}

function insertPage(at: number, page = blankPage()): void {
  if (!spec) return;
  spec.pages.splice(at, 0, page);
  markDirty();
  render();
  root.querySelectorAll<HTMLTextAreaElement>('.zh-edit')[at]?.focus();
}

function deletePage(i: number): void {
  if (!spec) return;
  spec.pages.splice(i, 1);
  markDirty();
  render();
}

function duplicatePage(i: number): void {
  if (!spec) return;
  const src = spec.pages[i];
  insertPage(i + 1, { content_chinese: src.content_chinese, content_pinyin: src.content_pinyin, content_english: src.content_english, image_prompt: src.image_prompt ?? null });
}

// ---------- Rendering ----------

function illustration(p: ReaderPageSpec): HTMLElement | null {
  if (!data) return null;
  const url = mediaUrl(data.media_base, p.image_url);
  if (!url && !p.image_prompt) return null;
  return h(
    'div',
    { class: 'illustration' },
    url ? h('img', { src: url, alt: p.image_prompt ?? '' }) : h('div', { class: 'pending' }, 'Illustration on its way — it appears once generated'),
    p.image_prompt ? h('div', { class: 'prompt-line' }, p.image_prompt) : null,
  );
}

function pageView(p: ReaderPageSpec, i: number): HTMLElement {
  const img = illustration(p);
  return h(
    'div',
    { class: 'card page' },
    h(
      'div',
      { class: 'page-head' },
      `Page ${i + 1}`,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-sm btn-icon btn-ghost', 'aria-label': 'Play page', title: 'Play', onclick: () => speakZh(p.content_chinese) }, '▶'),
    ),
    h(
      'div',
      { class: `page-body${img ? ' with-image' : ''}` },
      h('div', null, h('div', { class: 'page-zh', lang: 'zh-CN' }, p.content_chinese), p.content_pinyin ? h('div', { class: 'page-py' }, p.content_pinyin) : null, h('div', { class: 'page-en' }, p.content_english)),
      img,
    ),
  );
}

function pageEditor(p: ReaderPageSpec, i: number): HTMLElement {
  const n = spec!.pages.length;
  return h(
    'div',
    { class: 'card page' },
    h(
      'div',
      { class: 'page-head' },
      `Page ${i + 1}`,
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn btn-sm btn-icon btn-ghost', 'aria-label': 'Play page', onclick: () => speakZh(p.content_chinese) }, '▶'),
    ),
    h(
      'div',
      { class: 'page-body' },
      h(
        'div',
        { class: 'edit-grid' },
        h(
          'label',
          { class: 'field' },
          h('span', { class: 'label' }, 'Chinese'),
          h('textarea', {
            class: 'textarea zh-edit',
            rows: 2,
            value: p.content_chinese,
            oninput: (e) => {
              p.content_chinese = (e.target as HTMLTextAreaElement).value;
              markDirty();
            },
            ref: (el) => requestAnimationFrame(() => fit(el as HTMLTextAreaElement)),
          }),
        ),
        textField({ label: 'Pinyin', value: p.content_pinyin ?? '', multiline: true, placeholder: 'Tone-marked pinyin (blank = fill in later)', onInput: (v) => { p.content_pinyin = v; markDirty(); } }),
        textField({ label: 'English', value: p.content_english, multiline: true, onInput: (v) => { p.content_english = v; markDirty(); } }),
        textField({ label: 'Illustration prompt (blank = no picture)', value: p.image_prompt ?? '', multiline: true, placeholder: 'A scene description in English, no text in the image', onInput: (v) => { p.image_prompt = v.trim() ? v : null; markDirty(); } }),
        p.image_url ? h('div', { class: 'xs faint' }, 'Has an illustration — it is kept unless the prompt changes') : null,
      ),
    ),
    h(
      'div',
      { class: 'page-tools' },
      h('button', { class: 'btn btn-sm', disabled: i === 0, onclick: () => movePage(i, -1) }, '↑ Up'),
      h('button', { class: 'btn btn-sm', disabled: i === n - 1, onclick: () => movePage(i, 1) }, '↓ Down'),
      h('button', { class: 'btn btn-sm', onclick: () => duplicatePage(i) }, 'Duplicate'),
      h('button', { class: 'btn btn-sm', onclick: () => insertPage(i + 1) }, '+ Page after'),
      h('span', { class: 'grow' }),
      confirmButton('Delete', () => deletePage(i)),
    ),
  );
}

function fit(ta: HTMLTextAreaElement): void {
  ta.style.height = 'auto';
  ta.style.height = `${Math.max(44, ta.scrollHeight + 2)}px`;
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(44, ta.scrollHeight + 2)}px`;
  });
}

function titleBlock(): HTMLElement {
  const s = spec!;
  if (!editing) {
    return h(
      'div',
      null,
      h('div', { class: 'title-zh', lang: 'zh-CN' }, s.title_chinese),
      h('div', { class: 'title-en' }, s.title_english),
      h(
        'div',
        { class: 'meta' },
        h('span', { class: 'pill pill-info' }, s.difficulty_level),
        h('span', { class: 'pill' }, plural(s.pages.length, 'page')),
        s.topic ? h('span', { class: 'pill' }, s.topic) : null,
        data!.reader.status !== 'ready' ? h('span', { class: 'pill pill-warn' }, data!.reader.status) : null,
      ),
    );
  }
  return h(
    'div',
    { class: 'edit-grid' },
    textField({ label: 'Title (Chinese)', value: s.title_chinese, zh: true, onInput: (v) => { s.title_chinese = v; markDirty(); } }),
    textField({ label: 'Title (English)', value: s.title_english, onInput: (v) => { s.title_english = v; markDirty(); } }),
    h(
      'div',
      { class: 'row' },
      h(
        'label',
        { class: 'field grow' },
        h('span', { class: 'label' }, 'Level'),
        h(
          'select',
          { class: 'select', onchange: (e) => { s.difficulty_level = (e.target as HTMLSelectElement).value as ReaderSpec['difficulty_level']; markDirty(); } },
          ...DIFFICULTIES.map((d) => {
            const o = h('option', { value: d }, d);
            if (d === s.difficulty_level) o.selected = true;
            return o;
          }),
        ),
      ),
      textField({ label: 'Topic', value: s.topic ?? '', onInput: (v) => { s.topic = v.trim() ? v : null; markDirty(); } }),
    ),
  );
}

let actionsEl: HTMLElement | null = null;
function renderActions(): void {
  if (!actionsEl || !spec) return;
  const saveBtn: HTMLButtonElement = h('button', { class: 'btn btn-primary', disabled: !dirty, onclick: () => busy(saveBtn, async () => void (await save())) }, dirty ? 'Save' : 'Saved');
  mount(
    actionsEl,
    h('button', { class: 'btn', onclick: () => { editing = !editing; render(); } }, editing ? 'Done editing' : '✎ Edit'),
    saveBtn,
    h('button', { class: 'btn', disabled: data!.students.length === 0, title: data!.students.length === 0 ? 'No students yet' : '', onclick: sendToStudent }, '📤 Send to student'),
  );
}

function askCard(): HTMLElement | null {
  if (!host.caps.message) return null;
  const ask: HTMLButtonElement = h('button', { class: 'btn btn-primary', onclick: () => busy(ask, () => askClaude(askText)) }, 'Ask Claude');
  const chips = ['Make the language simpler', 'Add one more page at the end', 'Use more of the vocabulary list', 'Fix any unnatural phrasing'];
  return h(
    'div',
    { class: 'card ask-card' },
    h('h2', { style: 'margin-bottom:0.25rem' }, 'Ask Claude to revise'),
    h('p', { class: 'small muted', style: 'margin-bottom:0.5rem' }, dirty ? 'Your edits are saved first so Claude works from them.' : 'Say what to change; Claude updates the reader and reopens it here.'),
    h('div', { class: 'ask' }, textField({ value: askText, multiline: true, placeholder: 'e.g. make page 3 simpler and use 点菜', onInput: (v) => (askText = v) }), ask),
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
    editing ? h('div', { class: 'add-page' }, h('button', { class: 'btn btn-sm', onclick: () => insertPage(0) }, '+ Page at the start')) : null,
    ...s.pages.map((p, i) => (editing ? pageEditor(p, i) : pageView(p, i))),
    editing ? h('div', { class: 'add-page' }, h('button', { class: 'btn', onclick: () => insertPage(s.pages.length) }, '+ Add page')) : null,
    !editing && s.vocabulary_used && s.vocabulary_used.length > 0
      ? h(
          'div',
          { class: 'card', style: 'margin-top:0.75rem' },
          h('h2', { style: 'margin-bottom:0.4rem' }, 'Vocabulary used'),
          h('div', { class: 'vocab' }, ...s.vocabulary_used.map((v) => h('span', { class: 'pill', title: v.english }, `${v.hanzi} ${v.pinyin}`))),
        )
      : null,
    askCard(),
  );
  renderActions();
}
