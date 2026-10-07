import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  speakerGender,
  speakerVoiceUpdate,
  type ConversationSpeaker,
  type ResolvedConversationAudio,
} from '@shared/lesson';
import {
  CONVERSATION_DELIVERIES,
  DELIVERY_LABELS,
  TTS_PROVIDER_NAMES,
  conversationProviderVoices,
  conversationSpeedSteps,
  supportedDeliveries,
  type ConversationDelivery,
} from '@shared/tts';
import { getConversationAudio, updateConversationAudio, type ConversationAudioView } from '../../api/client';
import { applyConversationAudioUpdate, readConversationAudio, writeConversationAudio } from '../../services/conversationAudio';
import { useNetwork } from '../../contexts/NetworkContext';
import { track } from '../../services/analytics';
import './ConversationAudioSheet.css';

/**
 * ⚙︎ Audio on a conversation exercise (docs/AUDIO.md "Conversation audio"):
 * speed, a voice per speaker, delivery, and "Regenerate audio". Changes apply
 * on this device at once (cached prefs → new clip keys) and are saved to the
 * account, so they carry to every conversation and the other app. Offline the
 * sheet shows the current settings and says regenerating needs internet —
 * playback keeps using whatever is cached.
 */
export function ConversationAudioSheet({
  speakers,
  audio,
  regenerating,
  onRegenerate,
  onClose,
}: {
  speakers: ConversationSpeaker[];
  audio: ResolvedConversationAudio;
  regenerating: boolean;
  onRegenerate: () => void;
  onClose: () => void;
}) {
  const { isOnline } = useNetwork();
  const [view, setView] = useState<ConversationAudioView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const provider = audio.provider;

  useEffect(() => {
    track('lesson.conversation_audio_open', { provider });
    if (!isOnline) return;
    let live = true;
    getConversationAudio()
      .then((v) => {
        if (!live) return;
        setView(v);
        writeConversationAudio({ prefs: v.prefs, provider: v.provider, provider_name: v.provider_name, default_speed: v.default_speed });
      })
      .catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Offline (or before the server answers): the catalogue bundled with the app.
  const voices = view?.voices ?? conversationProviderVoices(provider).map((v) => ({ ...v, deliveries: supportedDeliveries(provider, v.id) }));
  const steps = view?.speed_steps ?? conversationSpeedSteps(provider);
  const isDefaultSpeed = readConversationAudio().prefs.speed === null;

  async function save(update: Record<string, unknown>) {
    setError(null);
    applyConversationAudioUpdate(update);
    if (!isOnline) return;
    try {
      const v = await updateConversationAudio(update);
      setView(v);
      writeConversationAudio({ prefs: v.prefs, provider: v.provider, provider_name: v.provider_name, default_speed: v.default_speed });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save — it applies on this device only for now');
    }
  }

  function setSpeed(speed: number | null) {
    track('lesson.conversation_audio_speed', { speed: speed ?? 0, provider, source: 'exercise' });
    void save({ speed });
  }

  function setVoice(index: number, voice: string | null) {
    track('lesson.conversation_audio_voice', { provider, gender: speakerGender(speakers, index), automatic: voice === null });
    void save(speakerVoiceUpdate(audio, speakers, index, voice, readConversationAudio().prefs));
  }

  function setDelivery(delivery: ConversationDelivery) {
    track('lesson.conversation_audio_delivery', { delivery, provider, source: 'exercise' });
    void save({ delivery });
  }

  const deliveryNote = (d: ConversationDelivery): string | null => {
    if (d === 'natural') return null;
    const can = audio.voices.filter((v) => supportedDeliveries(provider, v).includes(d)).length;
    if (can === audio.voices.length) return null;
    return can === 0 ? 'these voices speak it naturally' : 'some voices only';
  };

  // A portal: the player's containers make stacking contexts that would put the sheet under fixed buttons.
  return createPortal(
    <>
      <div className="convo-audio-backdrop" onClick={onClose} role="presentation" />
      <div className="convo-audio-sheet" role="dialog" aria-label="Conversation audio" data-testid="conversation-audio-sheet">
        <div className="convo-audio-grip" aria-hidden="true" />
        <div className="convo-audio-title">
          Audio <span className="convo-audio-provider">· {view?.provider_name ?? TTS_PROVIDER_NAMES[provider]}</span>
        </div>
        {!isOnline && (
          <p className="convo-audio-offline" data-testid="conversation-audio-offline">
            Offline — changes need internet to make new audio. The conversation plays what is already on this device.
          </p>
        )}

        <div className="convo-audio-group">
          <div className="convo-audio-label">
            Speed <span className="convo-audio-value">{audio.speed}×{isDefaultSpeed ? ' (default)' : ''}</span>
          </div>
          <div className="convo-audio-chips" role="radiogroup" aria-label="Speed">
            {steps.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={audio.speed === s}
                className={`convo-audio-chip ${audio.speed === s ? 'on' : ''}`}
                disabled={!isOnline}
                onClick={() => setSpeed(s)}
                data-testid={`convo-speed-${s}`}
              >
                {s}×
              </button>
            ))}
            {!isDefaultSpeed && (
              <button type="button" className="convo-audio-chip" disabled={!isOnline} onClick={() => setSpeed(null)}>
                Default
              </button>
            )}
          </div>
          <p className="convo-audio-hint">1× is the voice's natural pace. Slower than {steps[0]}× sounds stretched with this provider, so it isn't offered.</p>
        </div>

        <div className="convo-audio-group">
          <div className="convo-audio-label">Voices</div>
          {speakers.map((sp, i) => {
            const g = speakerGender(speakers, i);
            const others = new Set(audio.voices.filter((_, j) => j !== i));
            const own = voices.filter((v) => v.gender === g);
            const rest = voices.filter((v) => v.gender !== g);
            const auto = voices.find((v) => v.id === audio.auto_voices[i]);
            return (
              <label key={i} className="convo-audio-speaker">
                <span className="convo-audio-speaker-name">{g === 'male' ? '👨' : '👩'} {sp.name}</span>
                <select
                  value={audio.chosen[i] ? audio.voices[i] : ''}
                  disabled={!isOnline}
                  onChange={(e) => setVoice(i, e.target.value || null)}
                  data-testid={`convo-voice-${i}`}
                >
                  <option value="">Automatic{auto ? ` (${auto.name})` : ''}</option>
                  {[{ label: g === 'female' ? 'Female voices' : 'Male voices', list: own }, { label: g === 'female' ? 'Male voices' : 'Female voices', list: rest }].map((grp) => (
                    <optgroup key={grp.label} label={grp.label}>
                      {grp.list.map((v) => (
                        <option key={v.id} value={v.id} disabled={others.has(v.id)}>
                          {v.name}{v.note ? ` — ${v.note}` : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            );
          })}
          <p className="convo-audio-hint">A voice picked for the first woman or man here is used in every conversation.</p>
        </div>

        <div className="convo-audio-group">
          <div className="convo-audio-label">Delivery</div>
          <div className="convo-audio-chips" role="radiogroup" aria-label="Delivery">
            {CONVERSATION_DELIVERIES.map((d) => {
              const note = deliveryNote(d);
              return (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={audio.delivery === d}
                  className={`convo-audio-chip ${audio.delivery === d ? 'on' : ''}`}
                  disabled={!isOnline}
                  onClick={() => setDelivery(d)}
                  title={note ?? undefined}
                  data-testid={`convo-delivery-${d}`}
                >
                  {DELIVERY_LABELS[d]}
                  {note && <span className="convo-audio-chip-note"> · {note}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {error && <p className="convo-audio-error">{error}</p>}

        <div className="sheet-footer convo-audio-footer">
          <button
            type="button"
            className="practice-btn"
            onClick={onRegenerate}
            disabled={!isOnline || regenerating}
            data-testid="convo-regenerate"
          >
            {regenerating ? 'Making new audio…' : isOnline ? '↻ Regenerate audio' : '↻ Regenerate (needs internet)'}
          </button>
          <button type="button" className="practice-btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </>,
    document.body,
  );
}
