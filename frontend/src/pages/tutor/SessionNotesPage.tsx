/**
 * All session-notes jobs for one student (the student page shows the latest
 * three). Same frame as the other tutor pages.
 */

import { useParams } from 'react-router-dom';
import { TutorPageFrame } from './tutor-shared';
import { SessionNotesSection } from '../../components/tutor/SessionNotesSection';
import '../ConnectionDetailPage.css';
import '../../components/tutor/tutor-dashboard.css';

export function SessionNotesPage() {
  const { relId } = useParams<{ relId: string }>();
  return (
    <TutorPageFrame relId={relId!} title="Session notes">
      {(student) => <SessionNotesSection relId={relId!} studentName={student.name || student.email || 'the student'} showAll />}
    </TutorPageFrame>
  );
}
