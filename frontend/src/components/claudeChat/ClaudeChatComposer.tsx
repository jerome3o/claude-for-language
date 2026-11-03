/**
 * A Claude chat's composer — the voice-first box (🎤 Say it → review → Send, ✏️ Type a tap away;
 * components/voice/VoiceTextInput); no deck picker. Context-agnostic. Send = Ask. With `composer`
 * (shared/claude/contexts.ts `composerFor`, a new general chat) the other intents for what is in the
 * box sit under it — ✏️ Check · 🔍 Explain for Chinese, 🔤 Translate for English — with the hint.
 * A spoken message that failed to send goes into the box (typing) so it can be fixed or sent again.
 */
import { useEffect } from 'react';
import type { AskLanguage } from '@shared/study/askClaude';
import type { ClaudeIntent } from '@shared/claude/context';
import { CLAUDE_INTENT_LABELS, type ClaudeComposer } from '@shared/claude/contexts';
import { COACH_ASK_PLACEHOLDER_EN, COACH_ASK_PLACEHOLDER_ZH } from '@shared/coach/askChat';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';
import { VoiceTextInputView } from '../voice/VoiceTextInput';
import { enterToSubmit } from '../voice/enterToSubmit';

export function ClaudeChatComposer({ value, onChange, onSend, busy, failed, language, online, surface = 'claude_chat', composer, placeholder }: {
  value: string;
  onChange: (value: string) => void;
  /** `spoken` = sent from the review of a take; `intent` = one of the other buttons (default Ask). */
  onSend: (text: string, spoken: boolean, intent?: ClaudeIntent) => void;
  /** Which intents the box offers for a text (a new general chat: Ask + Check / Explain / Translate). */
  composer?: (text: string) => ClaudeComposer;
  placeholder?: string;
  /** Sending, or Claude is still answering. */
  busy: boolean;
  /** The last send failed: back to typing with the text kept. */
  failed: boolean;
  language: AskLanguage;
  online: boolean;
  surface?: string;
}) {
  const voice = useVoiceDictation({
    surface,
    value,
    onChange,
    lang: language === 'en' ? 'en' : 'zh',
    online,
    onSubmit: (answer) => {
      onChange(answer.text);
      onSend(answer.text, answer.source === 'spoken');
    },
  });
  const voiceIdle = voice.state.mode === 'voice' && voice.state.phase === 'idle';
  // What a Check / Explain / Translate button would send: the take under review, else the box.
  const current = (voice.state.mode === 'voice' ? voice.finalText || value : value).trim();
  const c = composer?.(current);
  const others = c ? c.intents.filter((i) => i !== 'ask') : [];
  useEffect(() => {
    if (failed && value.trim() && voiceIdle) voice.type();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed]);
  return (
    <div className="claude-chat-composer" data-testid="claude-chat-composer" onKeyDown={enterToSubmit(voice.submit)}>
      <VoiceTextInputView
        value={value}
        onChange={onChange}
        placeholder={placeholder ?? (language === 'zh' ? COACH_ASK_PLACEHOLDER_ZH : COACH_ASK_PLACEHOLDER_EN)}
        listeningPlaceholder={language === 'zh' ? '在听… 用中文问吧 (or English)' : 'Listening… ask anything'}
        submitLabel={busy ? '…' : 'Send'}
        multiline
        lang={language === 'en' ? 'en' : 'zh'}
        disabled={busy}
        testId="claude-chat-voice"
        className="ask-voice"
        state={voice.state}
        finalText={voice.finalText}
        partialText={voice.partialText}
        canSubmit={voice.canSubmit}
        actions={voice}
      />
      {others.length > 0 && (
        <div className="claude-composer-intents" role="group" aria-label="Or" data-testid="claude-composer-intents">
          {others.map((intent) => (
            <button
              key={intent}
              type="button"
              disabled={!c!.enabled || busy || !current}
              onClick={() => {
                onChange(current);
                onSend(current, voice.state.mode === 'voice' && !!voice.finalText, intent);
              }}
              data-testid={`claude-composer-${intent}`}
            >
              {CLAUDE_INTENT_LABELS[intent]}
            </button>
          ))}
        </div>
      )}
      {c?.hint && current && <p className="claude-composer-hint">{c.hint}</p>}
    </div>
  );
}
