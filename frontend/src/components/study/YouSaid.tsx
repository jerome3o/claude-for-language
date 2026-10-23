/**
 * "You said" — the box for what was said aloud on the read card's back (the pronunciation take)
 * (docs/STUDY_SESSION.md "You said"). Lab: `YouSaidBox` in ui/study/YouSaidBox.kt. A spoken answer
 * on a typing card and 🎤 Say it practice use the compact `YouSaidRow` (end of this file) under the
 * card's own answer instead.
 *
 *   ( ▶ )      You said · ✓ Match       ( ✎ )
 *                   曾经。
 *                  céng jīng
 *
 * What he said is the hero (hanzi, the device's pinyin under it); the verdict is a small chip:
 * green "✓ Match", YELLOW "≈ Contains the answer" (the answer said inside a longer sentence —
 * `spokenAnswerWithin` in shared/cards/answer.ts), red "✗ Didn't match". Each verdict has its own
 * icon and words, so no state relies on colour alone (Jerome is red / green colour-blind: the old
 * orange "contains" read as the red "miss"); the yellow is index.css `--color-partial*`. Round 44px
 * buttons sit in equal side columns so the text stays centred: ▶ plays the take (read cards,
 * `onPlay`), ✎ opens the sentence in the Sentence Coach's Check my sentence (yellow box only,
 * `onCoach`). The waiting /
 * offline / failed states use the same shell and height, so the result replaces them without a jump.
 */
import type { ReactNode } from 'react';
import { compareTranscription } from '@shared/recordings/transcript';
import type { AnswerVerdict } from '@shared/cards/answer';
import { spokenResult, spokenResultLabel } from '@shared/cards/spoken-result';
import './YouSaid.css';

export type YouSaidState = 'match' | 'contains' | 'miss';

/** The verdict chip's words (Lab: `youSaidVerdictLabel`). */
export const YOU_SAID_VERDICT: Record<YouSaidState, string> = {
  match: 'Match',
  contains: 'Contains the answer',
  miss: 'Didn’t match',
};
export const YOU_SAID_COACH_LABEL = 'Check in Coach';
export const YOU_SAID_PLAY_LABEL = 'Play my recording';

export interface YouSaidProps {
  hanzi: string;
  pinyin: string;
  isMatch: boolean;
  containsExpected: boolean;
  /** Only on the yellow (contains) box: open `hanzi` in the Sentence Coach's Check my sentence. */
  onCoach?: () => void;
  /** ▶ on the left: play the take this was transcribed from (read cards). */
  onPlay?: () => void;
}

/** The pinyin line under the hanzi: no space before punctuation ("zhōng guó 。" → "zhōng guó。"). Lab: `tidyYouSaidPinyin`. */
export function tidyPinyin(pinyin: string): string {
  return pinyin.replace(/\s+(?=[。，、！？；：.,!?;:])/g, '').trim();
}

/** Material icons (Apache 2.0), drawn in currentColor; `approx` (≈: two waves, Lab `YouSaidApproxIcon`) is stroked. */
const ICON = {
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  approx: 'M4 9.5c2.67-2.67 5.33-2.67 8 0s5.33 2.67 8 0M4 15.5c2.67-2.67 5.33-2.67 8 0s5.33 2.67 8 0',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  play: 'M8 5v14l11-7z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  retry: 'M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
} as const;

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {d === ICON.approx
        ? <path d={d} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" />
        : <path d={d} fill="currentColor" />}
    </svg>
  );
}

/** The verdict chip's icon: ✓ match, ≈ contains, ✗ miss — never colour alone (Lab: `youSaidVerdictIcon`). */
export const YOU_SAID_VERDICT_ICON: Record<YouSaidState, 'check' | 'approx' | 'close'> = {
  match: 'check',
  contains: 'approx',
  miss: 'close',
};

/** The shell every state shares: optional round buttons in equal side columns, the text centred between. */
function Shell({ tone, state, left, right, children, testId = 'you-said' }: {
  tone: string;
  state: string;
  left?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  const sides = !!(left || right);
  return (
    <div
      className={`transcription-result you-said you-said--${tone}${sides ? ' you-said--sides' : ''}`}
      data-testid={testId}
      data-state={state}
    >
      {sides && <span className="you-said-side">{left}</span>}
      <div className="you-said-body">{children}</div>
      {sides && <span className="you-said-side">{right}</span>}
    </div>
  );
}

function RoundButton({ icon, label, onClick, testId }: { icon: string; label: string; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      className="you-said-round"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={label}
      title={label}
      data-testid={testId}
    >
      <Icon d={icon} />
    </button>
  );
}

export function YouSaid({ hanzi, pinyin, isMatch, containsExpected, onCoach, onPlay }: YouSaidProps) {
  const state: YouSaidState = isMatch ? 'match' : containsExpected ? 'contains' : 'miss';
  const coach = state === 'contains' && onCoach;
  return (
    <Shell
      tone={state}
      state={state}
      left={onPlay && <RoundButton icon={ICON.play} label={YOU_SAID_PLAY_LABEL} onClick={onPlay} testId="you-said-play" />}
      right={coach && <RoundButton icon={ICON.edit} label={YOU_SAID_COACH_LABEL} onClick={coach} testId="you-said-coach" />}
    >
      <div className="you-said-head">
        <span className="you-said-label">You said</span>
        <span className="you-said-verdict" data-testid="you-said-verdict" data-icon={YOU_SAID_VERDICT_ICON[state]}>
          <Icon d={ICON[YOU_SAID_VERDICT_ICON[state]]} />
          {YOU_SAID_VERDICT[state]}
        </span>
      </div>
      <div className="you-said-hanzi" lang="zh-CN" data-testid="you-said-hanzi">{hanzi || '…'}</div>
      {pinyin && <div className="you-said-pinyin" data-testid="you-said-pinyin">{tidyPinyin(pinyin)}</div>}
    </Shell>
  );
}

/** "Transcribing…" in the same shell (no jump when the result arrives). */
export function YouSaidPending() {
  return (
    <Shell tone="pending" state="pending" testId="you-said-pending">
      <div className="you-said-head"><span className="you-said-label">You said</span></div>
      <div className="you-said-waiting" role="status">
        <span className="you-said-dots" aria-hidden="true"><span /><span /><span /></span>
        Transcribing…
      </div>
    </Shell>
  );
}

/** Offline: the take is kept and transcribed in the next sync. */
export function YouSaidOffline() {
  return (
    <Shell tone="offline" state="offline" testId="you-said-offline">
      <div className="you-said-head"><span className="you-said-label">You said</span></div>
      <div className="you-said-waiting">Recording saved, will transcribe when online</div>
    </Shell>
  );
}

/** Never silent: both transcription paths failed — the whole box retries the same take. */
export function YouSaidFailed({ onRetry, note = 'Your recording is saved', testId = 'transcription-retry' }: { onRetry: () => void; note?: string; testId?: string }) {
  return (
    <button
      type="button"
      className="transcription-result you-said you-said--failed you-said--sides you-said-retry"
      data-testid={testId}
      data-state="failed"
      onClick={(e) => { e.stopPropagation(); onRetry(); }}
    >
      <span className="you-said-side"><span className="you-said-round" aria-hidden="true"><Icon d={ICON.retry} /></span></span>
      <span className="you-said-body">
        <span className="you-said-failed-title">Couldn’t transcribe</span>
        <span className="you-said-failed-note">Tap to retry · {note.charAt(0).toLowerCase() + note.slice(1)}</span>
      </span>
      <span className="you-said-side" />
    </button>
  );
}

export interface YouSaidRowProps {
  /** What was said (the spoken answer / practice take's transcript). */
  transcript: string;
  /** The card's answer (hanzi). */
  correct: string;
  verdict: AnswerVerdict;
  /** ▶ on the left: play the take. */
  onPlay?: () => void;
  /** ✎ on the right (every state but a plain match): the sentence in the Sentence Coach. */
  onCoach?: () => void;
  testId?: string;
}

/**
 * The spoken answer's result on a typing card (and 🎤 Say it practice) — ONE compact row under the
 * card's own answer, pinyin and meaning (docs/STUDY_SESSION.md "Say the answer"):
 *
 *   ( ▶ )  You said 朗 lǎng  [≈ Close — tones off]  ( ✎ )
 *
 * What was said is marked character by character (shared/cards/spoken-result.ts): "Sounded right"
 * marks the characters written differently in yellow with a dotted underline (the chip stays ✓);
 * close / didn't match mark the characters not in the answer red with a solid underline. The chip
 * has its own icon and words; a screen reader hears the whole row as one sentence
 * (`spokenResultLabel`). Lab: `SpokenResultRow` in ui/study/YouSaidBox.kt.
 */
export function YouSaidRow({ transcript, correct, verdict, onPlay, onCoach, testId = 'spoken-result' }: YouSaidRowProps) {
  const r = spokenResult(transcript, correct, verdict);
  const pinyin = tidyPinyin(compareTranscription(transcript, correct, '').transcribedPinyin);
  const coach = r.coach ? onCoach : undefined;
  return (
    <div
      className={`spoken-result spoken-result--${r.state}`}
      data-testid={testId}
      data-state={r.state}
      data-verdict={verdict}
    >
      {/* ▶ / ✎ in equal side columns (an empty one balances a lone button) so the text stays centred. */}
      {onPlay
        ? <RoundButton icon={ICON.play} label={YOU_SAID_PLAY_LABEL} onClick={onPlay} testId="you-said-play" />
        : coach && <span className="spoken-result-side" aria-hidden="true" />}
      <div className="spoken-result-body">
        <span className="spoken-result-sr" data-testid="spoken-result-label">{spokenResultLabel(r, correct, pinyin)}</span>
        <span className="spoken-result-said" aria-hidden="true">
          <span className="spoken-result-label">You said</span>
          <span className="spoken-result-hanzi" lang="zh-CN" data-testid="spoken-result-hanzi">
            {r.chars.length === 0 ? '…' : r.chars.map((c, i) => (
              <span key={i} className={`spoken-mark spoken-mark--${c.mark}`} data-mark={c.mark}>{c.char}</span>
            ))}
          </span>
          {pinyin && <span className="spoken-result-pinyin" data-testid="spoken-result-pinyin">{pinyin}</span>}
        </span>
        <span className="spoken-result-chip" aria-hidden="true" data-testid="spoken-result-chip" data-icon={r.icon}>
          <Icon d={ICON[r.icon]} />
          {r.chip}
        </span>
      </div>
      {coach
        ? <RoundButton icon={ICON.edit} label={YOU_SAID_COACH_LABEL} onClick={coach} testId="you-said-coach" />
        : onPlay && <span className="spoken-result-side" aria-hidden="true" />}
    </div>
  );
}
