import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { CharRecord, CharWord, CharWordRow, WordRecord } from '@shared/chars';
import { relatedWords, resolveWord, wordChars, wordFrequencyLabel, type WordItem } from '@shared/explorer';
import { hanCharacters } from '@shared/progress/known';
import type { ReaderWordExplanation } from '@shared/reader/words';
import { charWordStatuses, lookupChar, prefetchChars } from '../../services/charDict';
import { lookupWord, type WordLookup } from '../../services/wordDict';
import { loadWordFrequency } from '../../services/wordFrequency';
import { findExistingNotes } from '../../services/studyBumps';
import { cachedWordExplanation, getWordExplanation, invalidateKnownHanzi } from '../../services/readerWords';
import { getTTSWithCache } from '../../services/ttsCache';
import { track } from '../../services/analytics';
import { createAudioPlayer } from '../../utils/audioPlayback';
import { useTTS } from '../../hooks/useAudio';
import { db, type LocalNote } from '../../db/database';
import { AddChunkModal } from '../AddChunkModal';
import { BumpButton } from '../bumps/BumpButton';
import { ExplorableText } from './ExplorableText';
import { useExplorer } from './ExplorerContext';
import { WordRows } from './CharacterView';

const online = () => typeof navigator === 'undefined' || navigator.onLine;

interface Example {
  id: string;
  hanzi: string;
  translation: string;
}

type More = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; value: ReaderWordExplanation } | { kind: 'offline' } | { kind: 'error'; message: string };

/** A character's meaning in this word: the reading with this syllable, else its main meaning (short). */
function charMeaning(record: CharRecord | undefined, syllable: string | null): string {
  if (!record) return '';
  const reading = syllable ? record.readings.find((r) => r.pinyin === syllable) : undefined;
  return (reading?.english || record.meaning).split(/[;,]/)[0].trim();
}

/** The learner's own cards that use the word (not the word's own card): up to three. */
async function examplesFor(hanzi: string): Promise<Example[]> {
  const out: Example[] = [];
  await db.notes
    .filter((n) => {
      if (out.length >= 3 || !n.hanzi || n.hanzi.trim() === hanzi) return false;
      if (n.hanzi.includes(hanzi)) out.push({ id: n.id, hanzi: n.hanzi, translation: n.english ?? '' });
      else if (n.sentence_clue?.includes(hanzi)) out.push({ id: n.id, hanzi: n.sentence_clue, translation: n.sentence_clue_translation ?? '' });
      return false;
    })
    .count()
    .catch(() => 0);
  return out;
}

/**
 * The Word view (docs/LANGUAGE_EXPLORER.md): hanzi · ▶ · pinyin · meaning · how common, a chip
 * per character (→ Character view), the card tie-in (open / ⚡ study today, or + Add as card),
 * dictionary senses, the sentence it was tapped in and the learner's own cards with it (both
 * explorable), "More about this word" (online, cached) and related words (→ Word view).
 * Everything on the device renders at once; the network only fills what isn't cached.
 */
export function WordView({
  item,
  cardHanzi,
  onClose,
  footer,
}: {
  item: WordItem;
  cardHanzi?: string | null;
  onClose: () => void;
  /** The explorer's pinned footer (the card tie-in renders there). */
  footer?: HTMLElement | null;
}) {
  const hanzi = item.hanzi;
  const explorer = useExplorer();
  const navigate = useNavigate();
  const [lookup, setLookup] = useState<WordLookup | null>(null);
  const [charRecords, setCharRecords] = useState<CharRecord[]>([]);
  const [rank, setRank] = useState<number | null>(null);
  const [rankOf, setRankOf] = useState<((w: string) => number | null) | null>(null);
  const [existing, setExisting] = useState<Array<{ note: LocalNote; deckName: string }> | null>(null);
  const [examples, setExamples] = useState<Example[]>([]);
  const [related, setRelated] = useState<CharWordRow<CharWord>[] | null>(null);
  const [more, setMore] = useState<More>({ kind: 'idle' });
  const [adding, setAdding] = useState(false);
  const [addedTo, setAddedTo] = useState(false);
  const [bumpMsg, setBumpMsg] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const player = useRef(createAudioPlayer());
  const tts = useTTS();
  const sentence = item.sentence || hanzi;

  useEffect(() => {
    let alive = true;
    const chars = hanCharacters(hanzi);
    // Local first (instant), then one batched call for the characters this device lacks.
    void (async () => {
      const local = await Promise.all(chars.map((c) => lookupChar(c).catch(() => null)));
      const ok = local.flatMap((r) => (r?.status === 'ok' ? [r.record] : []));
      if (alive) setCharRecords(ok);
      if (ok.length < chars.length && online()) {
        await prefetchChars(chars).catch(() => 0);
        const again = await Promise.all(chars.map((c) => lookupChar(c).catch(() => null)));
        if (alive) setCharRecords(again.flatMap((r) => (r?.status === 'ok' ? [r.record] : [])));
      }
    })();
    void lookupWord(hanzi).then((r) => alive && setLookup(r));
    void loadWordFrequency().then((idx) => {
      if (!alive || !idx) return;
      setRank(idx.words.get(hanzi) ?? null);
      setRankOf(() => (w: string) => idx.words.get(w) ?? null);
    });
    void findExistingNotes(hanzi).then((e) => alive && setExisting(e)).catch(() => alive && setExisting([]));
    void examplesFor(hanzi).then((e) => alive && setExamples(e));
    void cachedWordExplanation(hanzi, sentence).then((c) => alive && c && setMore({ kind: 'ready', value: c }));
    const p = player.current;
    return () => {
      alive = false;
      p.dispose();
    };
  }, [hanzi, sentence]);

  useEffect(() => {
    if (charRecords.length === 0) return;
    let alive = true;
    const words = relatedWords(hanzi, charRecords, rankOf ?? (() => null)).map((r) => r.word);
    charWordStatuses(words, cardHanzi)
      .then((rows) => {
        // Keep the related order (statuses never reorder here, only the card's own word goes first).
        const byHanzi = new Map(rows.map((r) => [r.word.hanzi, r]));
        if (alive) setRelated(words.map((w) => byHanzi.get(w.hanzi) ?? { word: w, status: 'none', note_ids: [], current: false }));
      })
      .catch(() => alive && setRelated(words.map((w) => ({ word: w, status: 'none', note_ids: [], current: false }))));
    return () => {
      alive = false;
    };
  }, [hanzi, charRecords, rankOf, cardHanzi]);

  const record: WordRecord | null = lookup?.status === 'ok' ? lookup.record : null;
  const word = resolveWord(hanzi, {
    record,
    charWords: charRecords.flatMap((r) => r.words),
    notes: existing?.map((e) => e.note) ?? [],
    hint: { pinyin: item.pinyin, gloss: item.gloss },
    rank,
  });
  const chars = wordChars(hanzi, word.pinyin, word.syllables);
  const freq = wordFrequencyLabel(word.rank);
  const explanation = more.kind === 'ready' ? more.value : null;

  const play = async () => {
    if (playing) return;
    setPlaying(true);
    const id = player.current.claim();
    const blob = await getTTSWithCache(hanzi).catch(() => null);
    if (!player.current.isCurrent(id)) return;
    if (!blob) {
      setPlaying(false);
      tts.speak(hanzi);
      return;
    }
    player.current.play(blob, { onEnded: () => setPlaying(false), onError: () => setPlaying(false) });
  };

  const askMore = async () => {
    track('explorer.more', { kind: 'word' });
    if (!online()) return setMore({ kind: 'offline' });
    setMore({ kind: 'loading' });
    try {
      const value = await getWordExplanation({ word: hanzi, sentence, pinyin: word.pinyin || undefined, gloss: word.english || undefined });
      setMore({ kind: 'ready', value });
    } catch (e) {
      setMore(online() ? { kind: 'error', message: e instanceof Error ? e.message : 'Claude could not explain this word just now' } : { kind: 'offline' });
    }
  };

  const decks = existing ? [...new Set(existing.map((e) => e.deckName))] : [];

  return (
    <div className="xp-view" data-testid="explorer-word-view">
      <div className="xp-word-head">
        <div className="xp-word-hanzi" lang="zh-CN">{hanzi}</div>
        <button type="button" className={`xp-play${playing ? ' playing' : ''}`} onClick={() => void play()} aria-label={`Play ${hanzi}`}>
          {playing ? '■' : '▶'}
        </button>
      </div>
      {word.pinyin && <div className="xp-word-pinyin">{explanation?.pinyin || word.pinyin}</div>}
      {(word.english || explanation?.english) && <div className="xp-word-english">{word.english || explanation?.english}</div>}
      {!word.english && !explanation && lookup?.status === 'offline' && charRecords.length === 0 && (
        <div className="xp-muted" data-testid="explorer-word-offline">You’re offline and this word isn’t on the device yet.</div>
      )}
      <div className="xp-chips">
        <span className={`xp-freq xp-freq--${freq.tier}`} data-testid="explorer-word-freq">{freq.text}</span>
      </div>

      <section className="xp-section" aria-label="Characters">
        <div className="xp-char-chips">
          {chars.map((c, i) => (
            <button
              key={`${c.char}-${i}`}
              type="button"
              className={`xp-char-chip${c.tone ? ` tone-${c.tone}` : ''}`}
              onClick={() => explorer.push({ kind: 'char', char: c.char })}
              aria-label={`The character ${c.char}${c.syllable ? `, ${c.syllable}` : ''}`}
            >
              <span className="xp-char-chip-glyph" lang="zh-CN">{c.char}</span>
              {c.syllable && <span className="xp-char-chip-pinyin">{c.syllable}</span>}
              <span className="xp-char-chip-meaning">{charMeaning(charRecords.find((r) => r.char === c.char), c.syllable)}</span>
            </button>
          ))}
        </div>
      </section>

      {word.senses.length > 1 && (
        <section className="xp-section">
          <h3 className="xp-h">Meaning</h3>
          <ol className="xp-senses">
            {word.senses.map((s) => <li key={s}>{s}</li>)}
          </ol>
        </section>
      )}

      {(item.sentence || examples.length > 0) && (
        <section className="xp-section" aria-label="Sentences">
          <h3 className="xp-h">{item.sentence ? 'In context' : 'In your cards'}</h3>
          {item.sentence && (
            <div className="xp-example">
              <ExplorableText text={item.sentence} source="other" className="xp-example-zh" highlight={hanzi} />
            </div>
          )}
          {examples.map((ex) => (
            <div key={ex.id} className="xp-example">
              <ExplorableText text={ex.hanzi} source="other" className="xp-example-zh" highlight={hanzi} />
              {ex.translation && <div className="xp-example-en">{ex.translation}</div>}
            </div>
          ))}
        </section>
      )}

      <section className="xp-section">
        {explanation ? (
          <div className="char-sheet-more" data-testid="explorer-word-more">{explanation.explanation}</div>
        ) : more.kind === 'loading' ? (
          <div className="char-sheet-more char-sheet-more--muted">Asking Claude about {hanzi}…</div>
        ) : (
          <>
            {more.kind === 'offline' && <div className="char-sheet-more char-sheet-more--muted">Needs internet.</div>}
            {more.kind === 'error' && <div className="char-sheet-more char-sheet-more--muted">{more.message}</div>}
            <button type="button" className="btn btn-secondary char-sheet-action" onClick={() => void askMore()}>
              ✨ More about this word
            </button>
          </>
        )}
      </section>

      {related && related.length > 0 && (
        <section className="char-sheet-words" aria-label="Related words">
          <div className="char-sheet-words-head">
            <h3>Related words</h3>
          </div>
          <WordRows
            rows={related}
            highlight={hanzi}
            onOpen={(row) => explorer.push({ kind: 'word', hanzi: row.word.hanzi, pinyin: row.word.pinyin, gloss: row.word.english })}
          />
        </section>
      )}
      <p className="char-sheet-credit">Dictionary: CC-CEDICT, wordfreq — see Settings → About.</p>

      {footer && createPortal(
        <div className="xp-footer" data-testid="explorer-word-card">
          {existing === null ? null : existing.length > 0 ? (
            <div className="xp-have">
              <div className="xp-have-line">📚 You have this card in {decks.join(', ')}</div>
              {bumpMsg && <div className="bump-hint" role="status">{bumpMsg}</div>}
              <div className="xp-footer-row">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    onClose();
                    navigate(`/cards/${existing[0].note.id}`);
                  }}
                >
                  Open card →
                </button>
                <BumpButton
                  noteIds={existing.map((e) => e.note.id)}
                  source="explorer"
                  label="⚡ Study it today"
                  onBumped={(m) => {
                    track('explorer.bump', {});
                    setBumpMsg(m);
                  }}
                />
              </div>
            </div>
          ) : addedTo ? (
            <div className="xp-have-line" role="status">✓ Added — it will be in your decks after the next sync.</div>
          ) : (
            <button type="button" className="btn btn-primary xp-add" onClick={() => setAdding(true)} data-testid="explorer-add-card">
              + Add as card
            </button>
          )}
        </div>,
        footer,
      )}

      {adding && createPortal(
        // Its own layer above the explorer sheet (the add sheet's backdrop has a low z-index).
        <div className="xp-modal-layer" onClick={(e) => e.stopPropagation()}>
          <AddChunkModal
            source="explorer"
            chunk={{
              hanzi,
              pinyin: explanation?.pinyin || word.pinyin,
              english: explanation?.english || word.english,
              ...(explanation?.fun_facts ? { fun_facts: explanation.fun_facts } : {}),
              ...(explanation?.sentence_clue
                ? {
                    sentence_clue: explanation.sentence_clue,
                    sentence_clue_pinyin: explanation.sentence_clue_pinyin,
                    sentence_clue_translation: explanation.sentence_clue_translation,
                  }
                : {}),
            }}
            onAdded={() => {
              track('explorer.add_card', {});
              invalidateKnownHanzi();
              setAddedTo(true);
            }}
            onClose={() => setAdding(false)}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
