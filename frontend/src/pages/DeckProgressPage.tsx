import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getDeckProgress } from '../api/client';
import { Loading, ErrorMessage } from '../components/Loading';
import {
  CompletionSection,
  CardTypeBreakdownSection,
  StrugglingWordsSection,
  ActivitySection,
} from '../components/DeckProgress';
import { DeckProgress } from '../types';
import './SharedDeckProgressPage.css';

export function DeckProgressPage() {
  const { deckId } = useParams<{ deckId: string }>();

  const progressQuery = useQuery({
    queryKey: ['deckProgress', deckId],
    queryFn: () => getDeckProgress(deckId!),
    enabled: !!deckId,
  });

  if (progressQuery.isLoading) {
    return <Loading />;
  }

  if (progressQuery.error) {
    const msg =
      progressQuery.error instanceof Error
        ? progressQuery.error.message
        : 'Failed to load progress';
    return <ErrorMessage message={msg} />;
  }

  const progress: DeckProgress = progressQuery.data!;

  return (
    <div className="page">
      <div className="container">
        {/* Header */}
        <div className="sdp-header">
          <Link to={`/decks/${deckId}`} className="back-link">
            ← Back to Deck
          </Link>
          <div className="sdp-deck-info">
            <h1>{progress.deck_name}</h1>
            <p className="sdp-subtitle">Your Progress</p>
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
