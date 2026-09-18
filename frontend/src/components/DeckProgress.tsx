import { useState } from 'react';
import { CardTypeProgressStats, NoteProgress } from '../types';
import { EmptyState } from './Loading';

// Utility functions

/**
 * Study time for stat tiles. Never says "0m" for time that was actually
 * spent: anything under a minute is "< 1 min", and minutes are rounded to
 * the nearest whole minute ("1 min", "12 min", "1h 5m").
 */
export function formatTime(ms: number): string {
  if (!ms || ms <= 0) return '0 min';
  if (ms < 60000) return '< 1 min';
  const minutes = Math.max(1, Math.round(ms / 60000));
  if (minutes < 60) {
    return `${minutes} min`;
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
  // Reverse so oldest is on left, most recent on right
  const reversed = [...ratings].reverse();
  return (
    <span className="rating-dots">
      {reversed.map((r, i) => (
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

// Card type labels for the dots rows
const CARD_TYPE_LABELS = {
  hanzi_to_meaning: '字→义',
  meaning_to_hanzi: '义→字',
  audio_to_hanzi: '听→字',
};

interface NoteProgressItemProps {
  note: NoteProgress;
}

function NoteProgressItem({ note }: NoteProgressItemProps) {
  const { recent_ratings } = note;
  const hasAnyRatings =
    recent_ratings.hanzi_to_meaning.length > 0 ||
    recent_ratings.meaning_to_hanzi.length > 0 ||
    recent_ratings.audio_to_hanzi.length > 0;

  return (
    <div className="note-progress-item">
      <div className="note-info">
        <span className="note-hanzi">{note.hanzi}</span>
        <span className="note-pinyin">{note.pinyin}</span>
        <span className="note-english">{note.english}</span>
      </div>
      <div className="note-ratings-container">
        {hasAnyRatings ? (
          <div className="note-ratings-grid">
            {(['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'] as const).map((type) => (
              <div key={type} className="rating-row">
                <span className="rating-row-label">{CARD_TYPE_LABELS[type]}</span>
                <RatingDots ratings={recent_ratings[type]} />
              </div>
            ))}
          </div>
        ) : (
          <span className="no-reviews">—</span>
        )}
      </div>
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
  const [showHelp, setShowHelp] = useState(false);

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
        <>
          <div className="rating-dots-legend">
            <span className="legend-label">Reviews:</span>
            <span className="legend-dot" style={{ backgroundColor: '#ef4444' }} />
            <span className="legend-text">Again</span>
            <span className="legend-dot" style={{ backgroundColor: '#f97316' }} />
            <span className="legend-text">Hard</span>
            <span className="legend-dot" style={{ backgroundColor: '#22c55e' }} />
            <span className="legend-text">Good</span>
            <span className="legend-dot" style={{ backgroundColor: '#3b82f6' }} />
            <span className="legend-text">Easy</span>
            <button
              className="legend-help-btn"
              onClick={() => setShowHelp(true)}
              aria-label="Show help"
            >
              ?
            </button>
          </div>
          {showHelp && (
            <div className="help-modal-overlay" onClick={() => setShowHelp(false)}>
              <div className="help-modal" onClick={(e) => e.stopPropagation()}>
                <button className="help-modal-close" onClick={() => setShowHelp(false)}>×</button>
                <h3>Understanding Review Dots</h3>
                <p>Each word has three rows of colored dots showing your review history for different card types:</p>
                <div className="help-card-types">
                  <div><strong>字→义</strong> — See characters, recall meaning</div>
                  <div><strong>义→字</strong> — See meaning, type characters</div>
                  <div><strong>听→字</strong> — Hear audio, type characters</div>
                </div>
                <p>Each dot represents one review. Dots go from oldest (left) to newest (right):</p>
                <div className="help-colors">
                  <div><span className="help-dot" style={{ backgroundColor: '#ef4444' }} /> <strong>Again</strong> — Forgot the word</div>
                  <div><span className="help-dot" style={{ backgroundColor: '#f97316' }} /> <strong>Hard</strong> — Difficult recall</div>
                  <div><span className="help-dot" style={{ backgroundColor: '#22c55e' }} /> <strong>Good</strong> — Normal recall</div>
                  <div><span className="help-dot" style={{ backgroundColor: '#3b82f6' }} /> <strong>Easy</strong> — Easy recall</div>
                </div>
                <p className="help-example-title">Example:</p>
                <div className="help-example">
                  <div className="help-example-row">
                    <span className="rating-row-label">字→义</span>
                    <span className="rating-dots">
                      <span className="rating-dot" style={{ backgroundColor: '#ef4444' }} />
                      <span className="rating-dot" style={{ backgroundColor: '#f97316' }} />
                      <span className="rating-dot" style={{ backgroundColor: '#22c55e' }} />
                      <span className="rating-dot" style={{ backgroundColor: '#22c55e' }} />
                    </span>
                  </div>
                </div>
                <p className="help-example-desc">This shows 4 reviews: started with "Again", then "Hard", then two "Good" — improving over time!</p>
              </div>
            </div>
          )}
          <div className="notes-progress-list">
            {notes.map((note) => (
              <NoteProgressItem key={note.hanzi} note={note} />
            ))}
          </div>
        </>
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

// ============ Merged deck-page progress block ============

const CARD_TYPE_SHORT: Record<'hanzi_to_meaning' | 'meaning_to_hanzi' | 'audio_to_hanzi', { zh: string; en: string }> = {
  hanzi_to_meaning: { zh: '字→义', en: 'Hanzi → Meaning' },
  meaning_to_hanzi: { zh: '义→字', en: 'Meaning → Hanzi' },
  audio_to_hanzi: { zh: '听→字', en: 'Audio → Hanzi' },
};

interface DeckProgressSummaryProps {
  completion: CompletionSectionProps['completion'];
  breakdown: CardTypeBreakdownSectionProps['breakdown'];
  /** Server-only; omitted when the page is showing locally computed progress. */
  activity?: ActivitySectionProps['activity'] | null;
}

/**
 * ONE progress block for the deck page: a mastery bar, one compact row per
 * card type, and a "last studied · reviews this week" line. Replaces the
 * stat tiles + Completion + Progress by card type + Recent Activity stack.
 */
export function DeckProgressSummary({ completion, breakdown, activity }: DeckProgressSummaryProps) {
  const { total_cards, cards_seen, cards_mastered, percent_seen, percent_mastered } = completion;
  const learningPct = Math.max(0, percent_seen - percent_mastered);
  return (
    <div className="card deck-progress-summary" aria-label="Deck progress">
      <div className="dps-headline">
        <span className="dps-headline-main">
          <strong>{percent_mastered}%</strong> mastered
        </span>
        <span className="dps-headline-sub">
          {cards_mastered} mastered · {cards_seen} seen · {total_cards} cards
        </span>
      </div>
      <div
        className="dps-bar"
        role="img"
        aria-label={`${percent_mastered}% mastered, ${percent_seen}% seen`}
      >
        <div className="dps-bar-fill mastered" style={{ width: `${percent_mastered}%` }} />
        <div className="dps-bar-fill seen" style={{ width: `${learningPct}%` }} />
      </div>

      <div className="dps-types">
        {(['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'] as const).map(type => {
          const stats = breakdown[type];
          if (!stats || stats.total === 0) return null;
          const pct = (n: number) => `${(n / stats.total) * 100}%`;
          return (
            <div key={type} className="dps-type-row">
              <span className="dps-type-label">
                <span className="dps-type-zh">{CARD_TYPE_SHORT[type].zh}</span>
                <span className="dps-type-en">{CARD_TYPE_SHORT[type].en}</span>
              </span>
              <span className="dps-type-bar" aria-hidden="true">
                {stats.mastered > 0 && <span className="bar-segment mastered" style={{ width: pct(stats.mastered) }} />}
                {stats.familiar > 0 && <span className="bar-segment familiar" style={{ width: pct(stats.familiar) }} />}
                {stats.learning > 0 && <span className="bar-segment learning" style={{ width: pct(stats.learning) }} />}
                {stats.new > 0 && <span className="bar-segment new" style={{ width: pct(stats.new) }} />}
              </span>
              <span className="dps-type-count" title={`${stats.mastered} mastered, ${stats.familiar} familiar, ${stats.learning} learning, ${stats.new} new`}>
                {stats.mastered + stats.familiar}/{stats.total}
              </span>
            </div>
          );
        })}
      </div>

      {activity && (
        <div className="dps-activity">
          Last studied {formatDate(activity.last_studied_at).toLowerCase() === 'never' ? 'never' : formatDate(activity.last_studied_at)}
          {' · '}
          {activity.reviews_last_7_days} review{activity.reviews_last_7_days === 1 ? '' : 's'} in the last 7 days
          {activity.total_study_time_ms > 0 && ` · ${formatTime(activity.total_study_time_ms)} total`}
        </div>
      )}
    </div>
  );
}
