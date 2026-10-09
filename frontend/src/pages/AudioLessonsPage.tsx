import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useNetwork } from '../contexts/NetworkContext';
import {
  AUDIO_LESSON_FORMAT_INFO, AUDIO_LESSON_INPUT_LIMITS, audioLessonFormatInfo, durationLabel, storyEstimateLine,
  type AudioLessonFormat, type AudioLessonSummary,
} from '@shared/audio-lesson';
import { createAudioLesson, retryAudioLesson } from '../api/audioLessons';
import {
  cachedLessonList, deleteLessonEverywhere, formatMb, refreshLessonList, rememberLessonInList, savedLessonIds,
} from '../services/audioLessons';
import { track, trackError } from '../services/analytics';
import './AudioLessonsPage.css';
import { companionBadge } from '@shared/lesson';
import '../components/lesson/ReadyToUnlock.css';

/** One tap instead of thinking a situation up. */
const SITUATIONS: Array<{ zh: string; en: string }> = [
  { zh: '兰州拉面', en: 'Ordering at a Lanzhou beef noodle shop' },
  { zh: '打车', en: 'Taking a taxi and giving directions' },
  { zh: '看医生', en: 'Seeing a doctor about a cold' },
  { zh: '租房子', en: 'Asking about renting a flat' },
  { zh: '买火车票', en: 'Buying a high-speed train ticket' },
  { zh: '寄快递', en: 'Sending a parcel at the courier counter' },
];

const FORMATS: Array<{ id: AudioLessonFormat; blurb: string }> = [
  { id: 'dialogue', blurb: 'An English host, a short Chinese dialogue played three times, then the new words explained.' },
  { id: 'sleep', blurb: 'Very slow and calm Chinese over soft music: the new words from a text, each said three times, its tones, its meaning told again and again in simple Chinese, one English line to check — then simple sentences, each with its English.' },
  { id: 'story', blurb: 'Paste a longer story or conversation: each line or two is said three times, slowly, with a pause after each, then its English — over soft music, for background listening. As long as your text.' },
];


export function statusLine(l: AudioLessonSummary): string {
  switch (l.status) {
    case 'queued':
      return 'Waiting to start…';
    case 'writing':
      return l.progress || 'Claude is writing the lesson…';
    case 'speaking':
      return l.progress_total ? `Recording ${l.progress_done ?? 0} of ${l.progress_total} clips…` : 'Recording…';
    case 'rendering':
      return 'Putting it together…';
    case 'failed':
      return l.error || 'Something went wrong';
    case 'ready':
      return [l.duration_ms ? durationLabel(l.duration_ms) : null, l.word_count ? `${l.word_count} words` : null, formatMb(l.size_bytes) || null].filter(Boolean).join(' · ');
  }
}

export function AudioLessonsPage() {
  const navigate = useNavigate();
  const { isOnline } = useNetwork();
  const [lessons, setLessons] = useState<AudioLessonSummary[]>(() => cachedLessonList());
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<AudioLessonFormat>('dialogue');
  const [description, setDescription] = useState('');
  const [dialogue, setDialogue] = useState('');
  const [showDialogue, setShowDialogue] = useState(false);
  const [text, setText] = useState('');
  const [storyText, setStoryText] = useState('');
  const [storyTitle, setStoryTitle] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<number>(AUDIO_LESSON_INPUT_LIMITS.defaultMinutes.dialogue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    void savedLessonIds().then(setSaved);
    if (!navigator.onLine) return;
    try {
      setLessons(await refreshLessonList());
    } catch (err) {
      console.warn('[AudioLessons] refresh failed', err);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Lessons are made in the background; keep the list moving while any are.
  const building = lessons.some((l) => l.status !== 'ready' && l.status !== 'failed');
  useEffect(() => {
    if (!building || !isOnline) return;
    const t = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(t);
  }, [building, isOnline, refresh]);

  function pickFormat(f: AudioLessonFormat) {
    setFormat(f);
    setMinutes(AUDIO_LESSON_INPUT_LIMITS.defaultMinutes[f]);
    setError(null);
    setNotice(null);
  }

  async function start() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await createAudioLesson(
        format === 'dialogue'
          ? { format, description: description.trim(), dialogue: dialogue.trim() || undefined, target_minutes: minutes }
          : format === 'sleep'
            ? { format, text: text.trim(), target_minutes: minutes }
            // A story is as long as its text: no target length.
            : { format, text: storyText.trim(), title: storyTitle.trim() || undefined },
      );
      const { lesson } = res;
      track('audio_lesson.create', format === 'story' ? { format, chunks: res.chunks ?? 0 } : { format, target_minutes: minutes });
      rememberLessonInList(lesson);
      setLessons(cachedLessonList());
      setNotice(res.notice ?? null);
      setDescription('');
      setDialogue('');
      setText('');
      setStoryText('');
      setStoryTitle('');
    } catch (err) {
      trackError('audio_lesson_create', err);
      setError(err instanceof Error ? err.message : "Couldn't start it — check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function retry(id: string) {
    setError(null);
    try {
      await retryAudioLesson(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed');
    }
  }

  async function remove(l: AudioLessonSummary) {
    if (!confirm(`Delete "${l.title}"?`)) return;
    try {
      await deleteLessonEverywhere(l.id);
      setLessons(cachedLessonList());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  const ready =
    format === 'dialogue' ? description.trim().length > 0 || dialogue.trim().length > 0 : format === 'sleep' ? text.trim().length > 0 : storyText.trim().length > 0;
  const canStart = isOnline && !busy && ready;
  const L = AUDIO_LESSON_INPUT_LIMITS;

  return (
    <div className="container al-page">
      <h1 className="al-title">🎧 Audio lessons</h1>
      <p className="al-blurb">
        Lessons to listen to — on the train, in the background, or to fall asleep to. Claude writes each one for you, checking it against
        your cards, and the app records it as one audio file you can keep offline.{' '}
        <Link to="/settings#podcast-feed" className="al-podcast-link" data-testid="al-podcast-link">Listen in a podcast app →</Link>
      </p>

      <div className="al-new-card">
        <div className="al-formats" role="radiogroup" aria-label="Kind of lesson">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              role="radio"
              aria-checked={format === f.id}
              className={`al-format ${format === f.id ? 'active' : ''}`}
              onClick={() => pickFormat(f.id)}
              data-testid={`al-format-${f.id}`}
            >
              <span className="al-format-icon" aria-hidden>{AUDIO_LESSON_FORMAT_INFO[f.id].icon}</span>
              <span className="al-format-label">{AUDIO_LESSON_FORMAT_INFO[f.id].label}</span>
              <span className="al-format-short">{AUDIO_LESSON_FORMAT_INFO[f.id].short}</span>
            </button>
          ))}
        </div>
        <p className="al-format-blurb" aria-live="polite">{FORMATS.find((f) => f.id === format)?.blurb}</p>

        {format === 'dialogue' ? (
          <>
            <label className="form-label" htmlFor="al-description">What situation do you want to practise?</label>
            <textarea
              id="al-description"
              className="form-input al-textarea"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Ordering at a Lanzhou noodle shop — thick or thin noodles, less chilli"
              maxLength={L.description}
            />
            <div className="al-chips">
              {SITUATIONS.map((s) => (
                <button key={s.zh} type="button" className="al-chip" onClick={() => setDescription(s.en)}>{s.zh}</button>
              ))}
            </div>
            {showDialogue ? (
              <>
                <label className="form-label" htmlFor="al-dialogue">A dialogue to build it on (optional)</label>
                <textarea
                  id="al-dialogue"
                  className="form-input al-textarea"
                  rows={5}
                  value={dialogue}
                  onChange={(e) => setDialogue(e.target.value)}
                  placeholder={'A：你好，吃什么？\nB：我要一碗牛肉面。'}
                  maxLength={L.dialogue}
                />
              </>
            ) : (
              <button type="button" className="al-link" onClick={() => setShowDialogue(true)}>+ Paste a dialogue</button>
            )}
          </>
        ) : format === 'story' ? (
          <>
            <label className="form-label" htmlFor="al-story-text">Paste a story or a conversation</label>
            <textarea
              id="al-story-text"
              className="form-input al-textarea"
              rows={8}
              value={storyText}
              onChange={(e) => setStoryText(e.target.value)}
              placeholder={'明慧：你好！你今天想喝什么？\n杰罗姆：我要一杯热咖啡，不要糖。\n…\n\nSpeaker labels (A：, 明慧：) get their own voices; headings (# …) become chapters.'}
              maxLength={L.storyText}
              lang="zh-CN"
            />
            <div className="al-fine">
              {storyText.length.toLocaleString()} / {L.storyText.toLocaleString()} characters · <span data-testid="al-story-estimate">{storyEstimateLine(storyText)}</span>
            </div>
            <label className="form-label" htmlFor="al-story-title">Title (optional)</label>
            <input
              id="al-story-title"
              className="form-input"
              value={storyTitle}
              onChange={(e) => setStoryTitle(e.target.value)}
              placeholder="From the first heading or line if empty"
              maxLength={120}
            />
          </>
        ) : (
          <>
            <label className="form-label" htmlFor="al-text">Paste some Chinese — an article, a story, a chat</label>
            <textarea
              id="al-text"
              className="form-input al-textarea"
              rows={7}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Claude finds the words you don't know yet and teaches them slowly in Chinese, with one English line per word."
              maxLength={L.text}
              lang="zh-CN"
            />
            <div className="al-fine">{text.length.toLocaleString()} / {L.text.toLocaleString()} characters</div>
          </>
        )}

        {format !== 'story' && (
          <>
            <label className="form-label" htmlFor="al-minutes">Length: about {minutes} minutes</label>
            <input
              id="al-minutes"
              type="range"
              className="al-range"
              min={L.minMinutes}
              max={L.maxMinutes}
              step={1}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </>
        )}

        <div className="al-footer">
          <button className="btn al-start" onClick={() => void start()} disabled={!canStart}>
            {busy ? 'Sending…' : '🎧 Make the lesson'}
          </button>
        </div>
        {!isOnline && <div className="al-note">You're offline — making a lesson needs a connection. Saved lessons still play.</div>}
        {notice && <div className="al-note" role="status" data-testid="al-notice">{notice}</div>}
        {error && <div className="al-error" role="alert">{error}</div>}
      </div>

      {lessons.length === 0 ? (
        <div className="al-empty">No lessons yet — make your first one above. It takes a few minutes.</div>
      ) : (
        <ul className="al-list">
          {lessons.map((l) => (
            <li key={l.id} className={`al-row al-row-${l.status}`}>
              <button
                className="al-row-main"
                onClick={() => l.status === 'ready' && navigate(`/audio-lessons/${l.id}`)}
                disabled={l.status !== 'ready'}
                aria-label={l.status === 'ready' ? `Play ${l.title}` : l.title}
              >
                <span className="al-row-icon" aria-hidden>{audioLessonFormatInfo(l.format).icon}</span>
                <span className="al-row-text">
                  <span className="al-row-title">{l.title}</span>
                  <span className="al-row-sub">
                    {statusLine(l)}
                    {l.status === 'ready' && saved.has(l.id) && <span className="al-saved"> · ✓ On this phone</span>}
                  </span>
                  {l.companion && (
                    <span className={`companion-badge ${l.companion.status}`} data-testid={`companion-badge-${l.id}`}>{companionBadge(l.companion.status)}</span>
                  )}
                  {(l.status === 'speaking' && l.progress_total) ? (
                    <span className="al-progress" aria-hidden><span style={{ width: `${Math.round(((l.progress_done ?? 0) / l.progress_total) * 100)}%` }} /></span>
                  ) : null}
                </span>
              </button>
              {l.status === 'failed' && (
                <button className="btn btn-primary btn-sm" onClick={() => void retry(l.id)} disabled={!isOnline}>🔄 Retry</button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => void remove(l)} disabled={!isOnline} aria-label={`Delete ${l.title}`}>🗑️</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
