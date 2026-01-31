import { CardTypeProgressStats, StrugglingWord } from '../types';
import { EmptyState } from './Loading';

// Utility functions
export function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatRating(rating: number): string {
  if (rating < 1) return 'Struggling';
  if (rating < 1.5) return 'Difficult';
  if (rating < 2.5) return 'Okay';
  return 'Good';
}

// Shared Components
interface CardTypeProgressBarProps {
  label: string;
  stats: CardTypeProgressStats;
}

export function CardTypeProgressBar({ label, stats }: CardTypeProgressBarProps) {
  const total = stats.total;
  if (total === 0) return null;

  const newPct = (stats.new / total) * 100;
  const learningPct = (stats.learning / total) * 100;
  const familiarPct = (stats.familiar / total) * 100;
  const masteredPct = (stats.mastered / total) * 100;

  return (
    <div className="card-type-row">
      <div className="card-type-label">{label}</div>
      <div className="card-type-bar-container">
        <div className="card-type-bar">
          {masteredPct > 0 && (
            <div
              className="bar-segment mastered"
              style={{ width: `${masteredPct}%` }}
              title={`Mastered: ${stats.mastered}`}
            />
          )}
          {familiarPct > 0 && (
            <div
              className="bar-segment familiar"
              style={{ width: `${familiarPct}%` }}
              title={`Familiar: ${stats.familiar}`}
            />
          )}
          {learningPct > 0 && (
            <div
              className="bar-segment learning"
              style={{ width: `${learningPct}%` }}
              title={`Learning: ${stats.learning}`}
            />
          )}
          {newPct > 0 && (
            <div
              className="bar-segment new"
              style={{ width: `${newPct}%` }}
              title={`New: ${stats.new}`}
            />
          )}
        </div>
        <div className="card-type-counts">
          <span className="count-item mastered">{stats.mastered}</span>
          <span className="count-item familiar">{stats.familiar}</span>
          <span className="count-item learning">{stats.learning}</span>
          <span className="count-item new">{stats.new}</span>
        </div>
      </div>
    </div>
  );
}

interface StrugglingWordItemProps {
  word: StrugglingWord;
}

export function StrugglingWordItem({ word }: StrugglingWordItemProps) {
  return (
    <div className="struggling-word-item">
      <div className="word-main">
        <span className="word-hanzi">{word.hanzi}</span>
        <span className="word-pinyin">{word.pinyin}</span>
      </div>
      <div className="word-english">{word.english}</div>
      <div className="word-stats">
        <span className="word-lapses">
          {word.lapses} {word.lapses === 1 ? 'lapse' : 'lapses'}
        </span>
        {word.avg_rating > 0 && (
          <>
            <span className="stat-separator">·</span>
            <span className="word-rating">{formatRating(word.avg_rating)}</span>
          </>
        )}
      </div>
    </div>
  );
}

// Completion stats section
interface CompletionSectionProps {
  completion: {
    total_cards: number;
    cards_seen: number;
    cards_mastered: number;
    percent_seen: number;
    percent_mastered: number;
  };
}

export function CompletionSection({ completion }: CompletionSectionProps) {
  return (
    <div className="sdp-section">
      <h2>Completion</h2>
      <div className="completion-card">
        <div className="completion-bar-container">
          <div className="completion-bar">
            <div
              className="completion-fill mastered"
              style={{ width: `${completion.percent_mastered}%` }}
            />
            <div
              className="completion-fill seen"
              style={{
                width: `${completion.percent_seen - completion.percent_mastered}%`,
              }}
            />
          </div>
          <div className="completion-labels">
            <span>0%</span>
            <span>100%</span>
          </div>
        </div>
        <div className="completion-stats">
          <div className="completion-stat">
            <span className="completion-value">{completion.cards_seen}</span>
            <span className="completion-label">
              Seen ({completion.percent_seen}%)
            </span>
          </div>
          <div className="completion-stat">
            <span className="completion-value mastered">
              {completion.cards_mastered}
            </span>
            <span className="completion-label">
              Mastered ({completion.percent_mastered}%)
            </span>
          </div>
          <div className="completion-stat">
            <span className="completion-value">{completion.total_cards}</span>
            <span className="completion-label">Total Cards</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Card type breakdown section
interface CardTypeBreakdownSectionProps {
  breakdown: {
    hanzi_to_meaning: CardTypeProgressStats;
    meaning_to_hanzi: CardTypeProgressStats;
    audio_to_hanzi: CardTypeProgressStats;
  };
}

export function CardTypeBreakdownSection({ breakdown }: CardTypeBreakdownSectionProps) {
  return (
    <div className="sdp-section">
      <h2>Progress by Card Type</h2>
      <div className="card-type-breakdown">
        <div className="card-type-legend">
          <span className="legend-item mastered">Mastered</span>
          <span className="legend-item familiar">Familiar</span>
          <span className="legend-item learning">Learning</span>
          <span className="legend-item new">New</span>
        </div>
        <CardTypeProgressBar
          label="Hanzi → Meaning"
          stats={breakdown.hanzi_to_meaning}
        />
        <CardTypeProgressBar
          label="Meaning → Hanzi"
          stats={breakdown.meaning_to_hanzi}
        />
        <CardTypeProgressBar
          label="Audio → Hanzi"
          stats={breakdown.audio_to_hanzi}
        />
      </div>
    </div>
  );
}

// Struggling words section
interface StrugglingWordsSectionProps {
  words: StrugglingWord[];
}

export function StrugglingWordsSection({ words }: StrugglingWordsSectionProps) {
  return (
    <div className="sdp-section">
      <h2>Words Needing Practice</h2>
      {words.length === 0 ? (
        <EmptyState
          icon="🎉"
          title="No struggling words"
          description="Great job! No words need extra attention right now."
        />
      ) : (
        <div className="struggling-words-list">
          {words.map((word) => (
            <StrugglingWordItem key={word.hanzi} word={word} />
          ))}
        </div>
      )}
    </div>
  );
}

// Activity section
interface ActivitySectionProps {
  activity: {
    last_studied_at: string | null;
    total_study_time_ms: number;
    reviews_last_7_days: number;
  };
}

export function ActivitySection({ activity }: ActivitySectionProps) {
  return (
    <div className="sdp-section">
      <h2>Recent Activity</h2>
      <div className="activity-card">
        <div className="activity-row">
          <span className="activity-label">Last Studied</span>
          <span className="activity-value">
            {formatDate(activity.last_studied_at)}
          </span>
        </div>
        <div className="activity-row">
          <span className="activity-label">Total Study Time</span>
          <span className="activity-value">
            {formatTime(activity.total_study_time_ms)}
          </span>
        </div>
        <div className="activity-row">
          <span className="activity-label">Reviews (Last 7 Days)</span>
          <span className="activity-value">{activity.reviews_last_7_days}</span>
        </div>
      </div>
    </div>
  );
}
