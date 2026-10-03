/**
 * Settings → Conversation voices (`/settings/voices`): every voice a
 * two-voice conversation exercise can be spoken in, with a ▶ sample (made
 * once server-side, cached on the device) and an on/off switch. At least one
 * female and one male voice stay on. An account that hasn't chosen plays the
 * admin's selection; the admin's own choice is that default.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  validateConversationVoiceSelection,
  type ConversationVoice,
  type LessonVoice,
  type VoiceAccent,
  type VoiceAge,
  type VoiceStyle,
} from '@shared/lesson';
import {
  getConversationVoiceSample,
  getLessonConversationVoices,
  saveLessonConversationVoices,
  type LessonConversationVoiceSettings,
} from '../api/client';
import { InlineNotice, type Notice } from '../components/chat/InlineNotice';
import { writeConversationVoices } from '../services/conversationVoices';
import { base64ToBlob } from '../services/ttsCache';
import { cacheAudio, getCachedAudio } from '../services/audioCache';
import { createAudioPlayer } from '../utils/audioPlayback';
import { track } from '../services/analytics';
import './ConversationVoicesPage.css';

const AGE: Record<VoiceAge, string> = { child: 'Child', young: 'Young', adult: 'Adult', senior: 'Older' };
const STYLE: Record<VoiceStyle, string> = {
  newsreader: 'Newsreader', neutral: 'Neutral', warm: 'Warm', youthful: 'Youthful', soft: 'Soft / breathy', character: 'Character',
};
const ACCENT: Record<VoiceAccent, string> = { standard: 'Standard Mandarin', southern: 'Southern accent', hong_kong: 'Hong Kong accent' };
const FAMILY = { mandarin: 'Mandarin series', classic: 'Classic series' } as const;

type GenderFilter = 'all' | LessonVoice;

/** The meta line under a voice's name. */
function voiceMeta(v: ConversationVoice): string {
  return [AGE[v.age], STYLE[v.style], ACCENT[v.accent], FAMILY[v.family]].join(' · ');
}

const sampleKey = (id: string) => `voice-sample/v1/${id}`;

export function ConversationVoicesPage() {
  const [data, setData] = useState<LessonConversationVoiceSettings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [gender, setGender] = useState<GenderFilter>('all');
  const [style, setStyle] = useState<VoiceStyle | 'all'>('all');
  const [accent, setAccent] = useState<VoiceAccent | 'all'>('all');
  const [onlyOn, setOnlyOn] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loadingSample, setLoadingSample] = useState<string | null>(null);
  const playerRef = useRef(createAudioPlayer());
  const saveSeq = useRef(0);

  const load = useCallback(() => {
    setLoadError(null);
    getLessonConversationVoices()
      .then(d => { setData(d); setEnabled(d.enabled); writeConversationVoices(d.enabled); })
      .catch(err => setLoadError(err instanceof Error ? err.message : 'Could not load the voices'));
  }, []);

  useEffect(() => {
    load();
    const player = playerRef.current;
    return () => player.dispose();
  }, [load]);

  const dismiss = useCallback(() => setNotice(null), []);

  async function save(next: string[] | null) {
    const seq = ++saveSeq.current;
    const previous = enabled;
    if (next) setEnabled(next);
    try {
      const saved = await saveLessonConversationVoices(next);
      if (seq !== saveSeq.current) return;
      setData(saved);
      setEnabled(saved.enabled);
      writeConversationVoices(saved.enabled);
      track('settings.change', { setting: 'voices', value: next ? saved.enabled.length : 'default' });
      if (!next) setNotice({ kind: 'success', text: 'Back to the default voices' });
    } catch (err) {
      if (seq !== saveSeq.current) return;
      setEnabled(previous);
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Could not save — check your connection' });
    }
  }

  function toggle(id: string) {
    const on = enabled.includes(id);
    const next = on ? enabled.filter(x => x !== id) : [...enabled, id];
    const { enabled: cleaned, problems } = validateConversationVoiceSelection(next);
    if (problems.length) {
      setNotice({ kind: 'info', text: problems[0] });
      return;
    }
    void save(cleaned);
  }

  async function playSample(id: string) {
    const player = playerRef.current;
    if (playing === id) {
      player.stop();
      setPlaying(null);
      return;
    }
    setLoadingSample(id);
    try {
      let blob = await getCachedAudio(sampleKey(id));
      if (!blob) {
        const res = await getConversationVoiceSample(id);
        blob = base64ToBlob(res.audio_base64, res.content_type);
        await cacheAudio(sampleKey(id), blob).catch(() => {});
      }
      setPlaying(id);
      player.play(blob, {
        label: 'voice-sample',
        onEnded: () => setPlaying(p => (p === id ? null : p)),
        onError: () => setPlaying(p => (p === id ? null : p)),
      });
    } catch (err) {
      setNotice({
        kind: 'error',
        text: navigator.onLine
          ? `No sample for this voice: ${err instanceof Error ? err.message : 'it could not be generated'}`
          : 'Samples need a connection the first time',
      });
    } finally {
      setLoadingSample(null);
    }
  }

  const voices = data?.voices ?? [];
  const styles = useMemo(() => [...new Set(voices.map(v => v.style))], [voices]);
  const accents = useMemo(() => [...new Set(voices.map(v => v.accent))], [voices]);
  const shown = voices.filter(v =>
    (gender === 'all' || v.gender === gender)
    && (style === 'all' || v.style === style)
    && (accent === 'all' || v.accent === accent)
    && (!onlyOn || enabled.includes(v.id)));
  const groups: Array<{ gender: LessonVoice; title: string }> = [
    { gender: 'female', title: 'Female voices' },
    { gender: 'male', title: 'Male voices' },
  ];
  const onCount = (g: LessonVoice) => voices.filter(v => v.gender === g && enabled.includes(v.id)).length;

  return (
    <div className="page">
      <div className="container voices-page">
        <div className="voices-header">
          <Link to="/settings" className="voices-back">← Settings</Link>
          <h1>Conversation voices</h1>
          <p className="voices-intro">
            The voices that speak the two-person conversations in your lessons. Tap ▶ to hear one;
            switch off any you don’t want. At least one female and one male voice stay on.
          </p>
          {data && (
            <p className="voices-scope" data-testid="voices-scope">
              {data.is_admin
                ? 'You’re the admin: your choice is the default for everyone who hasn’t picked their own.'
                : data.customised
                  ? 'Using your own choice.'
                  : data.default_source === 'admin'
                    ? 'Using the default chosen by the admin.'
                    : 'Using the app’s default voices.'}
              {' '}Conversations play at {data.speed}× speed with a short pause between speakers.
            </p>
          )}
        </div>

        <InlineNotice notice={notice} onDismiss={dismiss} />

        {loadError && (
          <div className="voices-error">
            <p>{loadError}</p>
            <button className="btn btn-secondary" onClick={load}>Try again</button>
          </div>
        )}
        {!data && !loadError && <p className="voices-muted">Loading…</p>}

        {data && (
          <>
            <div className="voices-filters">
              <div className="voices-segment" role="group" aria-label="Gender">
                {(['all', 'female', 'male'] as const).map(g => (
                  <button
                    key={g}
                    type="button"
                    className={`voices-chip${gender === g ? ' active' : ''}`}
                    aria-pressed={gender === g}
                    onClick={() => setGender(g)}
                  >
                    {g === 'all' ? 'All' : g === 'female' ? '👩 Female' : '👨 Male'}
                  </button>
                ))}
                <button
                  type="button"
                  className={`voices-chip${onlyOn ? ' active' : ''}`}
                  aria-pressed={onlyOn}
                  onClick={() => setOnlyOn(v => !v)}
                >
                  On only
                </button>
              </div>
              <div className="voices-selects">
                <label>
                  <span>Style</span>
                  <select value={style} onChange={e => setStyle(e.target.value as VoiceStyle | 'all')}>
                    <option value="all">Any style</option>
                    {styles.map(s => <option key={s} value={s}>{STYLE[s]}</option>)}
                  </select>
                </label>
                <label>
                  <span>Accent</span>
                  <select value={accent} onChange={e => setAccent(e.target.value as VoiceAccent | 'all')}>
                    <option value="all">Any accent</option>
                    {accents.map(a => <option key={a} value={a}>{ACCENT[a]}</option>)}
                  </select>
                </label>
              </div>
            </div>

            {groups.map(({ gender: g, title }) => {
              const rows = shown.filter(v => v.gender === g);
              if (!rows.length) return null;
              return (
                <section key={g} className="voices-group" aria-label={title}>
                  <h2 className="voices-group-title">
                    {title} <span className="voices-group-count">{onCount(g)} on</span>
                  </h2>
                  <ul className="voices-list">
                    {rows.map(v => {
                      const on = enabled.includes(v.id);
                      const last = on && onCount(v.gender) === 1;
                      return (
                        <li key={v.id} className={`voices-row${on ? ' on' : ''}`}>
                          <button
                            type="button"
                            className={`voices-play${playing === v.id ? ' playing' : ''}`}
                            onClick={() => void playSample(v.id)}
                            aria-label={`${playing === v.id ? 'Stop' : 'Play'} a sample of ${v.name}`}
                            disabled={loadingSample === v.id}
                          >
                            {loadingSample === v.id ? '…' : playing === v.id ? '■' : '▶'}
                          </button>
                          <div className="voices-text">
                            <div className="voices-name">{v.name}</div>
                            <div className="voices-meta">{voiceMeta(v)}</div>
                            <div className="voices-note">{v.note}</div>
                          </div>
                          <label className={`voices-switch${last ? ' locked' : ''}`} title={last ? 'The last voice of its kind stays on' : undefined}>
                            <input
                              type="checkbox"
                              role="switch"
                              checked={on}
                              onChange={() => toggle(v.id)}
                              aria-label={`Use ${v.name} in conversations`}
                            />
                            <span className="voices-switch-track" aria-hidden="true"><span className="voices-switch-thumb" /></span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
            {!shown.length && <p className="voices-muted">No voices match these filters.</p>}

            {data.customised && !data.is_admin && (
              <div className="voices-reset">
                <button className="btn btn-secondary" onClick={() => void save(null)}>Use the default voices</button>
              </div>
            )}
            {data.is_admin && data.customised && (
              <div className="voices-reset">
                <button className="btn btn-secondary" onClick={() => void save(null)}>Back to the app’s shipped defaults</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
