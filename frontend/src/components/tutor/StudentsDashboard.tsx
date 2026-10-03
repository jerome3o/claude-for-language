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
import { ProfileNudge } from '../profile/ProfileChip';
import { Link } from 'react-router-dom';
import { getTutorLibrary } from '../../api/homeworkLibrary';
import type { LibraryItem } from '@shared/homework';
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

  // The newest homework per student, for the compact line on each card.
  const library = useQuery({ queryKey: ['homework-library', 'all'], queryFn: getTutorLibrary, staleTime: DASHBOARD_STALE_MS, retry: 1 });
  const newest = new Map<string, LibraryItem>();
  for (const item of library.data?.items ?? []) if (!newest.has(item.relationship_id)) newest.set(item.relationship_id, item);

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
      <ProfileNudge />
      <section className="td-section" aria-label="Students">
        <div className="td-library-link">
          <Link to="/homework-library" data-testid="dashboard-homework-library">✅ Homework library ›</Link>
        </div>
        <div className="td-list">
          {students.map((s) => (
            <StudentCard
              key={s.relationship_id}
              overview={s}
              onSendHomework={setHomeworkFor}
              recent={newest.has(s.relationship_id) && library.data ? { item: newest.get(s.relationship_id)!, today: library.data.today } : null}
            />
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
