import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { compareDue, dueLabel, shortDay, type HomeworkAssignment } from '@shared/homework';
import { getRelationshipHomework, updateHomeworkAssignment } from '../../api/homework';
import { DueChip } from '../homework/HomeworkRow';
import { LoadGauge } from './LoadGauge';
import { KIND_ICON } from '../../services/homework';
import './homework-tutor.css';

const DONE_SHOWN = 5;

function progressText(a: HomeworkAssignment): string {
  if (a.status === 'done') return a.kind === 'deck' ? `all ${a.item_count} words` : 'done';
  if (a.kind !== 'deck') return a.done_count > 0 ? 'done' : 'not started';
  return a.done_count === 0 ? `${a.item_count} words · not started` : `${a.done_count}/${a.item_count} words`;
}

/**
 * The tutor's view of the one-off homework in this relationship: the load
 * gauge, what is still open (overdue first, with the due label the student
 * sees and their progress), and what is done. Tap an open item to move its
 * date or cancel it.
 */
export function AssignedHomeworkSection({ relId, studentName }: { relId: string; studentName: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['relationship-homework', relId], queryFn: () => getRelationshipHomework(relId), staleTime: 30_000 });

  if (query.isLoading) return null;
  if (query.isError || !query.data) return <div className="td-error">Could not load the homework plan</div>;
  const { assignments, load, today } = query.data;
  const oneOff = assignments.filter((a) => a.mode !== 'fsrs' && a.status !== 'cancelled');
  const active = oneOff.filter((a) => a.status === 'active').sort((a, b) => compareDue(a.due_date, b.due_date) || a.part_index - b.part_index);
  const done = oneOff.filter((a) => a.status === 'done').slice(0, DONE_SHOWN);

  const patch = async (a: HomeworkAssignment, body: { due_date?: string; status?: 'cancelled' }) => {
    setError(null);
    try {
      await updateHomeworkAssignment(relId, a.id, body);
      setOpen(null);
      queryClient.invalidateQueries({ queryKey: ['relationship-homework', relId] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update it');
    }
  };

  return (
    <div className="hwt-assigned" data-testid="assigned-homework">
      <LoadGauge load={load} studentName={studentName} />
      {error && <div className="td-error">{error}</div>}
      {active.length === 0 && done.length === 0 && (
        <p className="td-muted">No one-off homework yet. Send a deck or lesson as <strong>One-off</strong> to give it a due date.</p>
      )}
      {active.length > 0 && (
        <div className="hwt-rows">
          {active.map((a) => (
            <div key={a.id} className="hwt-row-wrap">
              <button type="button" className="hwt-row" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id} data-testid="tutor-hw-row">
                <span aria-hidden="true">{KIND_ICON[a.kind] ?? '📝'}</span>
                <span className="hwt-row-main">
                  <span className="hwt-row-title" lang="zh">{a.title}</span>
                  <span className="hwt-row-meta">
                    {progressText(a)}
                    {a.mode === 'both' ? ' · + long-term' : ''}
                  </span>
                </span>
                <DueChip due={dueLabel(a.due_date, today)} />
              </button>
              {open === a.id && (
                <div className="hwt-row-edit">
                  <label>
                    <span>Due</span>
                    <input type="date" defaultValue={a.due_date ?? ''} onChange={(e) => e.target.value && void patch(a, { due_date: e.target.value })} />
                  </label>
                  <button type="button" className="btn-link sn-danger" onClick={() => { if (window.confirm(`Cancel "${a.title}"? It disappears from ${studentName}'s homework.`)) void patch(a, { status: 'cancelled' }); }}>
                    Cancel this homework
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {done.length > 0 && (
        <details className="hwt-done">
          <summary>Done ({oneOff.filter((a) => a.status === 'done').length})</summary>
          <ul>
            {done.map((a) => (
              <li key={a.id}>
                {KIND_ICON[a.kind] ?? '📝'} <span lang="zh">{a.title}</span> · {progressText(a)}
                {a.completed_at ? ` · ${shortDay(a.completed_at.slice(0, 10))}` : ''}
                {a.due_date && a.completed_at && a.completed_at.slice(0, 10) > a.due_date ? ' · late' : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
