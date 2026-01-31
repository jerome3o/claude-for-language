import { useParams, Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getSharedDeckProgress, getStudentSharedDeckProgress, getRelationship } from '../api/client';
import { Loading, ErrorMessage } from '../components/Loading';
import { useAuth } from '../contexts/AuthContext';
import {
  CompletionSection,
  CardTypeBreakdownSection,
  StrugglingWordsSection,
  ActivitySection,
} from '../components/DeckProgress';
import {
  getMyRoleInRelationship,
  SharedDeckProgress,
} from '../types';
import './SharedDeckProgressPage.css';

export function SharedDeckProgressPage() {
  const { relId, sharedDeckId, studentSharedDeckId } = useParams<{
    relId: string;
    sharedDeckId?: string;
    studentSharedDeckId?: string;
  }>();
  const { user } = useAuth();
  const location = useLocation();

  // Determine if this is a student-shared deck based on the URL
  const isStudentSharedDeck = location.pathname.includes('/student-shared-decks/');
  const deckId = studentSharedDeckId || sharedDeckId;

  const relationshipQuery = useQuery({
    queryKey: ['relationship', relId],
    queryFn: () => getRelationship(relId!),
    enabled: !!relId,
  });

  const progressQuery = useQuery({
    queryKey: [isStudentSharedDeck ? 'studentSharedDeckProgress' : 'sharedDeckProgress', relId, deckId],
    queryFn: () =>
      isStudentSharedDeck
        ? getStudentSharedDeckProgress(relId!, deckId!)
        : getSharedDeckProgress(relId!, deckId!),
    enabled: !!relId && !!deckId,
  });

  if (relationshipQuery.isLoading || progressQuery.isLoading) {
    return <Loading />;
  }

  if (relationshipQuery.error) {
    return <ErrorMessage message="Connection not found" />;
  }

  if (progressQuery.error) {
    const msg =
      progressQuery.error instanceof Error
        ? progressQuery.error.message
        : 'Failed to load progress';
    return <ErrorMessage message={msg} />;
  }

  const relationship = relationshipQuery.data!;
  const myRole = getMyRoleInRelationship(relationship, user!.id);

  // Only tutors can view this
  if (myRole !== 'tutor') {
    return <ErrorMessage message="Only tutors can view shared deck progress" />;
  }

  const progress: SharedDeckProgress = progressQuery.data!;
  const { student } = progress;

  return (
    <div className="page">
      <div className="container">
        {/* Header */}
        <div className="sdp-header">
          <Link to={`/connections/${relId}`} className="back-link">
            ← Back
          </Link>
          <div className="sdp-deck-info">
            <h1>{progress.deck_name}</h1>
            <div className="sdp-student-row">
              {student.picture_url ? (
                <img
                  src={student.picture_url}
                  alt=""
                  className="sdp-student-avatar"
                />
              ) : (
                <div className="sdp-student-avatar placeholder">
                  {(student.name || student.email || '?')[0].toUpperCase()}
                </div>
              )}
              <span className="sdp-student-name">
                {student.name || student.email || 'Unknown'}
              </span>
            </div>
          </div>
        </div>

        <CompletionSection completion={progress.completion} />
        <CardTypeBreakdownSection breakdown={progress.card_type_breakdown} />
        <StrugglingWordsSection words={progress.struggling_words} />
        <ActivitySection activity={progress.activity} />
      </div>
    </div>
  );
}
