import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getTutorDashboard, DASHBOARD_STALE_MS } from '../../api/tutorDashboard';
import { revokeInvite } from '../../api/invites';
import type { StudentOverview } from '../../types/tutorDashboard';
import { Loading } from '../Loading';
import { StudentCard } from './StudentCard';
import { PendingInviteRow } from './PendingInviteRow';
import { HomeworkDecks } from './HomeworkDecks';
import { SendHomeworkSheet } from './SendHomeworkSheet';
import './tutor-dashboard.css';

/**
 * The tutor's Students dashboard (Connections page when the account has at
 * least one active student): one card per student, pending invite links as
 * muted rows, the tutor's homework decks. One aggregated request, cached 60s.
 */
export function StudentsDashboard({ canInvite }: { canInvite: boolean }) {
  const queryClient = useQueryClient();
  const [homeworkFor, setHomeworkFor] = useState<StudentOverview | null>(null);

  const dashboard = useQuery({
    queryKey: ['tutor-dashboard'],
    queryFn: getTutorDashboard,
    staleTime: DASHBOARD_STALE_MS,
  });

  const revoke = useMutation({
    mutationFn: revokeInvite,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invites'] });
      queryClient.invalidateQueries({ queryKey: ['tutor-dashboard'] });
    },
  });

  if (dashboard.isLoading) return <Loading message="Loading your students…" />;
  if (dashboard.isError || !dashboard.data) {
    return <div className="td-error">{dashboard.error instanceof Error ? dashboard.error.message : 'Could not load your students'}</div>;
  }

  const { students, invites, homework_decks } = dashboard.data;
  const homeworkStudentName = homeworkFor ? homeworkFor.student.name || homeworkFor.student.email || 'your student' : '';

  return (
    <>
      <section className="td-section" aria-label="Students">
        <div className="td-list">
          {students.map((s) => (
            <StudentCard key={s.relationship_id} overview={s} onSendHomework={setHomeworkFor} />
          ))}
          {canInvite && invites.map((inv) => (
            <PendingInviteRow key={inv.id} invite={inv} onRevoke={(id) => revoke.mutateAsync(id).then(() => undefined)} />
          ))}
        </div>
      </section>

      <HomeworkDecks decks={homework_decks} />

      {homeworkFor && (
        <SendHomeworkSheet
          relId={homeworkFor.relationship_id}
          studentName={homeworkStudentName}
          sharedDecks={homeworkFor.homework.decks}
          assignedLessons={homeworkFor.homework.lessons}
          onClose={() => setHomeworkFor(null)}
        />
      )}
    </>
  );
}
