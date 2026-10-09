/**
 * The audio-lesson player's companion mini lesson card (docs/AUDIO_LESSONS.md "Companion mini
 * lesson", shared/lesson/unlock.ts):
 * - none yet → "✨ Make its mini lesson" (online);
 * - being written / failed (Try again);
 * - locked → "🔒 Mini lesson waiting" + the unlock button;
 * - unlocked → "Mini lesson ready: <title> → Start" — prominent once the listen is done.
 */
import { Link, useNavigate } from 'react-router-dom';
import {
  companionBadge,
  companionReadyLine,
  unlockButtonLabel,
  type CompanionStatus,
  type LessonUnlock,
} from '@shared/lesson';

export interface CompanionView {
  status: CompanionStatus;
  lessonId: string | null;
  title: string | null;
  unlock: LessonUnlock | null;
  error?: string | null;
}

export function CompanionCard({ view, listened, online, busy, onMake, onUnlock }: {
  view: CompanionView | null;
  /** The listen reached the end on this page (or earlier). */
  listened: boolean;
  online: boolean;
  busy: boolean;
  onMake: () => void;
  /** Unlock it (via the player); resolves once it is unlocked on this device. */
  onUnlock: () => Promise<void>;
}) {
  const navigate = useNavigate();
  if (!view) {
    return (
      <div className="al-companion" data-testid="al-companion">
        <button className="al-chip" onClick={onMake} disabled={!online || busy} data-testid="al-companion-make">
          {busy ? 'Asking…' : '✨ Make its mini lesson'}
        </button>
        <div className="al-fine">A ~10–15 minute lesson on this podcast&rsquo;s words and sentences — it unlocks once you&rsquo;ve listened.</div>
      </div>
    );
  }
  if (view.status === 'generating') {
    return <div className="al-companion" data-testid="al-companion"><span className="companion-badge">{companionBadge('generating')}</span></div>;
  }
  if (view.status === 'failed') {
    return (
      <div className="al-companion" data-testid="al-companion">
        <span className="companion-badge failed">{companionBadge('failed')}</span>
        {view.error && <div className="al-fine">{view.error}</div>}
        <button className="al-chip" onClick={onMake} disabled={!online || busy}>🔄 Try again</button>
      </div>
    );
  }
  const title = view.title ?? 'its mini lesson';
  if (view.status === 'locked') {
    return (
      <div className={`al-companion ${listened ? 'al-companion-ready' : ''}`} data-testid="al-companion">
        <span className="companion-badge">{companionBadge('locked')}</span>
        <div className="al-companion-title">{title}</div>
        {view.unlock?.kind === 'manual' && <div className="al-fine">🔒 {view.unlock.prompt}</div>}
        <button className="al-chip on" onClick={() => void onUnlock()} disabled={busy} data-testid="al-companion-unlock">
          {view.unlock ? unlockButtonLabel(view.unlock) : "✓ I've listened — unlock"}
        </button>
      </div>
    );
  }
  // Unlocked.
  const start = `/lessons/${view.lessonId}/play?from=player`;
  return (
    <div className={`al-companion ${listened ? 'al-companion-ready' : ''}`} data-testid="al-companion">
      {listened ? (
        <>
          <div className="al-companion-ready-line" data-testid="al-companion-ready">🔓 {companionReadyLine(title)}</div>
          <button className="btn btn-primary al-companion-start" onClick={() => navigate(start)} data-testid="al-companion-start">
            ▶ Start
          </button>
        </>
      ) : (
        <>
          <span className="companion-badge unlocked">{companionBadge('unlocked')}</span>
          <Link to={start} className="al-companion-link">{title} ›</Link>
        </>
      )}
    </div>
  );
}
