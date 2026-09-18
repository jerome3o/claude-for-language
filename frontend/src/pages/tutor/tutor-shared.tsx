/**
 * Small pieces shared by the tutor insight pages: header with the student,
 * rating dot, card-type chip, recording play button, typed-answer diff and
 * date/time formatters. Tutor-facing wording only — no scheduler jargon.
 */

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getRelationship, getAudioUrl } from '../../api/client';
import { useAudioPlayer } from '../../hooks/useAudio';
import { useAuth } from '../../contexts/AuthContext';
import { getMyRoleInRelationship, getOtherUserInRelationship, type CardType, type UserSummary } from '../../types';
import { Loading, ErrorMessage } from '../../components/Loading';
import './tutor.css';

// ---------- Formatters ----------

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return ms > 0 ? '<1m' : '0m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function formatDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${formatDay(iso)} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatSeconds(ms: number | null): string {
  if (ms == null || ms <= 0) return '';
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

export const RATING_LABELS = ['Forgot', 'Hard', 'Good', 'Easy'] as const;
export const RATING_CLASS = ['again', 'hard', 'good', 'easy'] as const;

export const CARD_TYPE_SHORT: Record<CardType, string> = {
  hanzi_to_meaning: '读 Read',
  meaning_to_hanzi: '写 Write',
  audio_to_hanzi: '听 Listen',
};

export const CARD_TYPE_LONG: Record<CardType, string> = {
  hanzi_to_meaning: 'Hanzi → meaning (spoken)',
  meaning_to_hanzi: 'Meaning → hanzi (typed)',
  audio_to_hanzi: 'Audio → hanzi (typed)',
};

// ---------- Tiny display components ----------

export function RatingDot({ rating, withLabel = false }: { rating: number; withLabel?: boolean }) {
  const cls = RATING_CLASS[rating] ?? 'good';
  const label = RATING_LABELS[rating] ?? '';
  return (
    <span className={`tutor-rating tutor-rating-${cls}`} title={label}>
      <span className="tutor-rating-dot" />
      {withLabel && <span className="tutor-rating-label">{label}</span>}
    </span>
  );
}

export function CardTypeChip({ cardType }: { cardType: CardType }) {
  return (
    <span className={`tutor-chip tutor-chip-type tutor-chip-${cardType}`} title={CARD_TYPE_LONG[cardType]}>
      {CARD_TYPE_SHORT[cardType]}
    </span>
  );
}

export function RecordingButton({ url, compact = false }: { url: string; compact?: boolean }) {
  const { isPlaying, play, stop } = useAudioPlayer(getAudioUrl(url));
  return (
    <button
      type="button"
      className={`tutor-play-btn ${isPlaying ? 'playing' : ''} ${compact ? 'compact' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        if (isPlaying) stop();
        else play();
      }}
      aria-label={isPlaying ? 'Stop recording' : 'Play recording'}
    >
      {isPlaying ? '⏹' : '▶'}
      {!compact && <span>{isPlaying ? 'Stop' : 'Play'}</span>}
    </button>
  );
}

const ANSWER_PUNCT = /[\s。，！？、；：,.!?;:'"“”‘’…—·\-()（）]/g;
function normalize(s: string) {
  return s.replace(ANSWER_PUNCT, '').toLowerCase();
}

/** Same equivalence as the server: whitespace and punctuation are not mistakes. */
export function answersMatch(userAnswer: string, correctAnswer: string): boolean {
  return normalize(userAnswer) === normalize(correctAnswer);
}

/**
 * Character-by-character diff of a typed answer against the correct hanzi
 * (same positional logic as the study card): wrong characters in red, then the
 * expected answer with the characters the student missed highlighted.
 */
export function AnswerDiff({ userAnswer, correctAnswer }: { userAnswer: string; correctAnswer: string }) {
  const typed = userAnswer.trim();
  if (!typed) return null;
  if (answersMatch(typed, correctAnswer)) {
    return (
      <span className="tutor-answer-diff">
        {[...typed].map((ch, i) => (
          <span key={i} className="tutor-diff-char tutor-diff-correct">{ch}</span>
        ))}
      </span>
    );
  }
  const maxLen = Math.max(typed.length, correctAnswer.length);
  const userChars: Array<{ ch: string; ok: boolean }> = [];
  const expected: Array<{ ch: string; ok: boolean }> = [];
  for (let i = 0; i < maxLen; i++) {
    const u = typed[i] ?? '';
    const c = correctAnswer[i] ?? '';
    const ok = u === c;
    if (i < typed.length) userChars.push({ ch: u, ok });
    if (i < correctAnswer.length) expected.push({ ch: c, ok });
  }
  return (
    <span className="tutor-answer-diff">
      {userChars.map((c, i) => (
        <span key={`u${i}`} className={`tutor-diff-char ${c.ok ? 'tutor-diff-correct' : 'tutor-diff-wrong'}`}>{c.ch}</span>
      ))}
      <span className="tutor-diff-arrow">→</span>
      {expected.map((c, i) => (
        <span key={`e${i}`} className={`tutor-diff-char ${c.ok ? 'tutor-diff-correct' : 'tutor-diff-expected'}`}>{c.ch}</span>
      ))}
    </span>
  );
}

// ---------- Page frame ----------

/**
 * Loads the relationship, checks the viewer is the tutor, and renders the
 * back link + student header. Children get the student summary.
 */
export function TutorPageFrame({
  relId,
  title,
  backTo,
  backLabel = 'Back',
  actions,
  children,
}: {
  relId: string;
  title: string;
  backTo?: string;
  backLabel?: string;
  actions?: React.ReactNode;
  children: (student: UserSummary) => React.ReactNode;
}) {
  const { user } = useAuth();
  const relationshipQuery = useQuery({
    queryKey: ['relationship', relId],
    queryFn: () => getRelationship(relId),
    enabled: !!relId,
  });

  if (relationshipQuery.isLoading) return <Loading />;
  if (relationshipQuery.error || !relationshipQuery.data) {
    return (
      <div className="page"><div className="container"><ErrorMessage message="Connection not found" /></div></div>
    );
  }
  const relationship = relationshipQuery.data;
  if (getMyRoleInRelationship(relationship, user!.id) !== 'tutor') {
    return (
      <div className="page"><div className="container"><ErrorMessage message="Only tutors can view this page" /></div></div>
    );
  }
  const student = getOtherUserInRelationship(relationship, user!.id);

  return (
    <div className="page tutor-page">
      <div className="container">
        <div className="tutor-page-header">
          <Link to={backTo ?? `/connections/${relId}`} className="back-link">← {backLabel}</Link>
          <div className="tutor-page-title-row">
            {student.picture_url ? (
              <img src={student.picture_url} alt="" className="tutor-avatar" />
            ) : (
              <div className="tutor-avatar placeholder">{(student.name || student.email || '?')[0].toUpperCase()}</div>
            )}
            <div className="tutor-page-title">
              <h1>{title}</h1>
              <span className="tutor-page-subtitle">{student.name || student.email}</span>
            </div>
            {actions && <div className="tutor-page-actions">{actions}</div>}
          </div>
        </div>
        {children(student)}
      </div>
    </div>
  );
}

/** Row of links between the three tutor pages. */
export function TutorPageNav({ relId, current }: { relId: string; current: 'insights' | 'history' | 'recordings' }) {
  const items: Array<{ key: typeof current; to: string; label: string }> = [
    { key: 'insights', to: `/connections/${relId}/insights`, label: 'Insights' },
    { key: 'history', to: `/connections/${relId}/history`, label: 'History' },
    { key: 'recordings', to: `/connections/${relId}/recordings`, label: 'Recordings' },
  ];
  return (
    <nav className="tutor-page-nav" aria-label="Student pages">
      {items.map((it) => (
        <Link key={it.key} to={it.to} className={`tutor-nav-link ${it.key === current ? 'active' : ''}`}>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
