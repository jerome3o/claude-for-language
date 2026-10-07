import { useEffect, useState } from 'react';
import { CONVERSATION_DELIVERIES, DELIVERY_LABELS, clampConversationRate, type ConversationDelivery } from '@shared/tts';
import { getConversationAudio, updateConversationAudio, type ConversationAudioView } from '../../api/client';
import { writeConversationAudio } from '../../services/conversationAudio';
import { track } from '../../services/analytics';
import './ConversationAudioSheet.css';

/**
 * Settings → Conversation voices: the account's conversation speed and
 * delivery (the same preferences as the ⚙︎ Audio menu on an exercise).
 */
export function ConversationAudioDefaults() {
  const [view, setView] = useState<ConversationAudioView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getConversationAudio().then(setView).catch(() => setError('Speed settings need a connection'));
  }, []);

  async function save(update: Record<string, unknown>) {
    setError(null);
    try {
      const v = await updateConversationAudio(update);
      setView(v);
      writeConversationAudio({ prefs: v.prefs, provider: v.provider, provider_name: v.provider_name, default_speed: v.default_speed });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save — check your connection');
    }
  }

  if (!view) return error ? <p className="convo-audio-hint">{error}</p> : null;
  const speed = clampConversationRate(view.provider, view.prefs.speed ?? view.default_speed);
  const isDefault = view.prefs.speed === null;

  return (
    <section className="convo-audio-defaults" data-testid="conversation-audio-defaults">
      <div className="convo-audio-group">
        <div className="convo-audio-label">
          Conversation speed <span className="convo-audio-value">{speed}×{isDefault ? ' (default)' : ''}</span>
        </div>
        <div className="convo-audio-chips" role="radiogroup" aria-label="Conversation speed">
          {view.speed_steps.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={speed === s}
              className={`convo-audio-chip ${speed === s ? 'on' : ''}`}
              onClick={() => { track('lesson.conversation_audio_speed', { speed: s, provider: view.provider, source: 'settings' }); void save({ speed: s }); }}
            >
              {s}×
            </button>
          ))}
          {!isDefault && (
            <button type="button" className="convo-audio-chip" onClick={() => void save({ speed: null })}>Default</button>
          )}
        </div>
        <p className="convo-audio-hint">
          Audio comes from {view.provider_name} right now; 1× is its natural pace. Change it, the voices and the
          delivery on any conversation with ⚙︎.
        </p>
      </div>
      <div className="convo-audio-group">
        <div className="convo-audio-label">Delivery</div>
        <div className="convo-audio-chips" role="radiogroup" aria-label="Delivery">
          {CONVERSATION_DELIVERIES.map((d: ConversationDelivery) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={view.prefs.delivery === d}
              className={`convo-audio-chip ${view.prefs.delivery === d ? 'on' : ''}`}
              onClick={() => { track('lesson.conversation_audio_delivery', { delivery: d, provider: view.provider, source: 'settings' }); void save({ delivery: d }); }}
            >
              {DELIVERY_LABELS[d]}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="convo-audio-error">{error}</p>}
    </section>
  );
}
