/**
 * A Claude chat's composer — just the voice-first box (🎤 Say it → review → Send, ✏️ Type a tap away;
 * components/voice/VoiceTextInput) and nothing around it: no deck picker, no chips. Context-agnostic.
 * A spoken message that failed to send goes into the box (typing) so it can be fixed or sent again.
 */
import { useEffect } from 'react';
import type { AskLanguage } from '@shared/study/askClaude';
import { COACH_ASK_PLACEHOLDER_EN, COACH_ASK_PLACEHOLDER_ZH } from '@shared/coach/askChat';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';
import { VoiceTextInputView } from '../voice/VoiceTextInput';
import { enterToSubmit } from '../voice/enterToSubmit';

export function ClaudeChatComposer({ value, onChange, onSend, busy, failed, language, online, surface = 'claude_chat' }: {
  value: string;
  onChange: (value: string) => void;
  /** `spoken` = sent from the review of a take. */
  onSend: (text: string, spoken: boolean) => void;
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
  useEffect(() => {
    if (failed && value.trim() && voiceIdle) voice.type();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed]);
  return (
    <div className="claude-chat-composer" data-testid="claude-chat-composer" onKeyDown={enterToSubmit(voice.submit)}>
      <VoiceTextInputView
        value={value}
        onChange={onChange}
        placeholder={language === 'zh' ? COACH_ASK_PLACEHOLDER_ZH : COACH_ASK_PLACEHOLDER_EN}
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
    </div>
  );
}
