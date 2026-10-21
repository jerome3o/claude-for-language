import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { budgetFinishHint, budgetSummary, DEFAULT_STUDY_BUDGET, firstName, reviewLoadCapSummary, shortDay, tutorPausedLabel, type ReviewLoadState, type StudyBudget, type StudyBudgetInfo } from '@shared/decks';
import { ReviewLoadCapField, reviewLoadCapValid } from '../ReviewLoadCapField';
import { getStudentStudyBudget, setStudentStudyBudget, type StudentStudyBudget } from '../../api/client';
import { BudgetStepper } from '../BudgetStepper';
import { track } from '../../services/analytics';
import './tutor-dashboard.css';
import './daily-budget.css';

/**
 * "Daily new cards" on the tutor's student page: the student's ONE daily budget
 * (shared/decks/budget.ts — N new words + M extra cards a day, filled from their
 * deck queue) with Edit → a sheet with the two steppers, Reset to default and a
 * live "At 5 a day, <deck> finishes in ~9 days", and "Pause new cards on heavy days"
 * (shared/decks/review-load.ts). Saving new numbers posts a chat message from the
 * tutor (the pause alone posts nothing); the student can still change it in their
 * Settings (last write wins). `reviewLoad`: today's state from the overview — the row
 * says "⏸ New cards paused today · 124 reviews due" while it holds.
 */
export function DailyBudgetSection({ relId, studentName, initial, reviewLoad }: { relId: string; studentName: string; initial?: StudyBudgetInfo; reviewLoad?: ReviewLoadState | null }) {
  const [editing, setEditing] = useState(false);
  const query = useQuery({
    queryKey: ['student-study-budget', relId],
    queryFn: () => getStudentStudyBudget(relId),
    staleTime: 60_000,
  });
  const budget = query.data?.budget ?? initial;
  const who = budget?.set_by_tutor ? 'you' : budget?.set_by_id ? firstName(studentName) : null;
  const when = budget?.set_at ? shortDay(budget.set_at, new Date(budget.set_at).getTimezoneOffset()) : null;

  return (
    <div className="db-row" data-testid="daily-budget-row">
      <div className="db-text">
        <span className="db-title">Daily new cards</span>
        {budget ? (
          <span className="db-value" data-testid="daily-budget-value">
            {budgetSummary(budget)}
            {budget.is_default && <span className="db-muted"> · default</span>}
          </span>
        ) : (
          <span className="db-muted">{query.isError ? 'Could not load' : 'Loading…'}</span>
        )}
        {budget && reviewLoadCapSummary(budget.pause_new_when_reviews_over) && (
          <span className="db-muted db-small" data-testid="daily-budget-cap">{reviewLoadCapSummary(budget.pause_new_when_reviews_over)}</span>
        )}
        {tutorPausedLabel(reviewLoad) && (
          <span className="db-paused" data-testid="daily-budget-paused">{tutorPausedLabel(reviewLoad)}</span>
        )}
        {budget && (!budget.is_default || budget.pause_new_when_reviews_over != null) && who && (
          <span className="db-muted db-small">Set by {who}{when ? ` · ${when}` : ''}</span>
        )}
      </div>
      <button type="button" className="btn btn-secondary btn-sm db-edit" onClick={() => setEditing(true)} disabled={!budget} data-testid="daily-budget-edit">
        Edit
      </button>
      {editing && budget && (
        <DailyBudgetSheet
          relId={relId}
          studentName={studentName}
          budget={budget}
          topDeck={query.data?.top_deck ?? null}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

export function DailyBudgetSheet({ relId, studentName, budget, topDeck, onClose }: {
  relId: string;
  studentName: string;
  budget: StudyBudget & { pause_new_when_reviews_over?: number | null };
  topDeck: StudentStudyBudget['top_deck'];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [primary, setPrimary] = useState(budget.new_cards_per_day);
  const [secondary, setSecondary] = useState(budget.secondary_cards_per_day);
  const initialCap = budget.pause_new_when_reviews_over ?? null;
  const [cap, setCap] = useState<number | null>(initialCap);
  const [error, setError] = useState<string | null>(null);
  const name = firstName(studentName);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = useMutation({
    mutationFn: (update: { new_cards_per_day?: number | null; secondary_cards_per_day?: number | null; pause_new_when_reviews_over?: number | null }) => setStudentStudyBudget(relId, update),
    onSuccess: (res, update) => {
      track('tutor.budget_change', {
        ...(update.new_cards_per_day !== undefined ? { new_cards: update.new_cards_per_day, secondary_cards: update.secondary_cards_per_day } : {}),
        reset: update.new_cards_per_day === null && update.secondary_cards_per_day === null,
        ...(update.pause_new_when_reviews_over !== undefined ? { pause_over: update.pause_new_when_reviews_over ?? 'off' } : {}),
      });
      queryClient.setQueryData<StudentStudyBudget>(['student-study-budget', relId], (old) => (old ? { ...old, budget: res.budget } : old));
      queryClient.invalidateQueries({ queryKey: ['student-study-budget', relId] });
      queryClient.invalidateQueries({ queryKey: ['student-overview', relId] });
      queryClient.invalidateQueries({ queryKey: ['tutor-dashboard'] });
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save'),
  });

  const hint = budgetFinishHint(primary, topDeck?.name, topDeck?.words_to_go);
  const isDefault = primary === DEFAULT_STUDY_BUDGET.new_cards_per_day && secondary === DEFAULT_STUDY_BUDGET.secondary_cards_per_day;
  const capChanged = cap !== initialCap;
  const numbersDirty = primary !== budget.new_cards_per_day || secondary !== budget.secondary_cards_per_day;
  const dirty = numbersDirty || capChanged;
  const capPart = capChanged ? { pause_new_when_reviews_over: cap } : {};

  return (
    <div className="td-sheet-backdrop" onClick={onClose} role="presentation">
      <div className="td-sheet db-sheet" role="dialog" aria-modal="true" aria-labelledby="db-sheet-title" onClick={(e) => e.stopPropagation()} data-testid="daily-budget-sheet">
        <div className="td-sheet-head">
          <h2 id="db-sheet-title">Daily new cards · {name}</h2>
          <button type="button" className="td-sheet-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form
          className="td-sheet-body"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            // Only what changed: a pause-only change leaves the numbers (and their default) alone.
            save.mutate({ ...(numbersDirty ? { new_cards_per_day: primary, secondary_cards_per_day: secondary } : {}), ...capPart });
          }}
        >
          <p className="db-lead">
            One budget for all of {name}'s decks, filled from the top of their deck list down. Send as much homework as you like — this decides the daily load.
          </p>
          <BudgetStepper tone="primary" label="New words a day" hint="Words they have never seen" value={primary} onChange={setPrimary} disabled={save.isPending} testId="tutor-budget-primary" />
          <BudgetStepper tone="secondary" label="Extra cards a day" hint="Other card types of words already started" value={secondary} onChange={setSecondary} disabled={save.isPending} testId="tutor-budget-secondary" />
          {hint && <p className="db-hint" data-testid="daily-budget-hint">{hint}</p>}
          <ReviewLoadCapField
            value={cap}
            onChange={setCap}
            disabled={save.isPending}
            testId="tutor-review-cap"
            hint={`On a day with more reviews due than this, ${name} gets no new cards — Up next waits too — just the reviews. ⚡ bumps and homework still come.`}
          />
          <p className="db-muted db-small">{name} gets a chat message from you when the numbers change, and can still change it in their Settings.</p>
          {error && <div className="td-error" role="alert">{error}</div>}
          <div className="db-actions sheet-footer">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={save.isPending || (isDefault && (budget as StudyBudgetInfo).is_default)}
              onClick={() => {
                setError(null);
                setPrimary(DEFAULT_STUDY_BUDGET.new_cards_per_day);
                setSecondary(DEFAULT_STUDY_BUDGET.secondary_cards_per_day);
                save.mutate({ new_cards_per_day: null, secondary_cards_per_day: null, ...capPart });
              }}
              data-testid="daily-budget-reset"
            >
              Reset to default ({DEFAULT_STUDY_BUDGET.new_cards_per_day} + {DEFAULT_STUDY_BUDGET.secondary_cards_per_day})
            </button>
            <button type="submit" className="btn btn-primary" disabled={save.isPending || !dirty || !reviewLoadCapValid(cap)} data-testid="daily-budget-save">
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
