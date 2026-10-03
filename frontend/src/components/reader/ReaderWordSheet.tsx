import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReaderWord, ReaderWordExplanation } from '@shared/reader/words';
import { decksInQueueOrder, defaultPickerDeckId } from '@shared/decks/queue';
import { createNote, generatePracticeTTS } from '../../api/client';
import { db } from '../../db/database';
import { useTTS } from '../../hooks/useAudio';
import { base64ToBlob } from '../../services/ttsCache';
import { createAudioPlayer } from '../../utils/audioPlayback';
import { cachedWordExplanation, getWordExplanation, invalidateKnownHanzi } from '../../services/readerWords';

type ExplainState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; value: ReaderWordExplanation } | { kind: 'error'; message: string };

const online = () => typeof navigator === 'undefined' || navigator.onLine;

/** Fill pinyin the segmenter left blank (a per-character fallback stretch) on the device. */
async function devicePinyin(text: string): Promise<string> {
  try {
    const { pinyin } = await import('pinyin-pro');
    return pinyin(text, { toneType: 'symbol' });
  } catch {
    return '';
  }
}

/**
 * A tapped reader word: hanzi · pinyin · gloss, ▶ to hear it, "More about
 * this word" (Haiku's explanation of the word in this sentence, cached) and
 * "+ Add as card" (deck picker; the card gets the explanation's card-standard
 * fun_facts and a sentence clue when they can be had). A word already in a
 * deck says so.
 */
export function ReaderWordSheet({
  word,
  sentence,
  known,
  onClose,
  onAdded,
  onMore,
}: {
  word: ReaderWord;
  sentence: string;
  known: boolean;
  onClose: () => void;
  onAdded?: () => void;
  /** "More about this word" was pressed (analytics). */
  onMore?: () => void;
}) {
  const [pinyin, setPinyin] = useState(word.pinyin);
  const [explain, setExplain] = useState<ExplainState>({ kind: 'idle' });
  const [adding, setAdding] = useState(false);
  const [decks, setDecks] = useState<Array<{ id: string; name: string }>>([]);
  const [deckId, setDeckId] = useState('');
  const [duplicate, setDuplicate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const player = useRef(createAudioPlayer());
  const tts = useTTS();

  useEffect(() => {
    if (!word.pinyin) void devicePinyin(word.text).then((p) => p && setPinyin(p));
    void cachedWordExplanation(word.text, sentence).then((c) => c && setExplain({ kind: 'ready', value: c }));
    const p = player.current;
    return () => p.dispose();
  }, [word.text, word.pinyin, sentence]);

  useEffect(() => {
    if (!adding) return;
    // Queue order, top deck first and preselected (decks the queue ranks higher are the ones being studied).
    void db.decks.toArray().then((list) => {
      const ordered = decksInQueueOrder(list).map((d) => ({ id: d.id, name: d.name }));
      setDecks(ordered);
      setDeckId((cur) => cur || defaultPickerDeckId(list));
    });
  }, [adding]);

  useEffect(() => {
    if (!deckId) return setDuplicate(false);
    void db.notes
      .where('deck_id').equals(deckId)
      .filter((n) => n.hanzi === word.text)
      .count()
      .then((n) => setDuplicate(n > 0))
      .catch(() => setDuplicate(false));
  }, [deckId, word.text]);

  const play = () => {
    if (playing) return;
    if (!online()) {
      tts.speak(word.text);
      return;
    }
    const id = player.current.claim();
    setPlaying(true);
    generatePracticeTTS(word.text)
      .then((r) => {
        if (!player.current.isCurrent(id)) return;
        player.current.play(base64ToBlob(r.audio_base64, r.content_type), {
          onEnded: () => setPlaying(false),
          onError: () => setPlaying(false),
        });
      })
      .catch(() => {
        setPlaying(false);
        tts.speak(word.text);
      });
  };

  const loadExplanation = async (): Promise<ReaderWordExplanation | null> => {
    if (explain.kind === 'ready') return explain.value;
    if (!online()) {
      setExplain({ kind: 'error', message: 'Needs a connection — the word is still here when you are back online.' });
      return null;
    }
    setExplain({ kind: 'loading' });
    try {
      const value = await getWordExplanation({ word: word.text, sentence, pinyin: pinyin || undefined, gloss: word.gloss || undefined });
      setExplain({ kind: 'ready', value });
      return value;
    } catch (e) {
      setExplain({ kind: 'error', message: e instanceof Error ? e.message : 'Claude could not explain this word just now' });
      return null;
    }
  };

  const add = async () => {
    if (!deckId) return;
    if (!online()) {
      setError('Adding a card needs a connection.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const ex = explain.kind === 'ready' ? explain.value : await loadExplanation();
      const english = ex?.english || word.gloss;
      if (!english) throw new Error('No meaning for this word yet — try "More about this word" first.');
      await createNote(deckId, {
        hanzi: word.text,
        pinyin: ex?.pinyin || pinyin,
        english,
        ...(ex?.fun_facts ? { fun_facts: ex.fun_facts } : {}),
        ...(ex?.sentence_clue
          ? {
              sentence_clue: ex.sentence_clue,
              sentence_clue_pinyin: ex.sentence_clue_pinyin,
              sentence_clue_translation: ex.sentence_clue_translation,
            }
          : {}),
      });
      invalidateKnownHanzi();
      setAdded(decks.find((d) => d.id === deckId)?.name ?? 'your deck');
      onAdded?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const shownPinyin = explain.kind === 'ready' && explain.value.pinyin ? explain.value.pinyin : pinyin;
  const shownGloss = word.gloss || (explain.kind === 'ready' ? explain.value.english : '');

  return createPortal(
    <div
      className="rw-sheet-backdrop"
      role="presentation"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="rw-sheet" role="dialog" aria-label={`The word ${word.text}`} onClick={(e) => e.stopPropagation()}>
        <div className="rw-grab" />
        <div className="rw-sheet-body">
          <div className="rw-head">
            <div className="rw-hanzi">{word.text}</div>
            <button type="button" className={`rw-play${playing ? ' playing' : ''}`} onClick={play} aria-label="Play the word">
              {playing ? '■' : '▶'}
            </button>
          </div>
          {shownPinyin && <div className="rw-pinyin">{shownPinyin}</div>}
          {shownGloss && <div className="rw-gloss">{shownGloss}</div>}
          {known && <div className="rw-known">✓ Already in your decks</div>}
          <div className="rw-sentence">{sentence}</div>

          {explain.kind === 'ready' ? (
            <div className="rw-explanation" data-testid="rw-explanation">
              {explain.value.explanation}
            </div>
          ) : explain.kind === 'loading' ? (
            <div className="rw-explanation muted">
              <span className="spinner" style={{ width: 14, height: 14, display: 'inline-block', marginRight: 8, verticalAlign: 'middle' }} />
              Asking Claude about {word.text}…
            </div>
          ) : (
            <>
              {explain.kind === 'error' && <div className="rw-notice">{explain.message}</div>}
              <button type="button" className="rw-more" onClick={() => { onMore?.(); void loadExplanation(); }}>
                ✨ More about this word
              </button>
            </>
          )}
        </div>

        {/* Pinned under the scrolling body: the add button is always on screen, however long the explanation. */}
        <div className="rw-sheet-foot">
          {added ? (
            <div className="rw-success">✓ Added to {added}</div>
          ) : !adding ? (
            <button type="button" className="rw-add" onClick={() => setAdding(true)}>
              + Add as card
            </button>
          ) : (
            <div className="rw-add-panel">
              <label className="rw-label" htmlFor="rw-deck">
                Save to deck
              </label>
              <select id="rw-deck" className="rw-select" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              {duplicate && <div className="rw-notice">This word is already in that deck.</div>}
              {error && <div className="rw-notice error">{error}</div>}
              <button type="button" className="rw-add" disabled={saving || !deckId} onClick={() => void add()}>
                {saving ? 'Adding…' : duplicate ? 'Add anyway' : 'Add to deck'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
