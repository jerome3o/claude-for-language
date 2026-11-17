/**
 * `/add` — the learner's ＋ Add tab (docs/ADD_TAB.md; rules in shared/add/add.ts). Jerome, Nov 2026:
 * "a landing page where it's super easy to add a new card, super easy to ask for new content".
 *
 * - "Add a word" (top): 📷 Photo — ONE tap opens the camera, the photo is read at once (`POST
 *   /api/ocr/words`, ~1280px JPEG) and the Chinese lines come back most prominent first as word chips
 *   (the device segmenter); a chip → the explorer's Word view → + Add as card / ⚡ Study it today. ✂
 *   picks a different span by hand. ✏️ Type it / 🎤 Say it (中文) / 🎤 in English: Chinese → the explorer,
 *   English or pinyin → up to 4 Chinese words (`POST /api/ai/english-words`) → the explorer.
 * - "Ask for new content": one tile per thing Claude can make; each opens ONE voice-first box and
 *   creates it through the existing path; "✓ Making your reader… Open ›" (kept for this tab session,
 *   so coming back shows it).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ADD_AUDIO_FORMATS,
  ADD_CONTENT_TILES,
  OCR_JPEG_QUALITY,
  OCR_MAX_EDGE,
  addContentLang,
  addContentPlaceholder,
  addContentReady,
  addContentTile,
  addResultLine,
  classifyWordInput,
  hanCount,
  ocrFoundLine,
  ocrSpan,
  type AddAudioFormat,
  type AddContentKind,
  type OcrLine,
} from '@shared/add/add';
import { itemForText } from '@shared/explorer/stack';
import type { ReaderWord } from '@shared/reader/words';
import { useNetwork } from '../contexts/NetworkContext';
import { useExplorer } from '../components/explorer/ExplorerContext';
import { useVoiceDictation, type DictatedAnswer } from '../hooks/useVoiceDictation';
import { VoiceTextInputView } from '../components/voice/VoiceTextInput';
import { preloadSegmenter, useSegmentedWords } from '../services/chineseSegmenter';
import { compressPhoto } from '../services/chatMedia';
import { englishWords, getLessonRequest, readPhotoWords, requestLesson, type ChineseCandidate } from '../api/add';
import { generateDeck, generateGradedReader } from '../api/client';
import { createAudioLesson } from '../api/audioLessons';
import { generateClips } from '../api/clips';
import { createPictureHunt } from '../api/pictureHunts';
import { startClaudeThread } from '../services/claudeThreads';
import { useAskLanguage } from '../services/askClaudeLanguage';
import { db } from '../db/database';
import { track, trackError } from '../services/analytics';
import type { DifficultyLevel } from '../types';
import './AddPage.css';

type WordMethod = 'photo' | 'type' | 'say_zh' | 'say_en';

function errorText(err: unknown, fallback: string): string {
  const m = err instanceof Error ? err.message : '';
  return m && !/^HTTP \d+$/.test(m) && m !== 'Unknown error' ? m : fallback;
}

// ---------------- word chips ----------------

/** One read / typed line as tappable words; ✂ picks characters by hand (first tap, last tap). */
function WordLine({ text, primary, onLookUp, testId }: { text: string; primary: boolean; onLookUp: (word: string, hint?: ReaderWord) => void; testId: string }) {
  const words = useSegmentedWords(text);
  const [picking, setPicking] = useState(false);
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const chars = useMemo(() => [...text], [text]);
  const span = from !== null ? ocrSpan(text, from, to ?? from) : '';
  // Until the segmenter has loaded (a moment, once): one chip per character.
  const chips: ReaderWord[] = words ?? chars.map((c) => ({ text: c, pinyin: '', gloss: '' }));

  return (
    <div className={`add-line${primary ? ' add-line--primary' : ''}`} data-testid={testId}>
      {!picking ? (
        <div className="add-chips" role="group" aria-label={`Words in ${text}`}>
          {chips.map((w, i) =>
            hanCount(w.text) > 0 ? (
              <button key={i} type="button" className="add-chip" onClick={() => onLookUp(w.text, w)} data-testid="add-word-chip">
                {w.text}
              </button>
            ) : (
              <span key={i} className="add-chip-punct">{w.text}</span>
            ),
          )}
        </div>
      ) : (
        <div className="add-chips add-chips--chars" role="group" aria-label="Pick the first and last character">
          {chars.map((c, i) => {
            const lo = from === null ? -1 : Math.min(from, to ?? from);
            const hi = from === null ? -1 : Math.max(from, to ?? from);
            const on = i >= lo && i <= hi;
            return (
              <button
                key={i}
                type="button"
                className={`add-char${on ? ' on' : ''}`}
                aria-pressed={on}
                onClick={() => {
                  if (from === null || to !== null) {
                    setFrom(i);
                    setTo(null);
                  } else setTo(i);
                }}
                data-testid="add-char"
              >
                {c}
              </button>
            );
          })}
        </div>
      )}
      <div className="add-line-tools">
        {picking && span && hanCount(span) > 0 && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onLookUp(span)} data-testid="add-span-open">
            Look up {span} ›
          </button>
        )}
        <button
          type="button"
          className="add-pick"
          aria-pressed={picking}
          onClick={() => {
            setPicking((p) => !p);
            setFrom(null);
            setTo(null);
          }}
          title={picking ? 'Back to words' : 'Pick the characters yourself'}
          data-testid="add-pick"
        >
          {picking ? 'Words' : '✂ Pick'}
        </button>
      </div>
    </div>
  );
}

// ---------------- photo ----------------

interface PhotoState {
  url: string;
  blob: Blob;
  status: 'reading' | 'done' | 'failed' | 'offline';
  lines: OcrLine[];
  error?: string;
  width?: number;
  height?: number;
}

function PhotoResult({ photo, focus, onFocus, onLookUp, onRetry }: {
  photo: PhotoState;
  focus: number;
  onFocus: (i: number) => void;
  onLookUp: (word: string, hint?: ReaderWord, sentence?: string) => void;
  onRetry: () => void;
}) {
  // The focused line first (a tap on its box in the photo moves it up), then the rest in order.
  const order = photo.lines.map((_, i) => i);
  if (focus > 0 && focus < order.length) order.splice(order.indexOf(focus), 1), order.unshift(focus);
  return (
    <div className="add-photo" data-testid="add-photo-result" data-status={photo.status}>
      <div className="add-photo-frame">
        <div className="add-photo-pic">
        <img src={photo.url} alt="Your photo" />
        {photo.lines.map((l, i) =>
          l.box ? (
            <button
              key={i}
              type="button"
              className={`add-photo-box${i === (order[0] ?? -1) ? ' on' : ''}`}
              style={{ top: `${l.box[0] / 10}%`, left: `${l.box[1] / 10}%`, height: `${(l.box[2] - l.box[0]) / 10}%`, width: `${(l.box[3] - l.box[1]) / 10}%` }}
              aria-label={`Line: ${l.text}`}
              onClick={() => onFocus(i)}
            />
          ) : null,
        )}
        {photo.status === 'reading' && <div className="add-photo-scan" aria-hidden="true" />}
        </div>
      </div>
      {photo.status === 'reading' && (
        <div className="add-photo-reading" role="status" data-testid="add-photo-reading">
          <span className="add-skel" />
          <span className="add-skel add-skel--short" />
          <span className="add-muted">Reading the Chinese…</span>
        </div>
      )}
      {photo.status === 'offline' && (
        <p className="add-muted" role="status" data-testid="add-photo-offline">Reading a photo needs a connection — it will be read as soon as you're back online.</p>
      )}
      {photo.status === 'failed' && (
        <p className="add-error" role="alert">
          {photo.error ?? "Couldn't read the photo."}{' '}
          <button type="button" className="add-link" onClick={onRetry}>Try again</button>
        </p>
      )}
      {photo.status === 'done' && (
        <>
          <p className="add-muted" data-testid="add-photo-found">{ocrFoundLine(photo.lines.length)}</p>
          {order.map((i, n) => (
            <WordLine key={`${i}-${photo.lines[i].text}`} text={photo.lines[i].text} primary={n === 0} onLookUp={(w, hint) => onLookUp(w, hint, photo.lines[i].text)} testId="add-ocr-line" />
          ))}
        </>
      )}
    </div>
  );
}

// ---------------- typed / spoken word ----------------

function WordBox({ method, onSubmit, busy }: { method: 'type' | 'say_zh' | 'say_en'; onSubmit: (a: DictatedAnswer) => void; busy: boolean }) {
  const { isOnline } = useNetwork();
  const [value, setValue] = useState('');
  const lang = method === 'say_en' ? 'en' : 'zh';
  const d = useVoiceDictation({ surface: 'add_word', value, onChange: setValue, onSubmit, defaultMode: method === 'type' ? 'type' : 'voice', lang, online: isOnline });
  const started = useRef(false);
  useEffect(() => {
    // 🎤 straight away: the button he tapped WAS "say it".
    if (started.current || method === 'type') return;
    started.current = true;
    if (d.state.mode === 'voice' && d.state.phase === 'idle' && !d.state.blocked) d.say();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <VoiceTextInputView
      value={value}
      onChange={setValue}
      lang={lang}
      placeholder={method === 'say_en' ? 'An English word — "bank", "to queue"…' : 'A word in Chinese, pinyin or English'}
      listeningPlaceholder={method === 'say_en' ? 'Say the word in English…' : 'Say the word…'}
      submitLabel="Look it up"
      disabled={busy}
      testId="add-word-input"
      state={d.state}
      finalText={d.finalText}
      partialText={d.partialText}
      canSubmit={d.canSubmit}
      actions={{ say: d.say, stop: d.stop, cancel: d.cancel, retake: d.retake, retryUpload: d.retryUpload, edit: d.edit, type: d.type, submit: d.submit }}
      compact
    />
  );
}

function Candidates({ words, onLookUp }: { words: ChineseCandidate[]; onLookUp: (c: ChineseCandidate) => void }) {
  return (
    <ul className="add-candidates" data-testid="add-candidates">
      {words.map((w) => (
        <li key={w.hanzi}>
          <button type="button" className="add-candidate" onClick={() => onLookUp(w)} data-testid="add-candidate">
            <span className="add-candidate-hanzi">{w.hanzi}</span>
            <span className="add-candidate-pinyin">{w.pinyin}</span>
            <span className="add-candidate-english">{w.english}{w.note ? ` · ${w.note}` : ''}</span>
            <span className="add-candidate-go" aria-hidden="true">›</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------- content requests ----------------

interface ContentResult {
  id: string;
  kind: AddContentKind;
  topic: string;
  status: 'making' | 'ready' | 'failed';
  /** Where "Open ›" goes. */
  to: string;
  /** A mini lesson request still being written. */
  lessonRequestId?: string;
  at: number;
}

const RESULTS_KEY = 'add-results-v1';

function loadResults(): ContentResult[] {
  try {
    const raw = sessionStorage.getItem(RESULTS_KEY);
    const list = raw ? (JSON.parse(raw) as ContentResult[]) : [];
    return Array.isArray(list) ? list.slice(0, 6) : [];
  } catch {
    return [];
  }
}

function saveResults(list: ContentResult[]) {
  try {
    sessionStorage.setItem(RESULTS_KEY, JSON.stringify(list.slice(0, 6)));
  } catch {
    /* per-tab convenience only */
  }
}

const LEVELS: { value: DifficultyLevel; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'elementary', label: 'Elementary' },
  { value: 'intermediate', label: 'Intermediate' },
];

function ContentSheet({ kind, onClose, onDone }: { kind: AddContentKind; onClose: () => void; onDone: (r: Omit<ContentResult, 'id' | 'at'>) => void }) {
  const tile = addContentTile(kind)!;
  const navigate = useNavigate();
  const { isOnline } = useNetwork();
  const [language] = useAskLanguage();
  const [value, setValue] = useState('');
  const [format, setFormat] = useState<AddAudioFormat>('dialogue');
  const [level, setLevel] = useState<DifficultyLevel>('beginner');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lang = addContentLang(kind, format);
  const create = async (a: DictatedAnswer) => {
    const text = a.text.trim();
    if (!addContentReady(kind, text, format) || busy) return;
    if (!isOnline) {
      setError('This needs a connection — try again when you’re online.');
      return;
    }
    setBusy(true);
    setError(null);
    const spoken = a.source === 'spoken';
    try {
      const done = (to: string, status: ContentResult['status'] = 'making', extra: Partial<ContentResult> = {}) => {
        track('add.content_request', { kind, ok: true, spoken, ...(kind === 'audio' ? { format } : {}) });
        onDone({ kind, topic: text.slice(0, 60), status, to, ...extra });
      };
      switch (kind) {
        case 'reader': {
          const decks = await db.decks.toArray();
          const reader = await generateGradedReader({ deckIds: decks.map((d) => d.id), topic: text, difficulty: level });
          done(`/readers/${reader.id}`);
          break;
        }
        case 'lesson': {
          const { request } = await requestLesson(text);
          done(request.lesson_id ? `/lessons/${request.lesson_id}/play?from=lessons_page` : '/lessons', request.status === 'ready' ? 'ready' : 'making', { lessonRequestId: request.id });
          break;
        }
        case 'audio': {
          const body = format === 'dialogue' ? { format, description: text } : { format, text };
          const { lesson } = await createAudioLesson(body);
          done(`/audio-lessons/${lesson.id}`);
          break;
        }
        case 'clips': {
          const { clips } = await generateClips({ topic: text, count: 1 });
          done(clips[0] ? `/clips/${clips[0].id}` : '/clips');
          break;
        }
        case 'picture_hunt': {
          const { hunt } = await createPictureHunt({ prompt: text });
          done(`/picture-hunt/${hunt.id}`);
          break;
        }
        case 'deck': {
          const { deck } = await generateDeck(text);
          done(`/decks/${deck.id}`, 'ready');
          break;
        }
        case 'ask': {
          const res = await startClaudeThread({ context: { kind: 'general' }, text, intent: 'ask', language });
          track('add.content_request', { kind, ok: true, spoken });
          track('claude.message_send', { context_kind: 'general', intent: 'ask', offline: res.queued, chip: false, spoken });
          navigate(`/chats/claude/${encodeURIComponent(res.threadId)}?source=add`, { state: { from: '/add' } });
          return;
        }
      }
      onClose();
    } catch (err) {
      trackError('add_content', err);
      track('add.content_request', { kind, ok: false, spoken });
      setError(errorText(err, addResultLine(kind, 'failed')));
    } finally {
      setBusy(false);
    }
  };
  const d = useVoiceDictation({ surface: 'add_content', value, onChange: setValue, onSubmit: (a) => void create(a), defaultMode: 'voice', lang, online: isOnline });

  return (
    <div className="modal-overlay add-sheet-overlay" onClick={onClose}>
      <div className="modal add-sheet" role="dialog" aria-label={tile.title} onClick={(e) => e.stopPropagation()} data-testid="add-content-sheet">
        <h2 className="add-sheet-title">
          <span aria-hidden="true">{tile.icon}</span> {tile.title}
        </h2>
        {kind === 'audio' && (
          <div className="add-options" role="group" aria-label="Kind of audio lesson">
            {ADD_AUDIO_FORMATS.map((f) => (
              <button key={f.format} type="button" className={`add-option${format === f.format ? ' on' : ''}`} aria-pressed={format === f.format} onClick={() => setFormat(f.format)}>
                {f.label}
              </button>
            ))}
          </div>
        )}
        {kind === 'reader' && (
          <div className="add-options" role="group" aria-label="Level">
            {LEVELS.map((l) => (
              <button key={l.value} type="button" className={`add-option${level === l.value ? ' on' : ''}`} aria-pressed={level === l.value} onClick={() => setLevel(l.value)}>
                {l.label}
              </button>
            ))}
          </div>
        )}
        <VoiceTextInputView
          value={value}
          onChange={setValue}
          lang={lang}
          multiline={kind === 'audio' && format !== 'dialogue'}
          placeholder={addContentPlaceholder(kind, format)}
          listeningPlaceholder="Say what it should be about…"
          submitLabel={busy ? 'Starting…' : tile.submitLabel}
          disabled={busy}
          testId="add-content-input"
          state={d.state}
          finalText={d.finalText}
          partialText={d.partialText}
          canSubmit={d.canSubmit && addContentReady(kind, d.state.mode === 'voice' ? d.finalText || value : value, format)}
          actions={{ say: d.say, stop: d.stop, cancel: d.cancel, retake: d.retake, retryUpload: d.retryUpload, edit: d.edit, type: d.type, submit: d.submit }}
        />
        {busy && <p className="add-muted" role="status">{kind === 'deck' ? 'Claude is writing the cards — this takes a little while…' : 'Starting…'}</p>}
        {error && <p className="add-error" role="alert">{error}</p>}
        {!isOnline && <p className="add-muted">Needs a connection.</p>}
        <div className="modal-actions sheet-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ---------------- the page ----------------

export function AddPage() {
  const navigate = useNavigate();
  const explorer = useExplorer();
  const { isOnline } = useNetwork();
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [method, setMethod] = useState<WordMethod | null>(null);
  const [photo, setPhoto] = useState<PhotoState | null>(null);
  const [focus, setFocus] = useState(0);
  const [typedLine, setTypedLine] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ChineseCandidate[] | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<AddContentKind | null>(null);
  const [results, setResults] = useState<ContentResult[]>(loadResults);
  const [boxKey, setBoxKey] = useState(0);

  useEffect(() => {
    track('add.open', {});
    preloadSegmenter();
  }, []);
  useEffect(() => saveResults(results), [results]);
  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url);
  }, [photo]);

  const lookUp = useCallback((word: string, hint?: Partial<ReaderWord>, sentence?: string) => {
    const item = itemForText(word, { pinyin: hint?.pinyin || undefined, gloss: hint?.gloss || undefined, sentence: sentence && sentence !== word ? sentence : undefined });
    if (item) explorer.open(item, { source: 'add' });
  }, [explorer]);

  // ---- photo ----
  const read = useCallback(async (p: PhotoState) => {
    if (!navigator.onLine) {
      setPhoto({ ...p, status: 'offline' });
      return;
    }
    setPhoto({ ...p, status: 'reading', error: undefined });
    const started = performance.now();
    try {
      const { lines } = await readPhotoWords(p.blob);
      const ms = Math.round(performance.now() - started);
      track('ocr.words', { found_count: lines.length, via: 'server', ms, ok: true });
      setFocus(0);
      setPhoto((cur) => (cur && cur.url === p.url ? { ...cur, status: 'done', lines } : cur));
    } catch (err) {
      track('ocr.words', { found_count: 0, via: 'server', ms: Math.round(performance.now() - started), ok: false });
      trackError('ocr_words', err);
      setPhoto((cur) => (cur && cur.url === p.url ? { ...cur, status: 'failed', error: errorText(err, "Couldn't read the photo.") } : cur));
    }
  }, []);

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setMethod('photo');
    setTypedLine(null);
    setCandidates(null);
    setLookupError(null);
    track('add.word_input', { method: 'photo', kind: 'chinese' });
    // The photo shows at once (the original) while it is shrunk and read.
    const url = URL.createObjectURL(file);
    const base: PhotoState = { url, blob: file, status: 'reading', lines: [] };
    setPhoto(base);
    try {
      const small = await compressPhoto(file, OCR_MAX_EDGE, OCR_JPEG_QUALITY);
      await read({ ...base, blob: small.blob, width: small.width, height: small.height });
    } catch (err) {
      setPhoto({ ...base, status: 'failed', error: errorText(err, "Couldn't open that photo.") });
    }
  };

  // A photo taken offline is read as soon as the connection is back.
  useEffect(() => {
    if (isOnline && photo?.status === 'offline') void read(photo);
  }, [isOnline, photo, read]);

  // ---- typed / spoken ----
  const onWord = async (a: DictatedAnswer) => {
    const text = a.text.trim();
    const kind = classifyWordInput(text);
    if (kind === 'empty') return;
    track('add.word_input', { method: method ?? 'type', kind });
    setLookupError(null);
    setCandidates(null);
    setTypedLine(null);
    if (kind === 'chinese') {
      // A word → straight to the explorer; a sentence → its words to pick from.
      if (hanCount(text) <= 4) lookUp(text);
      else setTypedLine(text);
      return;
    }
    if (!isOnline) {
      setLookupError('Finding the Chinese for English needs a connection.');
      return;
    }
    setLookupBusy(true);
    try {
      const { words } = await englishWords(text);
      setCandidates(words);
    } catch (err) {
      trackError('add_english_words', err);
      setLookupError(errorText(err, 'No answer right now — try again.'));
    } finally {
      setLookupBusy(false);
    }
  };

  const pickMethod = (m: WordMethod) => {
    setMethod(m);
    setPhoto(null);
    setTypedLine(null);
    setCandidates(null);
    setLookupError(null);
    setBoxKey((k) => k + 1);
  };

  // ---- content results ----
  const addResult = (r: Omit<ContentResult, 'id' | 'at'>) => {
    setResults((list) => [{ ...r, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: Date.now() }, ...list].slice(0, 6));
  };
  // A mini lesson is written in the background: ask how it is going (every 3 s) until it is ready.
  const [pollTick, setPollTick] = useState(0);
  const pendingKey = results.filter((r) => r.lessonRequestId && r.status === 'making').map((r) => `${r.id}:${r.lessonRequestId}`).join(',');
  useEffect(() => {
    if (!pendingKey || !isOnline) return;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      for (const pair of pendingKey.split(',')) {
        const [id, requestId] = pair.split(':');
        try {
          const { request } = await getLessonRequest(requestId);
          if (cancelled || request.status === 'generating') continue;
          setResults((list) =>
            list.map((x) =>
              x.id === id
                ? { ...x, status: request.status === 'ready' ? 'ready' : 'failed', to: request.lesson_id ? `/lessons/${request.lesson_id}/play?from=lessons_page` : '/lessons' }
                : x,
            ),
          );
        } catch {
          /* asked again next round */
        }
      }
      if (!cancelled) setPollTick((n) => n + 1);
    }, 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [pendingKey, isOnline, pollTick]);

  const methods: { id: WordMethod; icon: string; label: string; hint: string }[] = [
    { id: 'photo', icon: '📷', label: 'Take a photo', hint: 'Chinese on a screen, a sign, a page' },
    { id: 'type', icon: '✏️', label: 'Type it', hint: 'Hanzi, pinyin, English' },
    { id: 'say_zh', icon: '🎤', label: 'Say it', hint: 'In Chinese' },
    { id: 'say_en', icon: '🗣', label: 'In English', hint: 'Say the English' },
  ];

  return (
    <div className="page">
      <div className="container add-page" data-testid="add-page">
        <h1 className="add-title">Add</h1>

        <section className="add-card" aria-labelledby="add-word-heading" data-testid="add-word-card">
          <h2 id="add-word-heading" className="add-card-title">Add a word</h2>
          <div className="add-methods" role="group" aria-label="How to add a word">
            {methods.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`add-method${method === m.id ? ' on' : ''}${m.id === 'photo' ? ' add-method--photo' : ''}`}
                aria-pressed={method === m.id}
                onClick={() => (m.id === 'photo' ? cameraRef.current?.click() : pickMethod(m.id))}
                data-testid={`add-method-${m.id}`}
              >
                <span className="add-method-icon" aria-hidden="true">{m.icon}</span>
                <span className="add-method-label">{m.label}</span>
                <span className="add-method-hint">{m.hint}</span>
              </button>
            ))}
          </div>
          {/* One tap = the camera (capture), or a picture already on the phone. */}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void onPhoto(e.target.files?.[0]); e.target.value = ''; }} data-testid="add-photo-camera-input" />
          <input ref={galleryRef} type="file" accept="image/*" hidden onChange={(e) => { void onPhoto(e.target.files?.[0]); e.target.value = ''; }} data-testid="add-photo-file-input" />
          <button type="button" className="add-link add-gallery" onClick={() => galleryRef.current?.click()} data-testid="add-photo-gallery">
            🖼 Or pick a photo you already took
          </button>

          {method === 'photo' && photo && (
            <PhotoResult photo={photo} focus={focus} onFocus={setFocus} onLookUp={lookUp} onRetry={() => void read(photo)} />
          )}
          {method && method !== 'photo' && (
            <div className="add-word-box">
              <WordBox key={boxKey} method={method} onSubmit={(a) => void onWord(a)} busy={lookupBusy} />
            </div>
          )}
          {lookupBusy && <p className="add-muted" role="status">Finding the Chinese…</p>}
          {lookupError && <p className="add-error" role="alert">{lookupError}</p>}
          {typedLine && <WordLine text={typedLine} primary onLookUp={(w, hint) => lookUp(w, hint, typedLine)} testId="add-typed-line" />}
          {candidates && <Candidates words={candidates} onLookUp={(c) => lookUp(c.hanzi, { pinyin: c.pinyin, gloss: c.english })} />}
        </section>

        {results.length > 0 && (
          <ul className="add-results" aria-label="What you asked for" data-testid="add-results">
            {results.map((r) => (
              <li key={r.id} className={`add-result add-result--${r.status}`} data-testid="add-result" data-kind={r.kind}>
                <span className="add-result-text">
                  {addResultLine(r.kind, r.status)}
                  <span className="add-result-topic"> {r.topic}</span>
                </span>
                {r.status !== 'failed' && (
                  <button type="button" className="add-result-open" onClick={() => navigate(r.to, { state: { from: '/add' } })} data-testid="add-result-open">
                    Open ›
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <section className="add-content" aria-labelledby="add-content-heading">
          <h2 id="add-content-heading" className="add-section-title">Ask for new content</h2>
          <div className="add-tiles">
            {ADD_CONTENT_TILES.map((t) => (
              <button key={t.kind} type="button" className={`add-tile add-tile--${t.kind}`} onClick={() => setSheet(t.kind)} data-testid={`add-tile-${t.kind}`}>
                <span className="add-tile-icon" aria-hidden="true">{t.icon}</span>
                <span className="add-tile-title">{t.title}</span>
                <span className="add-tile-sub">{t.subtitle}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
      {sheet && <ContentSheet kind={sheet} onClose={() => setSheet(null)} onDone={addResult} />}
    </div>
  );
}

export default AddPage;
