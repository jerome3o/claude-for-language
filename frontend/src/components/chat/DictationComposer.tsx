/**
 * The chat composer's voice side (docs/CHAT.md "Voice-first composer"; rules in shared/voice/dictation.ts,
 * state from hooks/useVoiceDictation.ts — the same flow as every voice-first box):
 *
 *   idle       [+] [⌨️] [ 🎤 Say it ........ ] [〰]     〰 = hold to send a VOICE MESSAGE (human chats;
 *                                                     rendered by ChatPage — one call site, so a hold
 *                                                     survives the row turning into the recorder)
 *   listening  [✕] [ 我明天… (live, grey tail) ] [⏹]
 *   review     [🔁] [ 我明天去公园  ✏️ ✓ ] [➤]          ✓ = Check my Chinese, ➤ = send as TEXT
 *   failed     [⌨️] [ Couldn't transcribe — tap to retry ] [🔁]
 *
 * Two microphones, two jobs, never the same glyph: 🎤 "Say it" writes TEXT (the default, the wide
 * button); the round waveform button records a VOICE MESSAGE (hold, unchanged). Typing (⌨️) is the
 * old composer, which keeps a 🎤 in its pill to go back to speaking.
 */
import { SIGNED_OUT_TRANSCRIPTION } from '@shared/auth/session';
import type { ReactNode } from 'react';
import { DICTATION_COPY, dictationControls, type DictationState } from '@shared/voice/dictation';
import type { VoiceTextInputActions } from '../voice/VoiceTextInput';

/** The waveform glyph of the voice-message button (distinct from dictation's 🎤). */
export function WaveformIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {[
        [3, 9, 6],
        [7.5, 5, 14],
        [12, 2, 20],
        [16.5, 6, 12],
        [21, 9, 6],
      ].map(([x, y, h]) => (
        <rect key={x} x={x - 1.25} y={y} width={2.5} height={h} rx={1.25} fill="currentColor" />
      ))}
    </svg>
  );
}

export interface DictationComposerProps {
  state: DictationState;
  finalText: string;
  partialText: string;
  actions: VoiceTextInputActions;
  /** Left of the row while idle: the composer's [+] button. */
  attach: ReactNode;
  /** ✓ Check my Chinese on the review (null when it doesn't apply). */
  onCheck: (() => void) | null;
  checkBusy?: boolean;
  /** ➤ disabled (waiting for Claude). */
  sendDisabled?: boolean;
  /** The listening line before words arrive. */
  listeningPlaceholder?: string;
}

export function DictationComposer(props: DictationComposerProps) {
  const { state, finalText, partialText, actions } = props;
  const controls = dictationControls(state);
  const tid = (s: string) => `chat-dictate-${s}`;

  if (state.phase === 'idle') {
    return (
      <div className="chat-dictate-row" data-testid="chat-dictate" data-phase="idle">
        {props.attach}
        <button type="button" className="chat-round-btn chat-type-btn" onClick={actions.type} aria-label="Type a message" title="Type instead" data-testid="chat-type-btn">
          ⌨️
        </button>
        <button type="button" className="chat-say-btn" onClick={actions.say} aria-label="Say it — dictate a text message" data-testid="chat-say-btn">
          <span aria-hidden="true">🎤</span> {DICTATION_COPY.say}
        </button>
      </div>
    );
  }

  if (state.phase === 'listening' || state.phase === 'finishing') {
    const finishing = state.phase === 'finishing';
    return (
      <div className="chat-dictate-row" data-testid="chat-dictate" data-phase={state.phase}>
        <button type="button" className="chat-round-btn chat-dictate-cancel" onClick={actions.cancel} aria-label={DICTATION_COPY.cancel} data-testid={tid('cancel')}>
          ✕
        </button>
        <div className="chat-dictate-live" aria-live="polite" lang="zh-CN" data-testid={tid('live')}>
          {finalText || partialText ? (
            <>
              <span className="chat-dictate-final">{finalText}</span>
              <span className="chat-dictate-interim">{partialText}</span>
            </>
          ) : (
            <span className="chat-dictate-placeholder">{finishing ? DICTATION_COPY.finishing : props.listeningPlaceholder ?? 'Listening… say your message'}</span>
          )}
        </div>
        <button
          type="button"
          className={`chat-round-btn chat-dictate-stop${finishing ? ' finishing' : ''}`}
          onClick={actions.stop}
          disabled={finishing}
          aria-label={finishing ? DICTATION_COPY.finishing : 'Stop and use what I said'}
          data-testid={tid('stop')}
        >
          {finishing ? <span className="chat-spinner" aria-hidden="true" /> : <span className="chat-dictate-stop-square" aria-hidden="true" />}
        </button>
      </div>
    );
  }

  if (state.phase === 'review') {
    return (
      <div className="chat-dictate-row" data-testid="chat-dictate" data-phase="review">
        <button type="button" className="chat-round-btn chat-dictate-retake" onClick={actions.retake} aria-label="Say it again" title={DICTATION_COPY.retake} data-testid={tid('retake')}>
          🔁
        </button>
        <div className="chat-input-pill chat-dictate-review">
          <button type="button" className="chat-dictate-review-text" onClick={actions.edit} aria-label="Edit what I said" data-testid={tid('review-text')}>
            {finalText}
          </button>
          <button type="button" className="chat-pill-btn" onClick={actions.edit} aria-label="Edit what I said" data-testid={tid('edit')}>
            ✏️
          </button>
          {props.onCheck && (
            <button
              type="button"
              className={`chat-pill-btn chat-check-btn${props.checkBusy ? ' active' : ''}`}
              onClick={props.onCheck}
              disabled={props.checkBusy}
              aria-label="Check my Chinese"
              title="Check my Chinese before sending"
              data-testid={tid('check')}
            >
              ✓
            </button>
          )}
        </div>
        <button
          type="button"
          className="chat-round-btn chat-send"
          onClick={actions.submit}
          disabled={props.sendDisabled}
          aria-label="Send"
          data-testid={tid('send')}
        >
          ➤
        </button>
      </div>
    );
  }

  // failed: nothing came back (or nothing was heard) — typing or another take, never a dead end.
  const retryUpload = controls.includes('retry_upload');
  return (
    <div className="chat-dictate-row" data-testid="chat-dictate" data-phase="failed">
      <button type="button" className="chat-round-btn chat-type-btn" onClick={actions.type} aria-label="Type a message" data-testid="chat-type-btn">
        ⌨️
      </button>
      {retryUpload ? (
        <button type="button" className="chat-dictate-failed" onClick={actions.retryUpload} data-testid={tid('retry-upload')}>
          {state.failure === 'offline' ? DICTATION_COPY.offline : state.failure === 'signed_out' ? SIGNED_OUT_TRANSCRIPTION : DICTATION_COPY.failed}
        </button>
      ) : (
        <div className="chat-dictate-failed empty" data-testid={tid('empty')}>{DICTATION_COPY.empty}</div>
      )}
      <button type="button" className="chat-round-btn chat-dictate-retake" onClick={actions.retake} aria-label="Say it again" data-testid={tid('retake')}>
        🔁
      </button>
    </div>
  );
}
