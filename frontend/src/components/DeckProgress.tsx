import { CardTypeProgressStats, NoteProgress } from '../types';
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

// Rating dot colors (0=again, 1=hard, 2=good, 3=easy)
const RATING_COLORS = ['#ef4444', '#f97316', '#22c55e', '#3b82f6'];

interface RatingDotsProps {
  ratings: number[];
}

function RatingDots({ ratings }: RatingDotsProps) {
  if (ratings.length === 0) return null;
  return (
    <span className="rating-dots">
      {ratings.map((r, i) => (
        <span
          key={i}
          className="rating-dot"
          style={{ backgroundColor: RATING_COLORS[r] || '#9ca3af' }}
          title={['Again', 'Hard', 'Good', 'Easy'][r] || 'Unknown'}
        />
      ))}
    </span>
  );
}

interface NoteProgressItemProps {
  note: NoteProgress;
}

function NoteProgressItem({ note }: NoteProgressItemProps) {
  return (
    <div className="note-progress-item">
      <span className="note-hanzi">{note.hanzi}</span>
      <span className="note-pinyin">{note.pinyin}</span>
      <span className="note-english">{note.english}</span>
      <RatingDots ratings={note.recent_ratings} />
      <span className="note-mastery">{note.mastery_percent}%</span>
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

// Notes progress section
interface NotesProgressSectionProps {
  notes: NoteProgress[];
}

export function NotesProgressSection({ notes }: NotesProgressSectionProps) {
  return (
    <div className="sdp-section">
      <h2>All Words</h2>
      {notes.length === 0 ? (
        <EmptyState
          icon="📚"
          title="No words yet"
          description="Add some vocabulary to get started."
        />
      ) : (
        <div className="notes-progress-list">
          {notes.map((note) => (
            <NoteProgressItem key={note.hanzi} note={note} />
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
