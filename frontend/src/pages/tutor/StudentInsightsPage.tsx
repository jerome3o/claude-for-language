/**
 * Student Insights — the tutor's one-page briefing before a lesson: what the
 * student did since the last lesson, which words need attention (with the
 * wrong characters they typed), what is going well, an AI narrative, and the
 * lesson log that anchors the default range.
 */

import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getStudentInsights,
  getLessonLog,
  logLesson,
  deleteLessonLogEntry,
  getStudentSummaries,
  writeStudentSummary,
} from '../../api/insights';
import type { InsightsReport, StrugglingNote, GoingWellNote, StudentSummary, TutorLessonLogEntry } from '../../types/insights';
import { Loading } from '../../components/Loading';
import {
  TutorPageFrame,
  TutorPageNav,
  RatingDot,
  CardTypeChip,
  RecordingButton,
  AnswerDiff,
  formatDuration,
  formatDay,
  formatDateTime,
  formatSeconds,
  toDateInputValue,
} from './tutor-shared';

type Preset = 'lesson' | '7d' | '14d' | '30d' | 'custom';

interface RangeSelection {
  preset: Preset;
  from?: string; // YYYY-MM-DD for custom
  to?: string;
}

function presetToQuery(sel: RangeSelection): { from?: string; to?: string } {
  const today = new Date();
  const daysAgo = (n: number) => toDateInputValue(new Date(today.getTime() - n * 86_400_000));
  switch (sel.preset) {
    case 'lesson':
      return {};
    case '7d':
      return { from: daysAgo(7) };
    case '14d':
      return { from: daysAgo(14) };
    case '30d':
      return { from: daysAgo(30) };
    case 'custom':
      return { from: sel.from || daysAgo(14), to: sel.to || toDateInputValue(today) };
  }
}

export function StudentInsightsPage() {
  const { relId } = useParams<{ relId: string }>();
  return (
    <TutorPageFrame relId={relId!} title="Insights">
      {(student) => <InsightsBody relId={relId!} studentName={student.name || student.email || 'Student'} />}
    </TutorPageFrame>
  );
}

function InsightsBody({ relId, studentName }: { relId: string; studentName: string }) {
  const queryClient = useQueryClient();

  const lessonLogQuery = useQuery({
    queryKey: ['lessonLog', relId],
    queryFn: () => getLessonLog(relId),
  });
  const hasLesson = (lessonLogQuery.data?.length ?? 0) > 0;

  const [range, setRange] = useState<RangeSelection>({ preset: 'lesson' });
  // "Since last lesson" only makes sense once a lesson exists; before that the
  // server falls back to 14 days, so the chips should say so.
  const effectivePreset: Preset = range.preset === 'lesson' && lessonLogQuery.isSuccess && !hasLesson ? '14d' : range.preset;
  const query = useMemo(() => presetToQuery({ ...range, preset: effectivePreset }), [range, effectivePreset]);

  const insightsQuery = useQuery({
    queryKey: ['studentInsights', relId, query],
    queryFn: () => getStudentInsights(relId, query),
    enabled: lessonLogQuery.isSuccess || lessonLogQuery.isError,
  });

  const latestLesson = lessonLogQuery.data?.[0] ?? null;

  return (
    <>
      <TutorPageNav relId={relId} current="insights" />

      <RangeControl
        selection={{ ...range, preset: effectivePreset }}
        onChange={setRange}
        latestLessonAt={latestLesson?.lesson_at ?? null}
        actualRange={insightsQuery.data?.range ?? null}
      />

      {insightsQuery.isLoading && <Loading message="Crunching the numbers..." />}
      {insightsQuery.error && (
        <div className="tutor-error">
          {insightsQuery.error instanceof Error ? insightsQuery.error.message : 'Failed to load insights'}
        </div>
      )}

      {insightsQuery.data && (
        <>
          <StatTiles report={insightsQuery.data} />
          <NeedsAttention items={insightsQuery.data.struggling} />
          <GoingWell items={insightsQuery.data.going_well} />
          <AlsoThisPeriod report={insightsQuery.data} />
          <SummaryCard relId={relId} range={insightsQuery.data.range} hasActivity={insightsQuery.data.totals.reviews > 0} />
        </>
      )}

      <LessonsCard
        relId={relId}
        studentName={studentName}
        entries={lessonLogQuery.data ?? []}
        loading={lessonLogQuery.isLoading}
        onChanged={() => {
          queryClient.invalidateQueries({ queryKey: ['lessonLog', relId] });
          queryClient.invalidateQueries({ queryKey: ['studentInsights', relId] });
        }}
      />
    </>
  );
}

// ---------- Range control ----------

function RangeControl({
  selection,
  onChange,
  latestLessonAt,
  actualRange,
}: {
  selection: RangeSelection;
  onChange: (s: RangeSelection) => void;
  latestLessonAt: string | null;
  actualRange: { from: string; to: string } | null;
}) {
  const chips: Array<{ key: Preset; label: string; disabled?: boolean }> = [
    { key: 'lesson', label: latestLessonAt ? `Since last lesson (${formatDay(latestLessonAt)})` : 'Since last lesson', disabled: !latestLessonAt },
    { key: '7d', label: '7d' },
    { key: '14d', label: '14d' },
    { key: '30d', label: '30d' },
    { key: 'custom', label: 'Custom' },
  ];
  const today = toDateInputValue(new Date());
  return (
    <div className="tutor-range" role="group" aria-label="Time range">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          className={`tutor-range-chip ${selection.preset === c.key ? 'active' : ''}`}
          disabled={c.disabled}
          title={c.disabled ? 'Log a lesson below to enable this' : undefined}
          onClick={() =>
            onChange(
              c.key === 'custom'
                ? { preset: 'custom', from: selection.from || toDateInputValue(new Date(Date.now() - 14 * 86_400_000)), to: selection.to || today }
                : { preset: c.key }
            )
          }
        >
          {c.label}
        </button>
      ))}
      {selection.preset === 'custom' && (
        <div className="tutor-range-custom">
          <input
            type="date"
            value={selection.from || ''}
            max={selection.to || today}
            onChange={(e) => onChange({ ...selection, from: e.target.value })}
            aria-label="From"
          />
          <span>to</span>
          <input
            type="date"
            value={selection.to || ''}
            min={selection.from || undefined}
            max={today}
            onChange={(e) => onChange({ ...selection, to: e.target.value })}
            aria-label="To"
          />
        </div>
      )}
      {actualRange && (
        <div className="tutor-range-note">
          Showing {formatDateTime(actualRange.from)} → {formatDateTime(actualRange.to)}
        </div>
      )}
    </div>
  );
}

// ---------- Stat tiles ----------

function StatTiles({ report }: { report: InsightsReport }) {
  const t = report.totals;
  const days = Math.max(1, Math.round((new Date(report.range.to).getTime() - new Date(report.range.from).getTime()) / 86_400_000));
  return (
    <div className="tutor-tiles">
      <div className="tutor-tile">
        <div className="tutor-tile-value">{t.reviews}</div>
        <div className="tutor-tile-label">Attempts</div>
        <div className="tutor-tile-sub">{t.unique_notes} words</div>
      </div>
      <div className="tutor-tile">
        <div className="tutor-tile-value">{t.days_active}</div>
        <div className="tutor-tile-label">Days active</div>
        <div className="tutor-tile-sub">of {days}</div>
      </div>
      <div className="tutor-tile">
        <div className="tutor-tile-value">{t.reviews ? `${Math.round(t.accuracy * 100)}%` : '–'}</div>
        <div className="tutor-tile-label">Accuracy</div>
        <div className="tutor-tile-sub">{t.reviews ? `${Math.round(t.again_rate * 100)}% forgot` : ''}</div>
      </div>
      <div className="tutor-tile">
        <div className="tutor-tile-value">{formatDuration(t.time_ms)}</div>
        <div className="tutor-tile-label">Study time</div>
      </div>
      <div className="tutor-tile">
        <div className="tutor-tile-value">{t.new_words_introduced}</div>
        <div className="tutor-tile-label">New words</div>
        <div className="tutor-tile-sub">started</div>
      </div>
    </div>
  );
}

// ---------- Needs attention ----------

function NeedsAttention({ items }: { items: StrugglingNote[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, 10);
  return (
    <section className="tutor-section">
      <div className="tutor-section-title">
        <span>Needs attention</span>
        <span className="tutor-section-hint">{items.length ? `${items.length} words` : ''}</span>
      </div>
      {items.length === 0 ? (
        <div className="tutor-card tutor-empty">Nothing forgotten or mistyped in this period. 🎉</div>
      ) : (
        <div className="tutor-word-list">
          {visible.map((s) => {
            const isOpen = open === s.note.id;
            return (
              <div
                key={s.note.id}
                className="tutor-word-row clickable"
                onClick={() => setOpen(isOpen ? null : s.note.id)}
                role="button"
                aria-expanded={isOpen}
              >
                <div className="tutor-word-main">
                  <span className="tutor-word-hanzi">{s.note.hanzi}</span>
                  <div className="tutor-word-meta">
                    <span className="tutor-word-pinyin">{s.note.pinyin}</span>
                    <span className="tutor-word-english">{s.note.english}</span>
                  </div>
                  <div className="tutor-word-right">
                    {s.recordings_count > 0 && <span className="tutor-pill tutor-pill-neutral">🎤 {s.recordings_count}</span>}
                    <span className={`tutor-pill ${s.again_rate >= 0.5 ? 'tutor-pill-again' : s.again_count > 0 ? 'tutor-pill-hard' : 'tutor-pill-neutral'}`}>
                      {s.again_count > 0 ? `forgot ${s.again_count}/${s.attempts}` : s.hard_count > 0 ? `hard ${s.hard_count}/${s.attempts}` : `${s.attempts} tries`}
                    </span>
                  </div>
                </div>
                {(s.wrong_answers.length > 0 || s.forgot_count > 0) && (
                  <div className="tutor-word-details">
                    {s.wrong_answers.map((a) => (
                      <span key={a} className="tutor-chip tutor-chip-wrong" title="Typed this instead">{a}</span>
                    ))}
                    {s.forgot_count > 0 && (
                      <span className="tutor-chip" title="Got it right, then forgot it again">knew it, then forgot ×{s.forgot_count}</span>
                    )}
                  </div>
                )}
                {isOpen && (
                  <div className="tutor-attempts" onClick={(e) => e.stopPropagation()}>
                    <div className="tutor-word-deck">
                      {s.note.deck_name}
                      {s.avg_time_ms ? ` · avg ${formatSeconds(s.avg_time_ms)} per attempt` : ''}
                    </div>
                    {s.events.map((ev) => (
                      <div key={ev.event_id} className="tutor-attempt">
                        <span className="tutor-attempt-time">{formatDateTime(ev.reviewed_at)}</span>
                        <CardTypeChip cardType={ev.card_type} />
                        <RatingDot rating={ev.rating} withLabel />
                        {ev.user_answer && <AnswerDiff userAnswer={ev.user_answer} correctAnswer={s.note.hanzi} />}
                        <span className="tutor-attempt-right">
                          <span className="tutor-attempt-secs">{formatSeconds(ev.time_spent_ms)}</span>
                          {ev.recording_url && <RecordingButton url={ev.recording_url} compact />}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {items.length > 10 && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer' : `Show all ${items.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ---------- Going well ----------

function GoingWell({ items }: { items: GoingWellNote[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, 8);
  return (
    <section className="tutor-section">
      <div className="tutor-section-title">
        <span>Going well</span>
        <span className="tutor-section-hint">{items.length ? `${items.length} words` : ''}</span>
      </div>
      {items.length === 0 ? (
        <div className="tutor-card tutor-empty">No word has two or more correct attempts yet in this period.</div>
      ) : (
        <div className="tutor-word-list">
          {visible.map((g) => (
            <div key={g.note.id} className="tutor-word-row">
              <div className="tutor-word-main">
                <span className="tutor-word-hanzi">{g.note.hanzi}</span>
                <div className="tutor-word-meta">
                  <span className="tutor-word-pinyin">{g.note.pinyin}</span>
                  <span className="tutor-word-english">{g.note.english}</span>
                </div>
                <div className="tutor-word-right">
                  <span className="tutor-pill tutor-pill-good">
                    {g.reason === 'consistent' ? `${g.attempts}/${g.attempts} right` : `due in ${g.max_interval_days}d`}
                  </span>
                </div>
              </div>
            </div>
          ))}
          {items.length > 8 && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAll(!showAll)}>
              {showAll ? 'Show fewer' : `Show all ${items.length}`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ---------- Also this period ----------

function AlsoThisPeriod({ report }: { report: InsightsReport }) {
  const { lessons, readers, quests } = report.activity;
  const recordings = report.recordings.length;
  const total = lessons.length + readers.length + quests.length;
  return (
    <section className="tutor-section">
      <div className="tutor-section-title">
        <span>Also this period</span>
      </div>
      <div className="tutor-card">
        {total === 0 && recordings === 0 ? (
          <div className="tutor-empty">No mini lessons, readers or quests completed.</div>
        ) : (
          <div className="tutor-activity">
            {recordings > 0 && (
              <div className="tutor-activity-row">
                <span>🎤 {recordings} pronunciation recording{recordings === 1 ? '' : 's'}</span>
              </div>
            )}
            {lessons.map((l, i) => (
              <div key={`${l.lesson_id}-${i}`} className="tutor-activity-row">
                <span>📘 Mini lesson: {l.title}</span>
                {l.rating != null && <RatingDot rating={l.rating} withLabel />}
                <span className="tutor-activity-date">{formatDay(l.completed_at)}</span>
              </div>
            ))}
            {readers.map((r, i) => (
              <div key={`${r.reader_id}-${i}`} className="tutor-activity-row">
                <span>📖 Reader: {r.title_chinese} <span className="tutor-word-english">{r.title_english}</span></span>
                <RatingDot rating={r.rating} withLabel />
                <span className="tutor-activity-date">{formatDay(r.reviewed_at)}</span>
              </div>
            ))}
            {quests.map((q) => (
              <div key={q.quest_id} className="tutor-activity-row">
                <span>🗺️ Quest: {q.title}{q.best_moves != null ? ` (${q.best_moves} moves)` : ''}</span>
                <span className="tutor-activity-date">{formatDay(q.completed_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------- Summary ----------

function SummaryCard({ relId, range, hasActivity }: { relId: string; range: { from: string; to: string }; hasActivity: boolean }) {
  const queryClient = useQueryClient();
  const [lang, setLang] = useState<'en' | 'zh'>('en');
  const [latest, setLatest] = useState<StudentSummary | null>(null);

  const summariesQuery = useQuery({
    queryKey: ['studentSummaries', relId],
    queryFn: () => getStudentSummaries(relId),
  });

  const writeMutation = useMutation({
    mutationFn: () => writeStudentSummary(relId, range),
    onSuccess: (s) => {
      setLatest(s);
      queryClient.invalidateQueries({ queryKey: ['studentSummaries', relId] });
    },
  });

  const shown = latest ?? summariesQuery.data?.[0] ?? null;
  const previous = (summariesQuery.data ?? []).filter((s) => s.id !== shown?.id);

  return (
    <section className="tutor-section">
      <div className="tutor-section-title">
        <span>Summary</span>
        <span className="tutor-section-hint">written by Claude from the numbers above</span>
      </div>
      <div className="tutor-card">
        <div className="tutor-summary-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => writeMutation.mutate()}
            disabled={writeMutation.isPending || !hasActivity}
            title={hasActivity ? undefined : 'No study activity in this period'}
          >
            {writeMutation.isPending ? 'Writing…' : shown ? 'Write a new summary' : 'Write summary'}
          </button>
          {shown && (
            <div className="tutor-lang-toggle" role="group" aria-label="Language">
              <button type="button" className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>EN</button>
              <button type="button" className={lang === 'zh' ? 'active' : ''} onClick={() => setLang('zh')}>中文</button>
            </div>
          )}
        </div>

        {writeMutation.isPending && (
          <div className="tutor-summary-writing">
            <div className="spinner" />
            <span>Reading the period and writing notes — about ten seconds…</span>
          </div>
        )}
        {writeMutation.error && (
          <div className="tutor-error">{writeMutation.error instanceof Error ? writeMutation.error.message : 'Failed to write summary'}</div>
        )}

        {shown ? (
          <>
            <div className={`tutor-narrative ${lang}`}>{lang === 'en' ? shown.narrative_en : shown.narrative_zh}</div>
            <div className="tutor-summary-meta">
              Covers {formatDay(shown.range_from)} → {formatDay(shown.range_to)} · written {formatDateTime(shown.created_at)}
            </div>
          </>
        ) : (
          !writeMutation.isPending && (
            <div className="tutor-empty">
              No summary yet. Tap <strong>Write summary</strong> for a short narrative in English and 中文 covering the selected period.
            </div>
          )
        )}

        {previous.length > 0 && (
          <details className="tutor-collapsible">
            <summary>Previous summaries ({previous.length})</summary>
            {previous.map((s) => (
              <div key={s.id} className="tutor-past-summary">
                <div className="tutor-summary-meta" style={{ marginTop: 0, marginBottom: '0.375rem' }}>
                  {formatDay(s.range_from)} → {formatDay(s.range_to)} · {formatDateTime(s.created_at)}
                </div>
                <div className={`tutor-narrative ${lang}`}>{lang === 'en' ? s.narrative_en : s.narrative_zh}</div>
              </div>
            ))}
          </details>
        )}
      </div>
    </section>
  );
}

// ---------- Lesson log ----------

function LessonsCard({
  relId,
  studentName,
  entries,
  loading,
  onChanged,
}: {
  relId: string;
  studentName: string;
  entries: TutorLessonLogEntry[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState(toDateInputValue(new Date()));
  const [notes, setNotes] = useState('');

  const createMutation = useMutation({
    mutationFn: () => logLesson(relId, { lesson_at: date, notes: notes.trim() || undefined }),
    onSuccess: () => {
      setNotes('');
      setDate(toDateInputValue(new Date()));
      setShowForm(false);
      onChanged();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteLessonLogEntry(relId, id),
    onSuccess: onChanged,
  });

  return (
    <section className="tutor-section">
      <div className="tutor-section-title">
        <span>Lessons</span>
        <span className="tutor-section-hint">sets the "since last lesson" range</span>
      </div>
      <div className="tutor-card">
        {!showForm ? (
          <button type="button" className="btn btn-secondary" onClick={() => setShowForm(true)} style={{ marginBottom: entries.length ? '0.75rem' : 0 }}>
            + Log a lesson
          </button>
        ) : (
          <form
            className="tutor-lesson-form"
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate();
            }}
          >
            <label className="tutor-lesson-form-row">
              <span>Date</span>
              <input type="date" value={date} max={toDateInputValue(new Date())} onChange={(e) => setDate(e.target.value)} required />
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={`Notes for ${studentName} (optional) — vocab covered, homework, things to practise. They appear in the student's Lesson Notes and feed the daily reader.`}
            />
            {createMutation.error && (
              <div className="tutor-error">{createMutation.error instanceof Error ? createMutation.error.message : 'Failed to log lesson'}</div>
            )}
            <div className="tutor-lesson-form-row">
              <button type="submit" className="btn btn-primary" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Saving…' : 'Save lesson'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        )}

        {loading ? (
          <Loading message="Loading lessons..." />
        ) : entries.length === 0 ? (
          <div className="tutor-empty">No lessons logged yet. Log one after each lesson so Insights defaults to "since last lesson".</div>
        ) : (
          <div className="tutor-lesson-list">
            {entries.map((e) => (
              <div key={e.id} className="tutor-lesson-item">
                <span className="tutor-lesson-date">{formatDay(e.lesson_at)}</span>
                <span className="tutor-lesson-notes">{e.notes || <em>No notes</em>}</span>
                <button
                  type="button"
                  className="tutor-icon-btn"
                  aria-label="Delete lesson"
                  title="Delete"
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    if (confirm(`Delete the lesson on ${formatDay(e.lesson_at)}?`)) deleteMutation.mutate(e.id);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
