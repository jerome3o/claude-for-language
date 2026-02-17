import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  getHomeworkAssignments,
  updateHomeworkStatus,
  deleteHomework,
  assignHomework,
  getGradedReaders,
  getMyRelationships,
} from '../api/client';
import { Loading, EmptyState } from '../components/Loading';
import {
  HomeworkAssignmentWithDetails,
  HomeworkStatus,
  DifficultyLevel,
  GradedReader,
} from '../types';

const DIFFICULTY_COLORS: Record<DifficultyLevel, { bg: string; text: string; label: string }> = {
  beginner: { bg: '#dcfce7', text: '#166534', label: 'Beginner' },
  elementary: { bg: '#dbeafe', text: '#1e40af', label: 'Elementary' },
  intermediate: { bg: '#fef3c7', text: '#92400e', label: 'Intermediate' },
  advanced: { bg: '#fce7f3', text: '#9d174d', label: 'Advanced' },
};

const STATUS_STYLES: Record<HomeworkStatus, { bg: string; text: string; label: string }> = {
  assigned: { bg: '#dbeafe', text: '#1e40af', label: 'Assigned' },
  in_progress: { bg: '#fef3c7', text: '#92400e', label: 'In Progress' },
  completed: { bg: '#dcfce7', text: '#166534', label: 'Completed' },
};

function formatDate(dateStr: string) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}

function HomeworkCard({
  hw,
  isTutor,
  onUpdateStatus,
  onDelete,
}: {
  hw: HomeworkAssignmentWithDetails;
  isTutor: boolean;
  onUpdateStatus: (id: string, status: 'in_progress' | 'completed') => void;
  onDelete: (id: string) => void;
}) {
  const navigate = useNavigate();
  const diffStyle = DIFFICULTY_COLORS[hw.reader_difficulty_level];
  const statusStyle = STATUS_STYLES[hw.status];

  return (
    <div className="card" style={{ padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
        <div>
          <h3 style={{ fontSize: '1.125rem', margin: '0 0 0.25rem 0' }}>
            {hw.reader_title_chinese}
          </h3>
          <p style={{ color: '#6b7280', margin: 0, fontSize: '0.875rem' }}>
            {hw.reader_title_english}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.375rem', flexShrink: 0 }}>
          <span style={{
            padding: '0.125rem 0.5rem', borderRadius: '1rem', fontSize: '0.75rem',
            backgroundColor: diffStyle.bg, color: diffStyle.text, fontWeight: 500,
          }}>
            {diffStyle.label}
          </span>
          <span style={{
            padding: '0.125rem 0.5rem', borderRadius: '1rem', fontSize: '0.75rem',
            backgroundColor: statusStyle.bg, color: statusStyle.text, fontWeight: 500,
          }}>
            {statusStyle.label}
          </span>
        </div>
      </div>

      <p style={{ color: '#9ca3af', margin: '0 0 0.25rem 0', fontSize: '0.75rem' }}>
        {isTutor
          ? `Student: ${hw.student_name || hw.student_email || 'Unknown'}`
          : `From: ${hw.tutor_name || hw.tutor_email || 'Unknown'}`
        }
        {' \u00b7 '}Assigned {formatDate(hw.assigned_at)}
        {hw.completed_at && <>{' \u00b7 '}Completed {formatDate(hw.completed_at)}</>}
      </p>

      {hw.notes && (
        <p style={{ color: '#6b7280', margin: '0.5rem 0', fontSize: '0.875rem', fontStyle: 'italic', borderLeft: '2px solid #e5e7eb', paddingLeft: '0.5rem' }}>
          {hw.notes}
        </p>
      )}

      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #e5e7eb',
      }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {!isTutor && hw.status !== 'completed' && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                if (hw.status === 'assigned') {
                  onUpdateStatus(hw.id, 'in_progress');
                }
                navigate(`/readers/${hw.reader_id}`);
              }}
              style={{ padding: '0.375rem 0.75rem', fontSize: '0.875rem' }}
            >
              {hw.status === 'assigned' ? 'Start Reading' : 'Continue Reading'}
            </button>
          )}
          {!isTutor && hw.status === 'in_progress' && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => onUpdateStatus(hw.id, 'completed')}
              style={{ padding: '0.375rem 0.75rem', fontSize: '0.875rem' }}
            >
              Mark Complete
            </button>
          )}
          {!isTutor && hw.status === 'completed' && (
            <Link
              to={`/readers/${hw.reader_id}`}
              className="btn btn-secondary btn-sm"
              style={{ padding: '0.375rem 0.75rem', fontSize: '0.875rem' }}
            >
              Read Again
            </Link>
          )}
          {isTutor && (
            <Link
              to={`/readers/${hw.reader_id}`}
              className="btn btn-secondary btn-sm"
              style={{ padding: '0.375rem 0.75rem', fontSize: '0.875rem' }}
            >
              View Reader
            </Link>
          )}
        </div>
        {isTutor && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => {
              if (window.confirm('Remove this homework assignment?')) {
                onDelete(hw.id);
              }
            }}
            style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem', color: '#dc2626' }}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function AssignHomeworkModal({
  onClose,
  onAssign,
}: {
  onClose: () => void;
  onAssign: (data: { reader_id: string; student_id: string; notes?: string }) => void;
}) {
  const [readerId, setReaderId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [notes, setNotes] = useState('');

  const readersQuery = useQuery({
    queryKey: ['readers'],
    queryFn: getGradedReaders,
  });

  const relationshipsQuery = useQuery({
    queryKey: ['relationships'],
    queryFn: getMyRelationships,
  });

  const readers = (readersQuery.data || []).filter(
    (r: GradedReader) => r.status === 'ready'
  );
  const students: { id: string; name: string | null; email: string | null }[] = [];
  if (relationshipsQuery.data) {
    for (const rel of relationshipsQuery.data.students) {
      const student = rel.requester_id === rel.recipient_id
        ? null
        : rel.requester_role === 'student'
          ? rel.requester
          : rel.recipient;
      if (student) {
        students.push({ id: student.id, name: student.name, email: student.email });
      }
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!readerId || !studentId) return;
    onAssign({ reader_id: readerId, student_id: studentId, notes: notes.trim() || undefined });
  };

  const isLoading = readersQuery.isLoading || relationshipsQuery.isLoading;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
        <div className="modal-header">
          <h2 className="modal-title">Assign Homework</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {isLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>
        ) : (
          <form onSubmit={handleSubmit} style={{ padding: '1rem' }}>
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label className="form-label">Reader</label>
              {readers.length === 0 ? (
                <p style={{ color: '#9ca3af', fontSize: '0.875rem', margin: 0 }}>
                  No published readers available. <Link to="/readers">Create one first.</Link>
                </p>
              ) : (
                <select className="form-input" value={readerId} onChange={(e) => setReaderId(e.target.value)} required>
                  <option value="">Select a reader...</option>
                  {readers.map((r: GradedReader) => (
                    <option key={r.id} value={r.id}>
                      {r.title_chinese} - {r.title_english}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label className="form-label">Student</label>
              {students.length === 0 ? (
                <p style={{ color: '#9ca3af', fontSize: '0.875rem', margin: 0 }}>
                  No students connected. <Link to="/connections">Add a student first.</Link>
                </p>
              ) : (
                <select className="form-input" value={studentId} onChange={(e) => setStudentId(e.target.value)} required>
                  <option value="">Select a student...</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name || s.email || s.id}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label className="form-label">Notes (optional)</label>
              <textarea
                className="form-input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Instructions or focus areas for the student..."
                rows={3}
                style={{ resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!readerId || !studentId || readers.length === 0 || students.length === 0}
              >
                Assign
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function HomeworkPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [filter, setFilter] = useState<'all' | HomeworkStatus>('all');
  const isTutor = user?.role === 'tutor';

  const hwQuery = useQuery({
    queryKey: ['homework'],
    queryFn: getHomeworkAssignments,
  });

  const assignMutation = useMutation({
    mutationFn: assignHomework,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['homework'] });
      setShowAssignModal(false);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'in_progress' | 'completed' }) =>
      updateHomeworkStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['homework'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteHomework,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['homework'] });
    },
  });

  if (hwQuery.isLoading) return <Loading />;

  if (hwQuery.error) {
    return (
      <div className="page">
        <div className="container">
          <div className="card" style={{ textAlign: 'center', color: '#dc2626' }}>
            Failed to load homework. Please try again.
          </div>
        </div>
      </div>
    );
  }

  const assignments = hwQuery.data || [];
  const filtered = filter === 'all'
    ? assignments
    : assignments.filter((h) => h.status === filter);

  const counts = {
    all: assignments.length,
    assigned: assignments.filter((h) => h.status === 'assigned').length,
    in_progress: assignments.filter((h) => h.status === 'in_progress').length,
    completed: assignments.filter((h) => h.status === 'completed').length,
  };

  return (
    <div className="page">
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h1 style={{ margin: 0 }}>Homework</h1>
          {isTutor && (
            <button className="btn btn-primary" onClick={() => setShowAssignModal(true)}>
              Assign Homework
            </button>
          )}
        </div>

        {assignments.length > 0 && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            {(['all', 'assigned', 'in_progress', 'completed'] as const).map((f) => (
              <button
                key={f}
                className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFilter(f)}
                style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
              >
                {f === 'all' ? 'All' : f === 'in_progress' ? 'In Progress' : f.charAt(0).toUpperCase() + f.slice(1)}
                {' '}({counts[f]})
              </button>
            ))}
          </div>
        )}

        {filtered.length === 0 ? (
          <EmptyState
            icon={isTutor ? '📋' : '📖'}
            title={assignments.length === 0
              ? (isTutor ? 'No homework assigned yet' : 'No homework yet')
              : 'No homework matches this filter'}
            description={assignments.length === 0
              ? (isTutor
                  ? 'Assign graded readers to your students as homework'
                  : 'Your tutor hasn\'t assigned any homework yet')
              : 'Try a different filter to see more assignments'}
            action={isTutor && assignments.length === 0 ? (
              <button className="btn btn-primary" onClick={() => setShowAssignModal(true)}>
                Assign Homework
              </button>
            ) : undefined}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {filtered.map((hw) => (
              <HomeworkCard
                key={hw.id}
                hw={hw}
                isTutor={isTutor!}
                onUpdateStatus={(id, status) => statusMutation.mutate({ id, status })}
                onDelete={(id) => deleteMutation.mutate(id)}
              />
            ))}
          </div>
        )}

        {showAssignModal && (
          <AssignHomeworkModal
            onClose={() => setShowAssignModal(false)}
            onAssign={(data) => assignMutation.mutate(data)}
          />
        )}
      </div>
    </div>
  );
}
