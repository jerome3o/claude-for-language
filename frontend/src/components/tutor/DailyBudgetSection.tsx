import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { budgetFinishHint, budgetSummary, DEFAULT_STUDY_BUDGET, firstName, shortDay, type StudyBudget, type StudyBudgetInfo } from '@shared/decks';
import { getStudentStudyBudget, setStudentStudyBudget, type StudentStudyBudget } from '../../api/client';
import { BudgetStepper } from '../BudgetStepper';
import { track } from '../../services/analytics';
import './tutor-dashboard.css';
import './daily-budget.css';

/**
 * "Daily new cards" on the tutor's student page: the student's ONE daily budget
 * (shared/decks/budget.ts — N new words + M extra cards a day, filled from their
 * deck queue) with Edit → a sheet with the two steppers, Reset to default and a
 * live "At 5 a day, <deck> finishes in ~9 days". Saving posts a chat message from
 * the tutor; the student can still change it in their Settings (last write wins).
 */
export function DailyBudgetSection({ relId, studentName, initial }: { relId: string; studentName: string; initial?: StudyBudgetInfo }) {
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
        {budget && !budget.is_default && who && (
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
  budget: StudyBudget;
  topDeck: StudentStudyBudget['top_deck'];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [primary, setPrimary] = useState(budget.new_cards_per_day);
  const [secondary, setSecondary] = useState(budget.secondary_cards_per_day);
  const [error, setError] = useState<string | null>(null);
  const name = firstName(studentName);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = useMutation({
    mutationFn: (update: { new_cards_per_day: number | null; secondary_cards_per_day: number | null }) => setStudentStudyBudget(relId, update),
    onSuccess: (res, update) => {
      track('tutor.budget_change', { new_cards: update.new_cards_per_day, secondary_cards: update.secondary_cards_per_day, reset: update.new_cards_per_day === null && update.secondary_cards_per_day === null });
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
  const dirty = primary !== budget.new_cards_per_day || secondary !== budget.secondary_cards_per_day;

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
            save.mutate({ new_cards_per_day: primary, secondary_cards_per_day: secondary });
          }}
        >
          <p className="db-lead">
            One budget for all of {name}'s decks, filled from the top of their deck list down. Send as much homework as you like — this decides the daily load.
          </p>
          <BudgetStepper tone="primary" label="New words a day" hint="Words they have never seen" value={primary} onChange={setPrimary} disabled={save.isPending} testId="tutor-budget-primary" />
          <BudgetStepper tone="secondary" label="Extra cards a day" hint="Other card types of words already started" value={secondary} onChange={setSecondary} disabled={save.isPending} testId="tutor-budget-secondary" />
          {hint && <p className="db-hint" data-testid="daily-budget-hint">{hint}</p>}
          <p className="db-muted db-small">{name} gets a chat message from you, and can still change it in their Settings.</p>
          {error && <div className="td-error" role="alert">{error}</div>}
          <div className="db-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={save.isPending || (isDefault && (budget as StudyBudgetInfo).is_default)}
              onClick={() => {
                setError(null);
                setPrimary(DEFAULT_STUDY_BUDGET.new_cards_per_day);
                setSecondary(DEFAULT_STUDY_BUDGET.secondary_cards_per_day);
                save.mutate({ new_cards_per_day: null, secondary_cards_per_day: null });
              }}
              data-testid="daily-budget-reset"
            >
              Reset to default ({DEFAULT_STUDY_BUDGET.new_cards_per_day} + {DEFAULT_STUDY_BUDGET.secondary_cards_per_day})
            </button>
            <button type="submit" className="btn btn-primary" disabled={save.isPending || !dirty} data-testid="daily-budget-save">
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
