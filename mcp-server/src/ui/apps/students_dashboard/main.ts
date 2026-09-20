/**
 * Students dashboard MCP App — one card per student, expandable, with quick
 * actions (log a lesson, message, mark recordings) and "Ask Claude" prompts.
 */
import './app.css';
import type {
  DashNeedsAttention,
  DashRecording,
  DashStudent,
  DashboardPayload,
  StudentDetailPayload,
} from '../../../tools/apps/types';
import {
  avatar,
  busy,
  h,
  mediaUrl,
  minutes,
  mount,
  openSheet,
  pct,
  playAudio,
  playButton,
  plural,
  problemsNotice,
  shortDate,
  textField,
  timeAgo,
  toast,
  RATING_LABEL,
} from '../_shared/dom';
import { startApp } from '../_shared/host';

type Detail = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; detail: StudentDetailPayload };

let data: DashboardPayload | null = null;
const expanded = new Set<string>();
const details = new Map<string, Detail>();
const root = document.getElementById('app')!;
const tz = () => new Date().getTimezoneOffset();

const host = startApp<DashboardPayload>({
  name: 'students_dashboard',
  onData: (d) => {
    data = d;
    render();
  },
  onError: (message) => mount(root, h('div', { class: 'notice notice-danger' }, message)),
});
host.onReady(() => data && render());

function name(s: DashStudent): string {
  return s.student.name?.trim() || s.student.email || 'Student';
}

// ---------- Actions ----------

async function refresh(): Promise<void> {
  const res = await host.callTool<DashboardPayload>('app_refresh_dashboard', { tz_offset_minutes: tz() });
  if (res.ok && res.data) {
    data = res.data;
    for (const id of expanded) void loadDetail(id, true);
    render();
  } else if (!host.preview) toast(res.text, 'danger');
}

async function loadDetail(relId: string, force = false): Promise<void> {
  if (!force && details.has(relId)) return;
  details.set(relId, { state: 'loading' });
  if (!force) render();
  const res = await host.callTool<StudentDetailPayload>('app_student_detail', { relationship_id: relId, tz_offset_minutes: tz() });
  if (res.ok && res.data) details.set(relId, { state: 'ready', detail: res.data });
  else details.set(relId, { state: 'error', message: res.text });
  render();
}

function askClaude(prompt: string): void {
  void host.sendMessage(prompt).then((sent) => {
    if (sent) toast('Sent to Claude');
    else toast(host.preview ? 'Preview: message not sent' : 'This host cannot receive messages from the app', 'danger');
  });
}

function logLessonSheet(s: DashStudent): void {
  const sheet = openSheet(`Log a lesson with ${name(s)}`);
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  let when = now.toISOString().slice(0, 16);
  let notes = '';
  const status = h('div', { class: 'small', style: 'min-height:1.2em;margin-top:0.4rem' });
  const save: HTMLButtonElement = h('button', { class: 'btn btn-primary btn-block' }, 'Log lesson');
  save.addEventListener('click', () =>
    busy(save, async () => {
      const lessonAt = new Date(when);
      if (Number.isNaN(lessonAt.getTime())) {
        status.textContent = 'Pick a date and time.';
        status.style.color = 'var(--danger)';
        return;
      }
      const res = await host.callTool('app_log_lesson', { relationship_id: s.relationship_id, lesson_at: lessonAt.toISOString(), notes: notes.trim() || undefined });
      if (!res.ok) {
        status.textContent = res.text;
        status.style.color = 'var(--danger)';
        return;
      }
      toast(`Lesson logged for ${name(s)}`);
      void host.updateModelContext(`The tutor logged a lesson with ${name(s)} (relationship ${s.relationship_id}) at ${lessonAt.toISOString()}${notes.trim() ? ` with notes: ${notes.trim()}` : ''}.`);
      sheet.close();
      if (expanded.has(s.relationship_id)) void loadDetail(s.relationship_id, true);
    }),
  );
  sheet.body.append(
    h(
      'label',
      { class: 'field' },
      h('span', { class: 'label' }, 'When'),
      h('input', { class: 'input', type: 'datetime-local', value: when, oninput: (e) => (when = (e.target as HTMLInputElement).value) }),
    ),
    textField({ label: 'Notes (optional — the student sees them in their lesson notes)', value: '', multiline: true, placeholder: 'What you covered, what to practise…', onInput: (v) => (notes = v) }),
    h('div', { style: 'margin-top:0.75rem' }, save, status),
  );
}

function messageSheet(s: DashStudent, prefill = ''): void {
  const sheet = openSheet(`Message ${name(s)}`);
  let text = prefill;
  const status = h('div', { class: 'small', style: 'min-height:1.2em;margin-top:0.4rem' });
  const send: HTMLButtonElement = h('button', { class: 'btn btn-primary btn-block' }, 'Send');
  send.addEventListener('click', () =>
    busy(send, async () => {
      if (!text.trim()) {
        status.textContent = 'Write something first.';
        status.style.color = 'var(--danger)';
        return;
      }
      const res = await host.callTool('app_send_message', { relationship_id: s.relationship_id, content: text.trim() });
      if (!res.ok) {
        status.textContent = res.text;
        status.style.color = 'var(--danger)';
        return;
      }
      toast(`Sent to ${name(s)}`);
      void host.updateModelContext(`The tutor sent ${name(s)} a chat message: "${text.trim()}"`);
      sheet.close();
    }),
  );
  sheet.body.append(
    textField({ value: prefill, multiline: true, placeholder: `Hi ${name(s)}…`, onInput: (v) => (text = v) }),
    h('div', { style: 'margin-top:0.75rem' }, send, status),
  );
}

async function markRecording(s: DashStudent, rec: { event_id: string; hanzi: string }, status: 'listened' | 'needs_work', comment?: string): Promise<boolean> {
  const res = await host.callTool<{ ok: boolean; mark: DashRecording['mark'] }>('app_mark_recording', {
    relationship_id: s.relationship_id,
    event_id: rec.event_id,
    status,
    comment,
  });
  if (!res.ok) {
    toast(res.text, 'danger');
    return false;
  }
  // Reflect the mark locally without a full reload.
  const d = details.get(s.relationship_id);
  if (d?.state === 'ready') {
    const row = d.detail.recordings.find((r) => r.event_id === rec.event_id);
    if (row) {
      if (!row.mark) {
        d.detail.overview.pills.recordings_to_hear = Math.max(0, d.detail.overview.pills.recordings_to_hear - 1);
        s.pills.recordings_to_hear = Math.max(0, s.pills.recordings_to_hear - 1);
      }
      row.mark = res.data?.mark ?? { status, comment: comment ?? null, updated_at: new Date().toISOString() };
    }
  }
  for (const item of s.needs_attention) {
    if (item.recording?.event_id === rec.event_id) {
      item.recordings_unheard = Math.max(0, item.recordings_unheard - 1);
      item.recording = null;
    }
  }
  toast(status === 'listened' ? `Marked ${rec.hanzi} as listened` : `Sent a note on ${rec.hanzi}`);
  void host.updateModelContext(
    `The tutor marked ${name(s)}'s recording of ${rec.hanzi} as ${status === 'listened' ? 'listened' : 'needs work'}${comment ? ` with the comment: "${comment}"` : ''}.`,
  );
  render();
  return true;
}

// ---------- Rendering ----------

function statusLine(s: DashStudent): HTMLElement {
  const st = s.status;
  const parts: (string | HTMLElement)[] = [];
  if (s.is_new) {
    parts.push(h('span', { class: 'dot dot-warn' }), 'Getting set up', `· joined ${timeAgo(s.joined_at)}`);
  } else if (st.studied_today) {
    parts.push(h('span', { class: 'dot dot-ok' }), `Studied today · ${plural(st.today.reviews, 'card')}`);
    if (st.today.accuracy !== null) parts.push(`· ${pct(st.today.accuracy)} right`);
    if (st.today.time_ms > 0) parts.push(`· ${minutes(st.today.time_ms)}`);
  } else {
    const stale = st.last_studied_at && Date.now() - new Date(st.last_studied_at).getTime() > 3 * 86400_000;
    parts.push(h('span', { class: `dot ${stale ? 'dot-danger' : ''}` }), `Last studied ${timeAgo(st.last_studied_at)}`);
  }
  if (st.streak_days > 1) parts.push(`· 🔥 ${st.streak_days}-day streak`);
  return h('div', { class: 'status-line' }, ...parts);
}

function pills(s: DashStudent): HTMLElement {
  const p = s.pills;
  return h(
    'div',
    { class: 'pills' },
    h('span', { class: `pill ${p.struggling_words > 0 ? 'pill-warn' : ''}` }, `${p.struggling_words} struggling`),
    h('span', { class: `pill ${p.recordings_to_hear > 0 ? 'pill-info' : ''}` }, `🎤 ${p.recordings_to_hear} to hear`),
    p.homework_percent !== null ? h('span', { class: `pill ${p.homework_percent >= 80 ? 'pill-ok' : ''}` }, `Homework ${p.homework_percent}%`) : h('span', { class: 'pill' }, 'No homework yet'),
  );
}

function wrongAnswers(item: DashNeedsAttention): HTMLElement | null {
  if (item.wrong_answers.length === 0) return null;
  return h(
    'div',
    { class: 'small' },
    h('span', { class: 'muted' }, 'typed '),
    ...item.wrong_answers.slice(0, 3).flatMap((w, i) => [i > 0 ? h('span', { class: 'muted' }, ' · ') : null, h('span', { class: 'wrong' }, h('s', null, w))]),
    item.wrong_typed_count > 3 ? h('span', { class: 'muted' }, ` +${item.wrong_typed_count - 3}`) : null,
  );
}

function needsAttention(s: DashStudent, full: boolean): HTMLElement | null {
  const items = full ? s.needs_attention : s.needs_attention.slice(0, 3);
  if (items.length === 0) return null;
  if (!full) {
    return h(
      'div',
      { class: 'word-chips' },
      ...items.map((it) => h('span', { class: 'word-chip', title: `${it.note.pinyin} · ${it.note.english}` }, it.note.hanzi)),
      s.needs_attention.length > 3 ? h('span', { class: 'pill' }, `+${s.needs_attention.length - 3} more`) : null,
    );
  }
  return h(
    'div',
    { class: 'words' },
    ...items.map((it) =>
      h(
        'div',
        { class: 'word' },
        h('span', { class: 'zh' }, it.note.hanzi),
        h(
          'div',
          { class: 'word-meta' },
          h('div', null, h('span', { class: 'pinyin' }, it.note.pinyin), ' · ', h('span', null, it.note.english)),
          h('div', { class: 'xs faint' }, `${it.again_count}× again, ${it.hard_count}× hard of ${plural(it.attempts, 'try', 'tries')} · ${it.note.deck_name}`),
          wrongAnswers(it),
        ),
        it.recording
          ? h(
              'div',
              { class: 'row' },
              playButton(() => playAudio(mediaUrl(data!.media_base, it.recording!.recording_url), it.note.hanzi), true, 'Play recording'),
              h(
                'button',
                {
                  class: 'btn btn-sm',
                  onclick: (e) => busy(e.currentTarget as HTMLButtonElement, async () => void (await markRecording(s, { event_id: it.recording!.event_id, hanzi: it.note.hanzi }, 'listened'))),
                },
                'Heard',
              ),
            )
          : null,
      ),
    ),
  );
}

function setupChecklist(s: DashStudent): HTMLElement {
  return h(
    'div',
    { class: 'card-inset' },
    h('div', { class: 'row between', style: 'margin-bottom:0.5rem' }, h('h3', null, 'Getting set up'), h('span', { class: 'pill' }, `${s.setup.done_count}/${s.setup.steps.length}`)),
    h(
      'div',
      { class: 'steps' },
      ...s.setup.steps.map((st) =>
        h(
          'div',
          { class: 'step' },
          h('span', { class: `step-mark${st.done ? ' done' : ''}` }, st.done ? '✓' : ''),
          h('div', null, h('div', { class: st.done ? '' : 'bold' }, st.title), h('div', { class: 'xs muted' }, st.detail)),
        ),
      ),
    ),
    s.setup.invite && !s.setup.invite.redeemed_at
      ? h('div', { class: 'xs muted', style: 'margin-top:0.5rem' }, `Invite link ${s.setup.invite.status}`)
      : null,
  );
}

function quickActions(s: DashStudent): HTMLElement {
  const n = name(s);
  const askPrompts: Array<[string, string]> = [
    ['Summarise & draft review deck', `Summarise what ${n} (relationship ${s.relationship_id}) struggled with this week and draft a 5-word review deck for them.`],
    ['Plan next lesson', `Using ${n}'s recent activity (relationship ${s.relationship_id}), suggest a 30-minute lesson plan that targets the words they keep getting wrong.`],
    ['Write encouragement', `Draft a short, warm message in simple Chinese with an English translation to encourage ${n} (relationship ${s.relationship_id}), mentioning something concrete they did well recently.`],
  ];
  return h(
    'div',
    null,
    h(
      'div',
      { class: 'quick' },
      h('button', { class: 'btn', onclick: () => logLessonSheet(s) }, '📝 Log lesson'),
      h('button', { class: 'btn', onclick: () => messageSheet(s) }, '💬 Message'),
      h('button', { class: 'btn', onclick: () => expandStudent(s.relationship_id) }, expanded.has(s.relationship_id) ? 'Less' : 'Details'),
    ),
    host.caps.message
      ? h(
          'div',
          { class: 'chips' },
          h('span', { class: 'xs faint', style: 'align-self:center' }, 'Ask Claude:'),
          ...askPrompts.map(([label, prompt]) => h('button', { class: 'chip', onclick: () => askClaude(prompt) }, label)),
        )
      : null,
  );
}

function recordingsList(s: DashStudent, recs: DashRecording[]): HTMLElement {
  const unmarked = recs.filter((r) => !r.mark);
  const marked = recs.filter((r) => r.mark);
  const rows = [...unmarked, ...marked].slice(0, 12);
  if (rows.length === 0) return h('p', { class: 'small muted' }, 'No recordings in this range.');
  return h(
    'div',
    null,
    ...rows.map((r) => {
      const commentBox = h('div', { class: 'rec-comment', style: 'display:none' });
      let comment = '';
      const sendNote: HTMLButtonElement = h('button', { class: 'btn btn-primary btn-sm' }, 'Send note');
      sendNote.addEventListener('click', () => busy(sendNote, async () => void (await markRecording(s, { event_id: r.event_id, hanzi: r.note.hanzi }, 'needs_work', comment.trim() || undefined))));
      commentBox.append(
        textField({ value: '', multiline: true, small: true, placeholder: `What to work on in ${r.note.hanzi} (the student sees this on the card)`, onInput: (v) => (comment = v) }),
        sendNote,
      );
      return h(
        'div',
        { class: 'rec' },
        playButton(() => playAudio(mediaUrl(data!.media_base, r.recording_url), r.note.hanzi), true, 'Play recording'),
        h('span', { class: 'zh' }, r.note.hanzi),
        h('div', { class: 'grow' }, h('div', { class: 'small' }, h('span', { class: 'pinyin' }, r.note.pinyin), ' · ', r.note.english), h('div', { class: 'xs faint' }, `${RATING_LABEL[r.rating] ?? ''} · ${timeAgo(r.reviewed_at)}`)),
        r.mark
          ? h('span', { class: `pill ${r.mark.status === 'needs_work' ? 'pill-warn' : 'pill-ok'}`, title: r.mark.comment ?? '' }, r.mark.status === 'needs_work' ? 'Needs work' : 'Listened')
          : h(
              'div',
              { class: 'rec-actions' },
              h('button', { class: 'btn btn-sm', onclick: (e) => busy(e.currentTarget as HTMLButtonElement, async () => void (await markRecording(s, { event_id: r.event_id, hanzi: r.note.hanzi }, 'listened'))) }, 'Listened'),
              h(
                'button',
                {
                  class: 'btn btn-sm',
                  onclick: () => {
                    commentBox.style.display = commentBox.style.display === 'none' ? 'flex' : 'none';
                    (commentBox.querySelector('textarea') as HTMLTextAreaElement | null)?.focus();
                  },
                },
                'Needs work',
              ),
            ),
        commentBox,
      );
    }),
  );
}

function detailView(s: DashStudent): HTMLElement {
  const d = details.get(s.relationship_id);
  if (!d || d.state === 'loading') return h('div', { class: 'loading', style: 'min-height:80px' }, h('div', { class: 'spinner' }));
  if (d.state === 'error') return h('div', { class: 'notice notice-danger' }, d.message);
  const o = d.detail.overview;
  const hw = o.homework;
  return h(
    'div',
    { class: 'stack' },
    o.needs_attention.length > 0 ? h('div', null, h('h3', { style: 'margin-bottom:0.4rem' }, 'Needs attention'), needsAttention(o, true)) : null,
    h(
      'div',
      null,
      h('h3', { style: 'margin-bottom:0.4rem' }, `Recordings ${d.detail.since_lesson ? 'since the last lesson' : 'in the last 2 weeks'}`),
      recordingsList(s, d.detail.recordings),
    ),
    hw.decks.length > 0 || hw.lessons.length > 0
      ? h(
          'div',
          null,
          h('h3', { style: 'margin-bottom:0.4rem' }, 'Homework'),
          ...hw.decks.map((deck) =>
            h(
              'div',
              { class: 'homework-deck' },
              h('div', { class: 'name' }, h('div', { class: 'ellipsis' }, deck.source_deck_name), h('div', { class: 'xs faint' }, `${deck.cards_mastered}/${deck.cards_total} mastered${deck.notes_missing > 0 ? ` · ${plural(deck.notes_missing, 'new word')} to send` : ''}`)),
              h('div', { class: 'bar bar-ok' }, h('span', { style: `width:${Math.round(deck.percent_started)}%` })),
              h('span', { class: 'xs muted nowrap' }, `${Math.round(deck.percent_started)}% started`),
            ),
          ),
          ...hw.lessons.map((l) =>
            h(
              'div',
              { class: 'homework-deck' },
              h('div', { class: 'name' }, h('div', { class: 'ellipsis' }, `${l.icon ?? '🎓'} ${l.title}`), h('div', { class: 'xs faint' }, l.completions > 0 ? `Done ${plural(l.completions, 'time')} · last ${RATING_LABEL[l.last_rating ?? 2]} ${timeAgo(l.last_completed_at)}` : `Assigned ${timeAgo(l.created_at)} · not done yet`)),
              h('span', { class: `pill ${l.completions > 0 ? 'pill-ok' : ''}` }, l.completions > 0 ? 'Done' : 'Pending'),
            ),
          ),
        )
      : null,
    o.activity.length > 0
      ? h(
          'div',
          null,
          h('h3', { style: 'margin-bottom:0.4rem' }, 'Recent days'),
          ...o.activity.map((a) => h('div', { class: 'small muted' }, `${shortDate(a.day)}: ${plural(a.reviews, 'card')}${a.accuracy !== null ? `, ${pct(a.accuracy)} right` : ''}${a.time_ms > 0 ? `, ${minutes(a.time_ms)}` : ''}`)),
        )
      : null,
  );
}

function expandStudent(relId: string): void {
  if (expanded.has(relId)) expanded.delete(relId);
  else {
    expanded.add(relId);
    void loadDetail(relId);
  }
  render();
}

function studentCard(s: DashStudent): HTMLElement {
  const open = expanded.has(s.relationship_id);
  return h(
    'div',
    { class: 'card student' },
    h(
      'button',
      { class: 'student-head', 'aria-expanded': String(open), onclick: () => expandStudent(s.relationship_id) },
      avatar(name(s), s.student.picture_url),
      h('div', { class: 'grow' }, h('div', { class: 'student-name ellipsis' }, name(s)), statusLine(s)),
      h('span', { class: `chev${open ? ' open' : ''}` }, '▼'),
    ),
    h(
      'div',
      { class: 'student-body' },
      s.is_new ? setupChecklist(s) : pills(s),
      !s.is_new && !open ? needsAttention(s, false) : null,
      open ? detailView(s) : null,
      quickActions(s),
    ),
  );
}

function invitesCard(): HTMLElement | null {
  if (!data || data.invites.length === 0) return null;
  return h(
    'div',
    { class: 'card' },
    h('h2', { style: 'margin-bottom:0.25rem' }, `Pending invites (${data.invites.length})`),
    ...data.invites.map((inv) =>
      h(
        'div',
        { class: 'invite' },
        h('div', { class: 'grow' }, h('div', { class: 'ellipsis' }, inv.email ?? 'Open link'), h('div', { class: 'xs muted' }, `${inv.opened_at ? 'Link opened · not signed in yet' : 'Not opened yet'} · sent ${timeAgo(inv.created_at)}${inv.share_deck_count > 0 ? ` · ${plural(inv.share_deck_count, 'deck')}` : ''}`)),
        h(
          'button',
          {
            class: 'btn btn-sm',
            onclick: (e) => {
              const btn = e.currentTarget as HTMLButtonElement;
              navigator.clipboard?.writeText(inv.url).then(
                () => {
                  btn.textContent = 'Copied';
                  setTimeout(() => (btn.textContent = 'Copy link'), 1500);
                },
                () => toast('Could not copy — open the link instead', 'danger'),
              );
            },
          },
          'Copy link',
        ),
        host.caps.links ? h('button', { class: 'btn btn-sm btn-ghost', onclick: () => void host.openLink(inv.url) }, 'Open') : null,
      ),
    ),
  );
}

function homeworkDecksCard(): HTMLElement | null {
  if (!data || data.homework_decks.length === 0) return null;
  return h(
    'div',
    { class: 'card' },
    h('h2', { style: 'margin-bottom:0.25rem' }, 'My homework decks'),
    ...data.homework_decks.map((d) =>
      h('div', { class: 'invite' }, h('div', { class: 'grow' }, h('div', { class: 'ellipsis' }, d.name), h('div', { class: 'xs muted' }, `${plural(d.note_count, 'word')} · sent to ${plural(d.student_count, 'student')} · last ${timeAgo(d.last_shared_at)}`))),
    ),
  );
}

function render(): void {
  if (!data) return;
  const refreshBtn: HTMLButtonElement = h('button', { class: 'btn btn-sm', onclick: () => busy(refreshBtn, refresh) }, '↻ Refresh');
  mount(
    root,
    h(
      'div',
      { class: 'header' },
      h('div', null, h('h1', null, 'Students'), h('div', { class: 'small muted' }, `${plural(data.students.length, 'student')} · updated ${timeAgo(data.generated_at)}`)),
      h('div', { class: 'actions' }, refreshBtn),
    ),
    data.students.length === 0
      ? h('div', { class: 'card empty' }, 'No active students yet. Invite one from the app, then come back here.')
      : h('div', null, ...data.students.map(studentCard)),
    h('div', { class: 'grid-2', style: 'margin-top:0.75rem' }, invitesCard(), homeworkDecksCard()),
  );
}
