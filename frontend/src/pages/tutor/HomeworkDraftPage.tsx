import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasFsrs, hasOneOff, type DraftPlan, type DraftPlanItem } from '@shared/homework';
import { assignHomeworkDraft, getHomeworkDraft, saveDraftPlan, sendDraftMessage, type DraftView, type DraftWord } from '../../api/homework';
import { cancelSessionNotesJob, retrySessionNotesJob } from '../../api/tutorNotes';
import { deleteNote } from '../../api/client';
import { LoadGauge } from '../../components/tutor/LoadGauge';
import { HomeworkModePicker } from '../../components/tutor/HomeworkModePicker';
import { useIsWide } from '../../components/editor/EditorShell';
import { Loading } from '../../components/Loading';
import { useNetwork } from '../../contexts/NetworkContext';
import { plural, shortDate } from '../../components/tutor/format';
import '../../components/tutor/tutor-dashboard.css';
import '../../components/tutor/session-notes.css';
import '../../components/tutor/homework-tutor.css';

const CHAT_SUGGESTIONS = ['Drop the words they already find easy', 'Split the words over two days', 'Add a short listening lesson', 'Make the example sentences simpler'];

function isWorking(view: DraftView | undefined): boolean {
  return !!view && (view.job.status === 'queued' || view.job.status === 'running');
}

/**
 * Review a homework DRAFT made from lesson notes (docs/HOMEWORK.md §4): the
 * student's load now and after, the words (the ones they already have are
 * skipped, with "include anyway"), each item's mode and due date, spreading
 * the words over days, a Claude chat that edits the same draft, then Assign.
 * Nothing reaches the student before Assign.
 */
export function HomeworkDraftPage() {
  const { relId, jobId } = useParams<{ relId: string; jobId: string }>();
  const queryClient = useQueryClient();
  const wide = useIsWide();
  const [tab, setTab] = useState<'draft' | 'claude'>('draft');
  const [error, setError] = useState<string | null>(null);
  const [assignedNote, setAssignedNote] = useState<string | null>(null);
  const key = ['homework-draft', relId, jobId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => getHomeworkDraft(relId!, jobId!),
    refetchInterval: (q) => (isWorking(q.state.data) ? 3000 : false),
  });
  const view = query.data;
  const setView = (v: DraftView) => queryClient.setQueryData(key, v);

  const planMutation = useMutation({
    mutationFn: (plan: DraftPlan) => saveDraftPlan(relId!, jobId!, plan),
    onSuccess: setView,
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not save the plan'),
  });
  const assign = useMutation({
    mutationFn: () => assignHomeworkDraft(relId!, jobId!),
    onSuccess: (r) => {
      const skipped = r.skipped.reduce((n, s) => n + s.hanzi.length, 0);
      setAssignedNote(`Assigned ${plural(r.assignments.length, 'item')}${skipped ? ` · left out ${plural(skipped, 'word')} they already have` : ''}${r.errors.length ? ` · ${r.errors.length} failed: ${r.errors[0].error}` : ''}.`);
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ['lesson-notes', relId] });
      queryClient.invalidateQueries({ queryKey: ['relationship-homework', relId] });
      queryClient.invalidateQueries({ queryKey: ['student-overview', relId] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not assign'),
  });
  const removeWord = useMutation({
    mutationFn: (w: DraftWord) => deleteNote(w.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not remove the word'),
  });

  if (query.isLoading) return <Loading />;
  if (query.isError || !view) return <div className="page"><div className="container"><div className="td-error">{query.error instanceof Error ? query.error.message : 'Draft not found'}</div></div></div>;

  const { job, plan } = view;
  const working = isWorking(view);
  const assigned = !!job.assigned_at;
  const locked = working || assigned;
  const update = (patch: Partial<DraftPlan>) => planMutation.mutate({ ...plan, ...patch });
  const updateItem = (k: string, patch: Partial<DraftPlanItem>) => update({ items: plan.items.map((i) => (i.key === k ? { ...i, ...patch } : i)) });
  const includeKnown = (hanzi: string, on: boolean) =>
    update({ include_known: on ? [...plan.include_known, hanzi] : plan.include_known.filter((h) => h !== hanzi) });
  const included = plan.items.filter((i) => i.include && (i.kind !== 'deck' || view.kept_count > 0));
  const studentName = view.student_name;

  const draftColumn = (
    <div className="hwt-draft-main">
      {working && (
        <div className="hwt-banner hwt-banner-working" role="status" data-testid="draft-working">
          <span className="sn-spinner" aria-hidden="true" /> {job.progress || 'The assistant is working on the draft…'}
          <ul className="hwt-banner-steps">{job.steps.slice(-3).map((s, i) => <li key={i}>{s.text}</li>)}</ul>
          <button type="button" className="btn-link sn-danger" onClick={() => void cancelSessionNotesJob(relId!, job.id).then(() => query.refetch())}>Cancel</button>
        </div>
      )}
      {job.status === 'failed' && (
        <div className="hwt-banner hwt-banner-failed">
          Failed: {job.error}
          <button type="button" className="btn btn-secondary sn-small" onClick={() => void retrySessionNotesJob(relId!, job.id).then(() => query.refetch())}>Retry</button>
        </div>
      )}
      {assigned && (
        <div className="hwt-banner hwt-banner-assigned" data-testid="draft-assigned">
          ✓ Assigned {shortDate(job.assigned_at)} · {plural(view.assignments.length, 'assignment')}. It reaches their homework list with their next sync.
        </div>
      )}
      {assignedNote && <div className="td-result" role="status">{assignedNote}</div>}
      {error && <div className="td-error" role="alert">{error}</div>}

      <LoadGauge load={view.load} after={assigned ? null : view.load_after} studentName={studentName} />

      {job.result.summary && !working && <p className="hwt-draft-summary">{job.result.summary}</p>}

      {plan.items.map((item) => {
        if (item.kind === 'deck') {
          const kept = view.words.filter((w) => !w.skipped);
          const skipped = view.words.filter((w) => w.skipped);
          const forced = view.words.filter((w) => w.known && !w.skipped);
          return (
            <section key={item.key} className="hwt-draft-card" data-testid="draft-words">
              <div className="hwt-draft-card-head">
                <label className="hwt-include">
                  <input type="checkbox" checked={item.include} disabled={locked} onChange={(e) => updateItem(item.key, { include: e.target.checked })} />
                  <strong>📚 Words ({kept.length})</strong>
                </label>
                <Link to={`/decks/${item.source_id}`} className="btn-link">Edit deck</Link>
              </div>
              <ul className="hwt-words">
                {kept.map((w) => (
                  <li key={w.id}>
                    <span className="hwt-word-hanzi" lang="zh">{w.hanzi}</span>
                    <span className="hwt-word-gloss">{w.pinyin} · {w.english}</span>
                    {forced.includes(w) && <span className="hwt-word-tag">they have it</span>}
                    {!locked && (
                      <button type="button" className="hwt-word-x" aria-label={`Remove ${w.hanzi}`} onClick={() => { if (window.confirm(`Remove ${w.hanzi} from the draft?`)) removeWord.mutate(w); }}>×</button>
                    )}
                  </li>
                ))}
              </ul>
              {skipped.length > 0 && (
                <details className="hwt-skipped" open data-testid="draft-skipped">
                  <summary>Skipped {plural(skipped.length, 'word')} {studentName} already has</summary>
                  <ul className="hwt-words">
                    {skipped.map((w) => (
                      <li key={w.id}>
                        <span className="hwt-word-hanzi" lang="zh">{w.hanzi}</span>
                        <span className="hwt-word-gloss">{w.known ? `in ${w.known.deck_name} · ${w.known.state}` : 'twice in the draft'}</span>
                        {w.known && !locked && (
                          <button type="button" className="btn-link" onClick={() => includeKnown(w.hanzi, true)}>Include anyway</button>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {forced.length > 0 && !locked && (
                <p className="hwt-muted">
                  Sending anyway: {forced.map((w) => w.hanzi).join('、')} ·{' '}
                  <button type="button" className="btn-link" onClick={() => update({ include_known: [] })}>skip them again</button>
                </p>
              )}
              {item.include && (
                <fieldset disabled={locked} className="hwt-fieldset">
                  <HomeworkModePicker
                    name="draft-deck"
                    mode={item.mode}
                    onMode={(mode) => updateItem(item.key, { mode })}
                    dueDate={item.due_date}
                    onDueDate={(due_date) => updateItem(item.key, { due_date })}
                    wordCount={kept.length}
                    splitDays={plan.split_days}
                    onSplitDays={(split_days) => update({ split_days })}
                  />
                  {hasFsrs(item.mode) && (
                    <label className="hwt-priority">
                      <span>Long-term copy goes to</span>
                      <select value={plan.priority} onChange={(e) => update({ priority: e.target.value as DraftPlan['priority'] })}>
                        <option value="core">the top of their queue</option>
                        <option value="non_urgent">the bottom of their queue</option>
                      </select>
                    </label>
                  )}
                </fieldset>
              )}
            </section>
          );
        }
        const lesson = item.kind === 'lesson' ? job.result.lessons?.find((l) => `lesson:${l.library_item_id}` === item.key) : null;
        return (
          <section key={item.key} className="hwt-draft-card" data-testid={`draft-${item.kind}`}>
            <div className="hwt-draft-card-head">
              <label className="hwt-include">
                <input type="checkbox" checked={item.include} disabled={locked} onChange={(e) => updateItem(item.key, { include: e.target.checked })} />
                <strong lang="zh">{item.kind === 'lesson' ? '🎓' : '📖'} {item.title}</strong>
              </label>
              <Link to={item.kind === 'lesson' ? `/library/${item.source_id}/edit` : `/readers/${item.source_id}/edit`} className="btn-link">Edit</Link>
            </div>
            {lesson && <p className="hwt-muted">Mini lesson · {plural(lesson.exercise_count, 'exercise')}</p>}
            {item.include && (
              <fieldset disabled={locked} className="hwt-fieldset">
                <HomeworkModePicker name={`draft-${item.key}`} mode={item.mode} onMode={(mode) => updateItem(item.key, { mode })} dueDate={item.due_date} onDueDate={(due_date) => updateItem(item.key, { due_date })} />
              </fieldset>
            )}
          </section>
        );
      })}
      {plan.items.length === 0 && !working && <p className="hwt-muted">This draft has nothing in it yet — ask Claude, or write the notes again.</p>}

      {!assigned && (
        <div className="hwt-assign-bar">
          <button type="button" className="btn btn-primary" disabled={locked || assign.isPending || included.length === 0} onClick={() => assign.mutate()} data-testid="draft-assign">
            {assign.isPending ? 'Assigning…' : `Assign ${plural(included.length, 'item')}`}
          </button>
          <span className="hwt-muted">
            {included.map((i) => (hasOneOff(i.mode) ? `${i.kind === 'deck' ? 'words' : i.kind}: one-off${i.mode === 'both' ? ' + long-term' : ''}` : `${i.kind === 'deck' ? 'words' : i.kind}: long-term`)).join(' · ')}
          </span>
        </div>
      )}
    </div>
  );

  const chat = <DraftChat relId={relId!} view={view} onSent={() => query.refetch()} />;

  return (
    <div className="page">
      <div className={`container hwt-draft${wide ? ' hwt-draft-wide' : ''}`}>
        <div className="td-topbar">
          <Link to={`/connections/${relId}`} className="back-link">‹ Student</Link>
        </div>
        <h1 className="hwt-draft-title">Homework draft</h1>
        <p className="hwt-muted">
          <span lang="zh">{job.title || job.result.deck?.name || 'Lesson notes'}</span>
          {job.lesson_at ? ` · lesson ${shortDate(job.lesson_at)}` : ''} · nothing is sent until you assign it
        </p>
        {!wide && (
          <div className="td-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'draft'} className={`td-tab ${tab === 'draft' ? 'active' : ''}`} onClick={() => setTab('draft')}>Draft</button>
            <button type="button" role="tab" aria-selected={tab === 'claude'} className={`td-tab ${tab === 'claude' ? 'active' : ''}`} onClick={() => setTab('claude')} data-testid="draft-claude-tab">
              ✨ Claude{job.chat.length > 1 ? ` (${job.chat.length})` : ''}
            </button>
          </div>
        )}
        {wide ? (
          <div className="hwt-draft-columns">
            {draftColumn}
            <aside className="hwt-draft-chat-col">{chat}</aside>
          </div>
        ) : tab === 'draft' ? draftColumn : chat}
      </div>
    </div>
  );
}

function DraftChat({ relId, view, onSent }: { relId: string; view: DraftView; onSent: () => void }) {
  const { isOnline } = useNetwork();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const working = isWorking(view);
  const assigned = !!view.job.assigned_at;
  const send = useMutation({
    mutationFn: (message: string) => sendDraftMessage(relId, view.job.id, message),
    onSuccess: () => {
      setText('');
      setError(null);
      onSent();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not send'),
  });
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [view.job.chat.length, working]);
  const disabled = working || assigned || send.isPending || !isOnline;
  return (
    <div className="hwt-chat" data-testid="draft-chat">
      <div className="hwt-chat-head">✨ Ask Claude to change the draft</div>
      <div className="hwt-chat-list" ref={listRef}>
        {view.job.chat.length === 0 && <p className="hwt-muted">Claude made this draft from your notes. Ask for changes in plain words.</p>}
        {view.job.chat.map((m, i) => (
          <div key={i} className={`hwt-msg hwt-msg-${m.role}`}>{m.text}</div>
        ))}
        {working && <div className="hwt-msg hwt-msg-assistant hwt-msg-working"><span className="sn-spinner" aria-hidden="true" /> {view.job.progress || 'Working…'}</div>}
      </div>
      {!assigned && (
        <>
          <div className="hwt-chat-chips">
            {CHAT_SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="hwt-chip" disabled={disabled} onClick={() => send.mutate(s)}>{s}</button>
            ))}
          </div>
          <form
            className="hwt-chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim() && !disabled) send.mutate(text.trim());
            }}
          >
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="e.g. drop the food words, split into two days, add a listening lesson" disabled={disabled} data-testid="draft-chat-input" />
            <button type="submit" className="btn btn-primary" disabled={disabled || !text.trim()}>Send</button>
          </form>
        </>
      )}
      {error && <div className="td-error" role="alert">{error}</div>}
    </div>
  );
}
