import { useNavigate } from 'react-router-dom';
import type { OnboardingState } from '../../api/onboarding';
import { SetupChecklist } from './SetupChecklist';
import { formatStudyEstimate } from '../home/studyEstimate';
import { stripFromTutorSuffix } from '../home/homework';
import './onboarding.css';

interface FirstOpenScreenProps {
  state: OnboardingState;
  userName: string | null | undefined;
  /** Cards due right now (from the local queue), once known. */
  totalDue: number;
  hasSyncedOnce: boolean | undefined;
  isOnline: boolean;
  onDismiss: () => void;
}

function greetingName(name: string | null | undefined): string {
  // Google gives "Li Hua" / "李华" — the whole name reads naturally after 你好.
  return (name ?? '').trim();
}

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  // SQLite writes "2026-09-18 15:13:45" (UTC, no zone) — normalise to ISO.
  const normalised = iso.includes('T') ? iso : iso.replace(' ', 'T');
  const then = new Date(/Z$|[+-]\d\d:\d\d$/.test(normalised) ? normalised : `${normalised}Z`).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * The very first home a new student sees, built from what the join flow
 * already knows (inviter, copied decks, welcome note) so it renders before
 * the first sync. Replaced by the normal home after the first review.
 */
export function FirstOpenScreen({ state, userName, totalDue, hasSyncedOnce, isOnline, onDismiss }: FirstOpenScreenProps) {
  const navigate = useNavigate();
  const tutor = state.inviter?.name || 'Your tutor';
  const decks = state.decks;
  const words = decks.reduce((n, d) => n + d.note_count, 0);
  const name = greetingName(userName);
  const ready = totalDue > 0;

  const start = () => {
    const single = decks.length === 1 ? `&deck=${encodeURIComponent(decks[0].id)}` : '';
    navigate(`/study?autostart=true${single}`);
  };

  let homeworkLine: React.ReactNode;
  if (decks.length === 1) {
    homeworkLine = (
      <>Your first homework is ready: <strong>{stripFromTutorSuffix(decks[0].name)}</strong> — {decks[0].note_count} {decks[0].note_count === 1 ? 'word' : 'words'}.</>
    );
  } else if (decks.length > 1) {
    homeworkLine = (
      <>Your first homework is ready: {decks.length} decks — {words} words.</>
    );
  } else {
    homeworkLine = <>They haven't sent a deck yet — it will show up here as soon as they do.</>;
  }

  let subtitle: string;
  if (ready) subtitle = `${formatStudyEstimate(totalDue).replace(/^about /, 'About ').replace(/^under/, 'Under')} · works offline once it starts`;
  else if (decks.length > 0 && !hasSyncedOnce) subtitle = isOnline ? 'Getting your words…' : 'Connect to the internet once to download your words.';
  else if (decks.length > 0) subtitle = 'Your cards are ready — tap to begin.';
  else subtitle = 'Nothing to study yet.';

  return (
    <div className="onb-first-open">
      <section className="card onb-hero">
        <div className="onb-wave" aria-hidden="true">👋</div>
        <h1 className="onb-greeting">你好{name ? `, ${name}` : ''}!</h1>
        <p className="onb-lead">
          <strong>{tutor}</strong> is your tutor. {homeworkLine}
        </p>
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block onb-start-btn"
          onClick={start}
          disabled={!ready && decks.length > 0 && !hasSyncedOnce}
        >
          Start your first session
        </button>
        <p className="onb-hero-sub">{subtitle}</p>
      </section>

      <SetupChecklist />

      {state.welcome_message && (
        <section className="card onb-welcome" aria-label={`Message from ${tutor}`}>
          <div className="onb-welcome-row">
            {state.inviter?.picture_url ? (
              <img src={state.inviter.picture_url} alt="" className="onb-avatar" />
            ) : (
              <div className="onb-avatar onb-avatar-placeholder" aria-hidden="true">{tutor[0]?.toUpperCase()}</div>
            )}
            <div className="onb-welcome-body">
              <div className="onb-welcome-meta">
                <strong>{tutor}</strong>
                {state.redeemed_at && <span className="text-light"> · {relativeTime(state.redeemed_at)}</span>}
              </div>
              <p className="onb-welcome-text">{state.welcome_message}</p>
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-block"
            onClick={() => navigate(
              state.welcome_conversation_id && state.relationship_id
                ? `/connections/${state.relationship_id}/chat/${state.welcome_conversation_id}`
                : state.relationship_id ? `/connections/${state.relationship_id}` : '/connections'
            )}
          >
            Reply
          </button>
        </section>
      )}

      <p className="onb-skip">
        <button type="button" className="btn-link" onClick={onDismiss}>Show the normal home</button>
      </p>
    </div>
  );
}
