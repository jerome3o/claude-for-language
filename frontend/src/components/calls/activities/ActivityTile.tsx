/**
 * The in-call activity tile (shared/call-activities; docs/VIDEO_CALLS.md
 * "In-call activities"): the room's session, rendered for MY role. Every
 * button is shown only when the engine would accept that action from me
 * (`can`), so what you see is exactly what the room allows.
 *
 * Audio: when the asker plays a word (`data.play` goes up) it plays on this
 * device too — never on first sight (a reload doesn't replay it).
 */

import { useEffect, useRef, useState } from 'react';
import {
  ACTIVITY_KIND_INFO,
  activitySummary,
  reduceActivity,
  roleBadge,
  rolesOf,
  rolesSwappedNotice,
  scoreOf,
  totalRounds,
  type ActivityAction,
  type ActivityRole,
  type ActivitySession,
} from '@shared/call-activities';
import { useLessonSpeak } from '../../editor/useLessonSpeak';
import { createAudioPlayer } from '../../../utils/audioPlayback';
import { getAudioUrl } from '../../../api/client';
import { ActivityBody, NeededWords } from './ActivityViews';
import { reviewClipKey } from './ReviewView';
import './activities.css';

export interface ActivityTileProps {
  session: ActivitySession;
  myUserId: string;
  act: (action: ActivityAction) => void;
  close: () => void;
}

/** The text the asker's "play" plays for this round (quiz audio / the dictation word). */
export function audioFor(s: ActivitySession): string | null {
  if (s.spec.kind === 'quiz') return s.spec.questions[s.round]?.audio ?? null;
  if (s.spec.kind === 'dictation') return s.spec.items[s.round]?.hanzi ?? null;
  return null;
}

export function ActivityTile({ session, myUserId, act, close }: ActivityTileProps) {
  const speak = useLessonSpeak();
  const mine = rolesOf(session, myUserId);
  const solo = mine.length === 2;
  const [viewAs, setViewAs] = useState<ActivityRole>('a');
  const role: ActivityRole = solo ? viewAs : (mine[0] ?? 'b');
  const [menu, setMenu] = useState(false);
  const can = (a: ActivityAction) => reduceActivity(session, a, myUserId, 0) !== null;

  // Roles swapped (same session, my role changed): say so on each side for a few seconds.
  const [swapNote, setSwapNote] = useState<string | null>(null);
  const lastRole = useRef<{ id: string; role: ActivityRole } | null>(null);
  const spec = session.spec;
  useEffect(() => {
    const prev = lastRole.current;
    lastRole.current = { id: session.session_id, role };
    if (solo || !prev || prev.id !== session.session_id || prev.role === role) return;
    setSwapNote(rolesSwappedNotice(spec, role));
  }, [session.session_id, role, solo]);
  useEffect(() => {
    if (!swapNote) return;
    const t = setTimeout(() => setSwapNote(null), 4500);
    return () => clearTimeout(t);
  }, [swapNote]);

  // Play the asker's audio here when it goes up (not on first sight / a rejoin).
  // Review together: one counter for the whole list (selecting keeps it), the clip is an R2 key.
  const heard = useRef<{ key: string; play: number } | null>(null);
  const clipPlayer = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  useEffect(() => () => clipPlayer.current?.dispose(), []);
  useEffect(() => {
    const review = session.spec.kind === 'review';
    const key = review ? session.session_id : `${session.session_id}:${session.round}`;
    const play = session.data.play ?? 0;
    const prev = heard.current;
    heard.current = { key, play };
    if (!prev || prev.key !== key) return;
    if (play > prev.play) {
      if (session.spec.kind === 'review') {
        const clip = reviewClipKey(session.spec, session.round, session.data.clip);
        if (clip) {
          clipPlayer.current ??= createAudioPlayer();
          clipPlayer.current.play(getAudioUrl(clip), { label: 'call-review', cacheKey: clip });
        }
        return;
      }
      const text = audioFor(session);
      if (text) speak(text);
    }
  }, [session, speak]);

  const info = ACTIVITY_KIND_INFO[session.spec.kind];
  const total = totalRounds(session.spec);
  const score = scoreOf(session);
  const host = session.host === myUserId;
  const controls: [string, ActivityAction, string][] = [
    ['Skip this round', { type: 'skip' }, 'activity-skip'],
    ['Reset this round', { type: 'reset_round' }, 'activity-reset'],
    ['Swap roles', { type: 'swap_roles' }, 'activity-swap'],
    ['Restart from the beginning', { type: 'restart' }, 'activity-restart'],
    ['End the activity (show results)', { type: 'finish' }, 'activity-finish'],
  ];

  return (
    <div className="call-tile-body act" data-testid="activity-tile" data-kind={session.spec.kind} data-phase={session.phase} data-round={session.round}>
      <div className="act-bar">
        <span className="act-icon" aria-hidden="true">{info.icon}</span>
        <span className="act-title" title={session.spec.title}>
          {session.spec.title}
          {session.spec.title_zh && <span className="act-title-zh">{session.spec.title_zh}</span>}
        </span>
        {session.phase !== 'done' && total > 1 && session.spec.kind !== 'review' && <span className="act-progress" data-testid="activity-progress">{session.round + 1} / {total}</span>}
        {score.scored > 0 && <span className="act-score" data-testid="activity-score">✓ {score.correct}/{score.scored}</span>}
        {solo ? (
          <span className="act-viewas" role="radiogroup" aria-label="Viewing as">
            {(['a', 'b'] as ActivityRole[]).map((r) => (
              <button key={r} type="button" role="radio" aria-checked={viewAs === r} className={viewAs === r ? 'on' : ''} onClick={() => setViewAs(r)} data-testid={`activity-viewas-${r}`}>
                {session.spec.role_names[r]}
              </button>
            ))}
          </span>
        ) : (
          <span className="act-role" data-testid="activity-role">{session.spec.role_names[role]}</span>
        )}
        {controls.some(([, a]) => can(a)) && (
          <span className="act-menu-wrap">
            <button type="button" className="act-btn" onClick={() => setMenu((v) => !v)} aria-label="Activity controls" aria-expanded={menu} data-testid="activity-menu">⋯</button>
            {menu && (
              <div className="act-menu" role="menu" onClick={() => setMenu(false)}>
                {controls.filter(([, a]) => can(a)).map(([label, a, id]) => (
                  <button key={id} type="button" role="menuitem" onClick={() => act(a)} data-testid={id}>{label}</button>
                ))}
              </div>
            )}
          </span>
        )}
        <button type="button" className="act-btn act-close" onClick={close} title="Close the activity (for both)" aria-label="Close the activity" data-testid="activity-close">✕</button>
      </div>
      <div className="act-scroll">
        {session.phase !== 'done' && (
          <div className={`act-badge-row${swapNote ? ' swapped' : ''}`}>
            <span className={`act-badge role-${role}`} data-testid="activity-role-badge" data-role={role}>
              <span aria-hidden="true">{BADGE_ICON[session.spec.kind]?.[role] ?? '👤'}</span> {roleBadge(session.spec, role)}
            </span>
            {swapNote && <span className="act-swap-note" role="status" data-testid="activity-swap-note">⇄ {swapNote}</span>}
          </div>
        )}
        {session.phase === 'done' ? (
          <ActivityDone session={session} canRestart={can({ type: 'restart' })} act={act} close={close} />
        ) : (
          <ActivityBody session={session} me={myUserId} role={role} host={host} act={act} can={can} speak={speak} />
        )}
      </div>
    </div>
  );
}

const BADGE_ICON: Partial<Record<ActivitySession['spec']['kind'], Record<ActivityRole, string>>> = {
  describe: { a: '🗣', b: '🤔' },
  quiz: { a: '🎤', b: '✋' },
  dictation: { a: '🗣', b: '✍️' },
  roleplay: { a: '🎭', b: '🎭' },
};

function ActivityDone({ session, canRestart, act, close }: { session: ActivitySession; canRestart: boolean; act: (a: ActivityAction) => void; close: () => void }) {
  const sum = activitySummary(session);
  return (
    <div className="act-done" data-testid="activity-done">
      <div className="act-done-head">🎉 Finished!</div>
      {sum.scored > 0 ? (
        <div className="act-done-score" data-testid="activity-done-score">{sum.correct} / {sum.scored} right</div>
      ) : (
        <div className="act-done-score">{sum.played} of {sum.total_rounds} {session.spec.kind === 'roleplay' ? 'lines read' : session.spec.kind === 'review' ? 'reviewed' : 'rounds played'}</div>
      )}
      <ul className="act-done-lines">
        {sum.lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
      <NeededWords session={session} where="summary" />
      <p className="act-muted">Kept with this lesson — it shows on the review page and the homework assistant reads it.</p>
      <div className="act-actions">
        {canRestart && <button type="button" className="act-primary secondary" onClick={() => act({ type: 'restart' })} data-testid="activity-again">↻ Play again</button>}
        <button type="button" className="act-primary" onClick={close} data-testid="activity-done-close">Close</button>
      </div>
    </div>
  );
}
