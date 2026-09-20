/**
 * Review deck MCP App — a deck's words as an editable table, saved note by
 * note, sent to a student (or their copy updated), or extended by Claude.
 */
import './app.css';
import type { DeckNote, DeckPayload, DeckStudent, NoteSaveResult, ShareDeckResult } from '../../../tools/apps/types';
import { busy, confirmButton, h, mediaUrl, mount, playAudio, playButton, plural, textField, toast } from '../_shared/dom';
import { startApp } from '../_shared/host';
import { pickStudent } from '../_shared/picker';

interface Draft {
  hanzi: string;
  pinyin: string;
  english: string;
  sentence_clue: string;
  sentence_clue_pinyin: string;
  sentence_clue_translation: string;
}

interface Row {
  key: string;
  note: DeckNote | null; // null = not created yet
  draft: Draft;
  editing: boolean;
  problems: string[];
}

let data: DeckPayload | null = null;
let rows: Row[] = [];
let query = '';
let askText = '';
const root = document.getElementById('app')!;

const host = startApp<DeckPayload>({
  name: 'review_deck',
  onData: (d) => {
    data = d;
    rows = d.notes.map((n) => ({ key: n.id, note: n, draft: draftOf(n), editing: false, problems: [] }));
    render();
  },
  onError: (message) => mount(root, h('div', { class: 'notice notice-danger' }, message)),
});
host.onReady(() => data && render());

function draftOf(n: DeckNote | null): Draft {
  return {
    hanzi: n?.hanzi ?? '',
    pinyin: n?.pinyin ?? '',
    english: n?.english ?? '',
    sentence_clue: n?.sentence_clue ?? '',
    sentence_clue_pinyin: n?.sentence_clue_pinyin ?? '',
    sentence_clue_translation: n?.sentence_clue_translation ?? '',
  };
}

function isDirty(r: Row): boolean {
  if (!r.note) return Object.values(r.draft).some((v) => v.trim());
  const base = draftOf(r.note);
  return (Object.keys(base) as (keyof Draft)[]).some((k) => base[k] !== r.draft[k]);
}

function changedFields(r: Row): Partial<Record<keyof Draft, string | null>> {
  const base = draftOf(r.note);
  const out: Partial<Record<keyof Draft, string | null>> = {};
  for (const k of Object.keys(base) as (keyof Draft)[]) {
    if (base[k] !== r.draft[k]) out[k] = k.startsWith('sentence') ? r.draft[k].trim() || null : r.draft[k].trim();
  }
  return out;
}

function localProblems(d: Draft): string[] {
  const p: string[] = [];
  if (!d.hanzi.trim()) p.push('Hanzi is required');
  if (!d.pinyin.trim()) p.push('Pinyin is required');
  else if (/[a-z]+[1-5]/i.test(d.pinyin)) p.push('Use tone marks (nǐ hǎo), not numbers');
  if (!d.english.trim()) p.push('English is required');
  return p;
}

function deckSummary(): string {
  if (!data) return '';
  const words = rows.filter((r) => r.note).map((r) => `${r.note!.hanzi} (${r.note!.pinyin}) — ${r.note!.english}`);
  return `Deck "${data.deck.name}" (deck_id: ${data.deck.id}) now has ${plural(words.length, 'word')}:\n${words.join('\n')}`;
}

// ---------- Actions ----------

async function saveRow(r: Row): Promise<boolean> {
  if (!data) return false;
  r.problems = localProblems(r.draft);
  if (r.problems.length > 0) {
    render();
    return false;
  }
  let res;
  if (r.note) {
    const fields = changedFields(r);
    if (Object.keys(fields).length === 0) {
      r.editing = false;
      render();
      return true;
    }
    res = await host.callTool<NoteSaveResult>('app_update_note', { note_id: r.note.id, ...fields });
  } else {
    res = await host.callTool<NoteSaveResult>('app_add_note', {
      deck_id: data.deck.id,
      hanzi: r.draft.hanzi.trim(),
      pinyin: r.draft.pinyin.trim(),
      english: r.draft.english.trim(),
      sentence_clue: r.draft.sentence_clue.trim() || undefined,
      sentence_clue_pinyin: r.draft.sentence_clue_pinyin.trim() || undefined,
      sentence_clue_translation: r.draft.sentence_clue_translation.trim() || undefined,
    });
  }
  if (!res.ok || !res.data) {
    r.problems = [res.text];
    render();
    return false;
  }
  if (!res.data.ok || !res.data.note) {
    r.problems = res.data.problems ?? ['Not saved'];
    render();
    return false;
  }
  const wasNew = !r.note;
  r.note = res.data.note;
  r.key = r.note.id;
  r.draft = draftOf(r.note);
  r.editing = false;
  r.problems = [];
  data.deck.note_count = rows.filter((x) => x.note).length;
  toast(wasNew ? `Added ${r.note.hanzi}` : `Saved ${r.note.hanzi}`);
  void host.updateModelContext(`The tutor ${wasNew ? 'added' : 'edited'} ${r.note.hanzi} in the deck review app. ${deckSummary()}`);
  render();
  return true;
}

async function deleteRow(r: Row): Promise<void> {
  if (!r.note) {
    rows = rows.filter((x) => x !== r);
    render();
    return;
  }
  const res = await host.callTool('app_delete_note', { note_id: r.note.id });
  if (!res.ok) {
    toast(res.text, 'danger');
    return;
  }
  const hanzi = r.note.hanzi;
  rows = rows.filter((x) => x !== r);
  if (data) data.deck.note_count = rows.filter((x) => x.note).length;
  toast(`Deleted ${hanzi}`);
  void host.updateModelContext(`The tutor deleted ${hanzi} from the deck. ${deckSummary()}`);
  render();
}

async function saveAll(btn: HTMLButtonElement): Promise<void> {
  await busy(btn, async () => {
    const pending = rows.filter((r) => r.editing && isDirty(r));
    let ok = 0;
    for (const r of pending) if (await saveRow(r)) ok++;
    if (pending.length > 1) toast(`Saved ${ok} of ${pending.length}`);
  });
}

function addRow(): void {
  const r: Row = { key: `new-${Date.now()}`, note: null, draft: draftOf(null), editing: true, problems: [] };
  rows.unshift(r);
  render();
  root.querySelector<HTMLInputElement>('.note.new input')?.focus();
}

function sendToStudent(): void {
  if (!data) return;
  pickStudent({
    title: `Send "${data.deck.name}" to…`,
    rows: data.students.map((s) => ({
      student: s,
      sub: s.shared
        ? s.shared.notes_missing > 0
          ? `Already has it · ${plural(s.shared.notes_missing, 'new word')} to send · ${Math.round(s.shared.percent_started)}% started`
          : `Already has it · up to date · ${Math.round(s.shared.percent_started)}% started`
        : 'Not sent yet — a copy goes into their app',
      action: s.shared ? 'Update copy' : 'Send',
      disabled: !!s.shared && s.shared.notes_missing === 0,
    })),
    onPick: async (s: DeckStudent) => {
      const res = s.shared
        ? await host.callTool<ShareDeckResult>('app_update_shared_deck', { relationship_id: s.relationship_id, shared_deck_id: s.shared.shared_deck_id })
        : await host.callTool<ShareDeckResult>('app_share_deck', { relationship_id: s.relationship_id, deck_id: data!.deck.id });
      if (!res.ok || !res.data) throw new Error(res.text);
      if (s.shared) s.shared.notes_missing = 0;
      else s.shared = { shared_deck_id: res.data.shared_deck_id ?? '', notes_missing: 0, cards_total: rows.length * 3, percent_started: 0 };
      void host.updateModelContext(`The tutor sent deck "${data!.deck.name}" (deck_id ${data!.deck.id}) to ${s.name} (relationship ${s.relationship_id}). ${res.data.message}`);
      render();
      return res.data.message;
    },
  });
}

async function askClaude(instruction: string): Promise<void> {
  if (!data) return;
  const text = instruction.trim();
  if (!text) {
    toast('Say what to add or change first', 'danger');
    return;
  }
  const prompt = `In my deck "${data.deck.name}" (deck_id: ${data.deck.id}): ${text}\n\nAdd or update the words with the deck tools (check for duplicates first, tone-marked pinyin, one example sentence each), then open the deck again with review_deck so I can check it.`;
  const sent = await host.sendMessage(prompt);
  if (sent) {
    askText = '';
    toast('Asked Claude');
    render();
  } else toast(host.preview ? 'Preview: message not sent' : 'This host cannot receive messages from the app', 'danger');
}

// ---------- Rendering ----------

function matches(r: Row): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const d = r.draft;
  return [d.hanzi, d.pinyin, d.english, d.sentence_clue].some((v) => v.toLowerCase().includes(q));
}

function noteView(r: Row): HTMLElement {
  const n = r.note!;
  return h(
    'div',
    { class: 'note' },
    h('div', { class: 'play' }, playButton(() => playAudio(mediaUrl(data!.media_base, n.audio_url), n.hanzi), false, `Play ${n.hanzi}`)),
    h('div', { class: 'main c-hanzi' }, h('div', { class: 'zh', lang: 'zh-CN' }, n.hanzi), n.audio_url ? null : h('div', { class: 'missing-audio' }, 'audio pending')),
    h('div', { class: 'main c-pinyin pinyin' }, n.pinyin),
    h('div', { class: 'main c-en' }, n.english),
    h(
      'div',
      { class: 'sent' },
      n.sentence_clue ? h('span', { class: 'zh-s', lang: 'zh-CN' }, n.sentence_clue) : h('span', { class: 'faint' }, 'No example sentence'),
      n.sentence_clue_translation ? h('span', { class: 'xs' }, ` ${n.sentence_clue_translation}`) : null,
    ),
    h('div', { class: 'tools' }, h('button', { class: 'btn btn-sm', onclick: () => { r.editing = true; render(); } }, '✎ Edit')),
  );
}

function noteEditor(r: Row): HTMLElement {
  const d = r.draft;
  const saveBtn: HTMLButtonElement = h('button', { class: 'btn btn-primary btn-sm', onclick: () => busy(saveBtn, async () => void (await saveRow(r))) }, r.note ? 'Save' : 'Add word');
  return h(
    'div',
    { class: `note${r.note ? '' : ' new'}${isDirty(r) ? ' dirty' : ''}` },
    h(
      'div',
      { class: 'note-edit' },
      textField({ label: 'Hanzi', value: d.hanzi, zh: true, placeholder: '汉字', onInput: (v) => (d.hanzi = v) }),
      textField({ label: 'Pinyin', value: d.pinyin, placeholder: 'hàn zì', onInput: (v) => (d.pinyin = v) }),
      textField({ label: 'English', value: d.english, placeholder: 'meaning', onInput: (v) => (d.english = v) }),
      h('div', { class: 'wide' }, textField({ label: 'Example sentence', value: d.sentence_clue, zh: true, placeholder: '一个例句', onInput: (v) => (d.sentence_clue = v) })),
      textField({ label: 'Sentence pinyin', value: d.sentence_clue_pinyin, onInput: (v) => (d.sentence_clue_pinyin = v) }),
      h('div', { class: 'span2' }, textField({ label: 'Sentence English', value: d.sentence_clue_translation, onInput: (v) => (d.sentence_clue_translation = v) })),
      r.problems.length > 0 ? h('div', { class: 'row-problems' }, r.problems.join(' · ')) : null,
      h(
        'div',
        { class: 'tools' },
        r.note ? confirmButton('Delete', () => void deleteRow(r)) : null,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn btn-sm', onclick: () => { if (!r.note) rows = rows.filter((x) => x !== r); else { r.draft = draftOf(r.note); r.editing = false; r.problems = []; } render(); } }, 'Cancel'),
        saveBtn,
      ),
    ),
  );
}

function studentsLine(): HTMLElement | null {
  if (!data) return null;
  const sent = data.students.filter((s) => s.shared);
  if (sent.length === 0) return h('div', { class: 'small muted' }, data.students.length > 0 ? 'Not sent to anyone yet.' : 'No students yet.');
  return h(
    'div',
    { class: 'students-line' },
    ...sent.map((s) => h('span', { class: `pill ${s.shared!.notes_missing > 0 ? 'pill-warn' : 'pill-ok'}`, title: `${Math.round(s.shared!.percent_started)}% started` }, `${s.name}${s.shared!.notes_missing > 0 ? ` · ${s.shared!.notes_missing} new` : ' ✓'}`)),
  );
}

function askCard(): HTMLElement | null {
  if (!host.caps.message || !data) return null;
  const ask: HTMLButtonElement = h('button', { class: 'btn btn-primary', onclick: () => busy(ask, () => askClaude(askText)) }, 'Ask Claude');
  const chips = ['Add 5 more words on the same theme', 'Add an example sentence to every word that has none', 'Check the pinyin tone marks', 'Add the measure words these nouns take'];
  return h(
    'div',
    { class: 'card', style: 'margin-top:0.75rem' },
    h('h2', { style: 'margin-bottom:0.25rem' }, 'Ask Claude'),
    h('div', { class: 'ask' }, textField({ value: askText, multiline: true, placeholder: 'e.g. add 5 more words about ordering drinks', onInput: (v) => (askText = v) }), ask),
    h('div', { class: 'chips' }, ...chips.map((c) => h('button', { class: 'chip', onclick: () => busy(ask, () => askClaude(c)) }, c))),
  );
}

function render(): void {
  if (!data) return;
  const visible = rows.filter(matches);
  const pending = rows.filter((r) => r.editing && isDirty(r)).length;
  const saveAllBtn: HTMLButtonElement = h('button', { class: 'btn btn-primary', onclick: () => saveAll(saveAllBtn) }, `Save ${plural(pending, 'change')}`);
  mount(
    root,
    h(
      'div',
      { class: 'header' },
      h(
        'div',
        { class: 'grow' },
        h('div', { class: 'deck-name' }, data.deck.name),
        data.deck.description ? h('div', { class: 'small muted' }, data.deck.description) : null,
        h('div', { class: 'meta' }, h('span', { class: 'pill pill-info' }, plural(data.deck.note_count, 'word')), h('span', { class: 'pill' }, `${data.students.filter((s) => s.shared).length} of ${plural(data.students.length, 'student')} have it`)),
      ),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: addRow }, '+ Add word'), h('button', { class: 'btn btn-primary', disabled: data.students.length === 0, onclick: sendToStudent }, '📤 Send to student')),
    ),
    h('div', { style: 'margin-bottom:0.5rem' }, studentsLine()),
    h('div', { class: 'toolbar' }, h('input', { class: 'input input-sm', type: 'search', placeholder: 'Filter words…', value: query, oninput: (e) => { query = (e.target as HTMLInputElement).value; renderList(); } })),
    h('div', { class: 'head-row' }, h('span'), h('span', null, 'Hanzi'), h('span', null, 'Pinyin'), h('span', null, 'English'), h('span', null, 'Sentence'), h('span')),
    listEl(visible),
    pending > 1 ? h('div', { class: 'sticky-actions' }, saveAllBtn) : null,
    askCard(),
  );
}

let list: HTMLElement | null = null;
function listEl(visible: Row[]): HTMLElement {
  list = h('div', { class: 'notes' });
  fillList(visible);
  return list;
}
function fillList(visible: Row[]): void {
  if (!list) return;
  mount(list, visible.length === 0 ? h('div', { class: 'empty' }, query ? 'No words match.' : 'This deck is empty — add a word or ask Claude.') : visible.map((r) => (r.editing ? noteEditor(r) : noteView(r))));
}
function renderList(): void {
  fillList(rows.filter(matches));
}
