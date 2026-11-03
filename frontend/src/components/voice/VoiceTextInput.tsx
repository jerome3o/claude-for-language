/**
 * A voice-first text box — "say it, or type it" anywhere the learner would type (docs/STUDY_SESSION.md
 * "Voice-first text boxes"; rules in shared/voice/dictation.ts; Lab twin `VoiceTextField`, ui/kit):
 *
 * - voice (the default): ✏️ Type · wide 🎤 Say it → ✕ Cancel · ⏹ Stop with the live transcript
 *   streaming in (confirmed black, provisional grey) → the review: what was heard, big, with
 *   🔁 Retry · ✏️ Edit · ✓ Submit. No keyboard until Edit / Type.
 * - type: the normal input (or textarea) with a 🎤 to go back to speaking, and Submit.
 * - offline / no microphone / permission denied → typing, with a short reason under the box.
 *
 * Controlled: `value` / `onChange` are the typed text; `onSubmit` gets `{ text, source, transcript }`
 * (source spoken | edited | typed) so an exercise can check a spoken answer leniently and record it.
 */
import { SIGNED_OUT_TRANSCRIPTION } from '@shared/auth/session';
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useVoiceDictation, type DictatedAnswer } from '../../hooks/useVoiceDictation';
import { devicePinyinLine } from '../../utils/autoPinyin';
import { DICTATION_COPY, dictationControls, voiceBlockReason, type DictationMode, type DictationState } from '@shared/voice/dictation';
import './VoiceTextInput.css';

export type { DictatedAnswer };

export interface VoiceTextInputProps {
  /** Analytics enum for `voice_input.used` (lesson_translate, coach, chat…). */
  surface: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (answer: DictatedAnswer) => void;
  submitLabel?: string;
  placeholder?: string;
  /** Shown in the live box before any words arrive. */
  listeningPlaceholder?: string;
  multiline?: boolean;
  /** The answer's language: zh (default; hanzi review + pinyin) or en. */
  lang?: 'zh' | 'en';
  defaultMode?: DictationMode;
  disabled?: boolean;
  /** Check as soon as the take is transcribed (no review step). */
  autoSubmit?: boolean;
  /** Override the connection state. */
  online?: boolean;
  /** data-testid prefix (default `voice-input`). */
  testId?: string;
  className?: string;
  /** The wide 🎤's word (default "Say it"; the coach's follow-up says "Respond"). */
  sayLabel?: string;
  /**
   * A chat composer (the Claude threads): typing is ONE row — a box that starts at one line and grows to
   * four, 🎤, and a round ➤ send — with no separate full-width Send row; the voice row is a little
   * smaller (Jerome, Nov 2026: "far too tall").
   */
  compact?: boolean;
}

export function VoiceTextInput(props: VoiceTextInputProps) {
  const { value, onChange, onSubmit, lang = 'zh' } = props;
  const d = useVoiceDictation({
    surface: props.surface,
    value,
    onChange,
    onSubmit,
    defaultMode: props.defaultMode,
    lang,
    autoSubmit: props.autoSubmit,
    online: props.online,
  });
  return (
    <VoiceTextInputView
      {...props}
      state={d.state}
      finalText={d.finalText}
      partialText={d.partialText}
      canSubmit={d.canSubmit}
      actions={{ say: d.say, stop: d.stop, cancel: d.cancel, retake: d.retake, retryUpload: d.retryUpload, edit: d.edit, type: d.type, submit: d.submit }}
    />
  );
}

export interface VoiceTextInputActions {
  say: () => void;
  stop: () => void;
  cancel: () => void;
  retake: () => void;
  retryUpload: () => void;
  edit: () => void;
  type: () => void;
  submit: () => void;
}

export interface VoiceTextInputViewProps extends Omit<VoiceTextInputProps, 'onSubmit' | 'surface' | 'autoSubmit' | 'online' | 'defaultMode'> {
  state: DictationState;
  finalText: string;
  partialText: string;
  canSubmit: boolean;
  actions: VoiceTextInputActions;
  /** While typing: more buttons in the submit row, after it (the Chats tab's ✏️ Check / 🔍 Explain). */
  submitRowExtra?: ReactNode;
}

/** The box rendered from its state (stateless: the screenshot harness renders every state with it). */
export function VoiceTextInputView(props: VoiceTextInputViewProps) {
  const {
    value, onChange, submitLabel = DICTATION_COPY.submit, placeholder, multiline = false,
    lang = 'zh', disabled = false, testId = 'voice-input', className = '', state, actions, sayLabel = DICTATION_COPY.say, compact = false,
  } = props;
  const d = { ...actions, finalText: props.finalText, partialText: props.partialText, canSubmit: props.canSubmit, busy: state.phase === 'listening' || state.phase === 'finishing' };
  const controls = dictationControls(state);
  const typing = state.mode === 'type';
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const wasTyping = useRef(typing);

  // Into the box (✏️ Type / ✏️ Edit): focus it, caret at the end.
  useEffect(() => {
    if (typing && !wasTyping.current && !state.blocked) {
      const el = inputRef.current;
      if (el) {
        el.focus();
        const n = el.value.length;
        try { el.setSelectionRange(n, n); } catch { /* not a text input */ }
      }
    }
    wasTyping.current = typing;
  }, [typing, state.blocked]);

  // The compact box grows with its text, one line → four (then it scrolls).
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!compact || !typing || !el || el.tagName !== 'TEXTAREA') return;
    el.style.height = 'auto';
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 24;
    const padding = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const borders = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    el.style.height = `${Math.min(el.scrollHeight, line * 4 + padding) + borders}px`;
  }, [compact, typing, value]);

  const reviewPinyin = useMemo(
    () => (state.phase === 'review' && lang === 'zh' ? devicePinyinLine(d.finalText) : ''),
    [state.phase, lang, d.finalText],
  );

  const tid = (s: string) => `${testId}-${s}`;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const button = (key: string, label: string, icon: string, onClick: () => void, opts: { wide?: boolean; danger?: boolean; busy?: boolean; enabled?: boolean; aria?: string } = {}) => (
    <button
      key={key}
      type="button"
      className={`btn ${opts.wide ? (opts.danger ? 'btn-error' : 'btn-primary') : 'btn-secondary'} ${opts.wide ? 'voice-input-wide' : 'voice-input-side'}${opts.danger ? ' is-listening' : ''}`}
      onClick={(e) => { stop(e); if (opts.enabled === false || opts.busy) return; onClick(); }}
      aria-label={opts.aria ?? label}
      aria-disabled={opts.enabled === false || opts.busy || disabled || undefined}
      disabled={disabled}
      data-testid={tid(key)}
    >
      {opts.busy ? <span className="spinner voice-input-spinner" aria-hidden="true" /> : <span aria-hidden="true">{icon}</span>} {label}
    </button>
  );

  const renderRowControl = (c: (typeof controls)[number]) => {
    switch (c) {
      case 'type': return button('type', DICTATION_COPY.type, '✏️', d.type, { aria: 'Type instead' });
      case 'say': return button('say', sayLabel, '🎤', d.say, { wide: true });
      case 'cancel': return button('cancel', DICTATION_COPY.cancel, '✕', d.cancel);
      case 'stop': return button('stop', DICTATION_COPY.stop, '⏹', d.stop, { wide: true, danger: true, aria: 'Stop and use what I said' });
      case 'finishing': return button('finishing', DICTATION_COPY.finishing, '', () => {}, { wide: true, busy: true });
      case 'retake': return button('retake', DICTATION_COPY.retake, '🔁', d.retake, { wide: state.phase === 'failed' });
      case 'edit': return button('edit', DICTATION_COPY.edit, '✏️', d.edit, { aria: 'Edit what I said' });
      case 'submit': return button('submit', submitLabel, '✓', d.submit, { wide: true, enabled: d.canSubmit });
      default: return null;
    }
  };

  // ── typing ──
  if (typing) {
    const inputProps = {
      ref: inputRef,
      value,
      lang: lang === 'zh' ? 'zh-CN' : 'en',
      className: `form-input voice-input-box${multiline ? (compact ? ' voice-input-box--grow' : ' voice-input-box--multi') : ''}`,
      placeholder,
      disabled,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
      'data-testid': tid('text'),
    };
    return (
      <div className={`voice-input${compact ? ' voice-input--compact' : ''} ${className}`} data-testid={testId} data-mode="type">
        <div className="voice-input-typing-row">
          {multiline ? (
            <textarea {...inputProps} rows={compact ? 1 : 3} />
          ) : (
            <input
              {...inputProps}
              type="text"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); d.submit(); } }}
            />
          )}
          {controls.includes('mic') && (
            <button
              type="button"
              className="voice-input-mic"
              onClick={(e) => { stop(e); d.say(); }}
              aria-label={DICTATION_COPY.micLabel}
              disabled={disabled}
              data-testid={tid('mic')}
            >
              🎤
            </button>
          )}
          {compact && (
            <button
              type="button"
              className="voice-input-send"
              onClick={(e) => { stop(e); if (d.canSubmit) d.submit(); }}
              aria-label={submitLabel}
              aria-disabled={!d.canSubmit || disabled || undefined}
              disabled={disabled}
              data-testid={tid('submit')}
            >
              <span aria-hidden="true">➤</span>
            </button>
          )}
        </div>
        {state.blocked && <p className="voice-input-hint" data-testid={tid('blocked')} data-blocked={state.blocked}>{voiceBlockReason(state.blocked)}</p>}
        {compact ? (
          // The ➤ is in the box's row; extra buttons (a new chat's ✏️ Check · 🔍 Explain) get a row of their own.
          props.submitRowExtra && <div className="voice-input-row">{props.submitRowExtra}</div>
        ) : (
          <div className="voice-input-row">
            {button('submit', submitLabel, '✓', d.submit, { wide: true, enabled: d.canSubmit })}
            {props.submitRowExtra}
          </div>
        )}
      </div>
    );
  }

  // ── voice ──
  return (
    <div className={`voice-input${compact ? ' voice-input--compact' : ''} ${className}`} data-testid={testId} data-mode="voice" data-phase={state.phase}>
      {d.busy && (
        <div className="form-input voice-input-live" data-testid={tid('live')} aria-live="polite" lang={lang === 'zh' ? 'zh-CN' : 'en'}>
          {d.finalText || d.partialText ? (
            <>
              <span className="voice-input-final">{d.finalText}</span>
              <span className="voice-input-interim">{d.partialText}</span>
            </>
          ) : (
            <span className="voice-input-placeholder">
              {state.phase === 'finishing' ? DICTATION_COPY.finishing : props.listeningPlaceholder ?? DICTATION_COPY.listening}
            </span>
          )}
        </div>
      )}
      {state.phase === 'review' && (
        <div className="voice-input-review" data-testid={tid('review')} aria-live="polite">
          <div
            lang={lang === 'zh' ? 'zh-CN' : 'en'}
            className={`voice-input-review-text${lang === 'zh' ? ' hanzi' : ''}${Array.from(d.finalText).length > 12 ? ' is-long' : ''}`}
            data-testid={tid('review-text')}
          >
            {d.finalText}
          </div>
          {reviewPinyin && <div className="pinyin voice-input-review-pinyin" data-testid={tid('review-pinyin')}>{reviewPinyin}</div>}
        </div>
      )}
      {controls.includes('retry_upload') && (
        <button
          type="button"
          className="transcription-result voice-input-failed"
          data-testid={tid('retry-upload')}
          onClick={(e) => { stop(e); d.retryUpload(); }}
        >
          {state.failure === 'offline' ? DICTATION_COPY.offline : state.failure === 'signed_out' ? SIGNED_OUT_TRANSCRIPTION : DICTATION_COPY.failed}
          <span className="voice-input-failed-note">{DICTATION_COPY.failedNote}</span>
        </button>
      )}
      <div className="voice-input-row">{controls.map(renderRowControl)}</div>
      {state.phase === 'failed' && state.failure === 'empty' && (
        <p className="voice-input-hint" data-testid={tid('empty')}>{DICTATION_COPY.empty}</p>
      )}
    </div>
  );
}
