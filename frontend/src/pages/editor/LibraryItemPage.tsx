/**
 * One library item: summary, per-student assignment results, "Push update"
 * for copies that are behind the library version, Edit / Assign / Print.
 */

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getLibraryItem, getLibraryAssignments, pushLibraryUpdate } from '../../api/lessonEditor';
import { Loading, ErrorMessage } from '../../components/Loading';
import { EXERCISE_ICONS, EXERCISE_TYPE_NAMES } from '../../components/editor/DiffCard';
import { exercisePrimaryText } from '@shared/lesson';
import { AssignSheet } from './LessonLibraryPage';
import { useToast } from './LessonEditorPage';
import './LessonLibraryPage.css';

const RATING_LABELS: Record<number, string> = { 0: 'Again', 1: 'Hard', 2: 'Good', 3: 'Easy' };

function when(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso + (iso.endsWith('Z') || iso.includes('+') ? '' : 'Z'));
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function LibraryItemPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [toast, showToast] = useToast();
  const [assigning, setAssigning] = useState(false);
  const [pushing, setPushing] = useState(false);

  const item = useQuery({ queryKey: ['library-item', id], queryFn: () => getLibraryItem(id), retry: 1 });
  const assignments = useQuery({ queryKey: ['library-assignments', id], queryFn: () => getLibraryAssignments(id) });

  if (item.isLoading) return <Loading message="Loading lesson…" />;
  if (item.isError || !item.data) {
    return <div className="page"><div className="container"><ErrorMessage message="Library item not found" /></div></div>;
  }
  const lesson = item.data;
  const rows = assignments.data ?? [];
  const behind = rows.filter(r => !r.up_to_date);

  async function push() {
    if (pushing) return;
    setPushing(true);
    try {
      const r = await pushLibraryUpdate(id);
      showToast(`Updated ${r.updated} student cop${r.updated === 1 ? 'y' : 'ies'}${r.skipped ? `, ${r.skipped} already current` : ''}`);
      queryClient.invalidateQueries({ queryKey: ['library-assignments', id] });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Push failed');
    } finally {
      setPushing(false);
    }
  }

  return (
    <div className="page">
      <div className="container lib-page">
        <Link to="/library" className="lib-back">← Lesson Library</Link>
        <div className="lib-item-head">
          <span className="lib-card-icon big">{lesson.icon || '🎓'}</span>
          <div className="lib-item-titles">
            <h1>{lesson.title}</h1>
            {lesson.description && <p className="text-light">{lesson.description}</p>}
            <div className="lib-card-meta">
              v{lesson.version} · {lesson.spec.sections.reduce((n, s) => n + s.exercises.length, 0)} exercises · updated {when(lesson.updated_at)}
              {lesson.tags.length > 0 && <> · {lesson.tags.map(t => <span key={t} className="lib-tag">{t}</span>)}</>}
            </div>
          </div>
        </div>
        <div className="lib-item-actions">
          <button className="btn btn-primary" onClick={() => navigate(`/library/${id}/edit`)}>✏️ Edit</button>
          <button className="btn btn-secondary" onClick={() => setAssigning(true)}>Assign…</button>
          <button className="btn btn-secondary" onClick={() => navigate(`/library/${id}/print`)}>🖨 Print</button>
        </div>

        <h2 className="lib-h2">Students ({rows.length})</h2>
        {assignments.isLoading && <Loading message="Loading assignments…" />}
        {assignments.data && rows.length === 0 && (
          <p className="text-light">Not assigned to anyone yet.</p>
        )}
        {rows.length > 0 && (
          <div className="lib-table-wrap">
            <table className="lib-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Done</th>
                  <th>Last</th>
                  <th>Version</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.lesson_id}>
                    <td>
                      <div className="lib-student-name">{r.student.name || r.student.email}</div>
                      <div className="lib-cell-sub">assigned {when(r.assigned_at)}</div>
                    </td>
                    <td>{r.completions}×</td>
                    <td>
                      {r.last_completed_at ? (
                        <>
                          <div>{r.last_rating !== null ? RATING_LABELS[r.last_rating] ?? '' : ''}{r.last_score ? ` ${r.last_score.correct}/${r.last_score.total}` : ''}</div>
                          <div className="lib-cell-sub">{when(r.last_completed_at)}</div>
                        </>
                      ) : <span className="text-light">not yet</span>}
                    </td>
                    <td>
                      {r.up_to_date ? <span className="lib-pill ok">current</span> : <span className="lib-pill warn">behind</span>}
                    </td>
                    <td>
                      <Link to={`/lessons/${r.lesson_id}/edit`} className="btn btn-link btn-sm">Open copy</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {behind.length > 0 && (
          <div className="lib-push">
            <p>
              {behind.length} student cop{behind.length === 1 ? 'y is' : 'ies are'} behind the library version
              (edited by the student, or the library changed since). Pushing overwrites their content but keeps
              their history and schedule.
            </p>
            <button className="btn btn-primary" onClick={push} disabled={pushing}>
              {pushing ? 'Pushing…' : `Push update to ${behind.length} student${behind.length === 1 ? '' : 's'}`}
            </button>
          </div>
        )}

        <h2 className="lib-h2">Contents</h2>
        {lesson.spec.sections.map((section, si) => (
          <div key={si} className="lib-section">
            {section.title && <div className="lib-section-title">{section.title}</div>}
            {section.exercises.map((ex, ei) => (
              <div key={ei} className="lib-exercise">
                <span>{EXERCISE_ICONS[ex.type]} <strong>{EXERCISE_TYPE_NAMES[ex.type]}</strong></span>
                <span className="lib-exercise-text">{exercisePrimaryText(ex)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {assigning && (
        <AssignSheet
          itemId={id}
          itemTitle={lesson.title}
          onClose={() => setAssigning(false)}
          onDone={msg => {
            setAssigning(false);
            queryClient.invalidateQueries({ queryKey: ['library-assignments', id] });
            queryClient.invalidateQueries({ queryKey: ['lesson-library'] });
            showToast(msg);
          }}
        />
      )}
      {toast && <div className="ed-toast" role="status">{toast}</div>}
    </div>
  );
}
