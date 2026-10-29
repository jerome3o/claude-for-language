import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { readAloudCharLabel, readAloudNeedsLook, type ReadAloudChar, type ReadAloudResult } from '@shared/reader/readAloud';
import { isTappableWord, wordOffsets, sentenceAround, wordsMatchText, type ReaderWord } from '@shared/reader/words';
import { itemForText } from '@shared/explorer';
import { knownHanzi, localPageWords, requestReaderWords, sessionPageWords } from '../../services/readerWords';
import { useSegmentedWords } from '../../services/chineseSegmenter';
import { useExplorer } from '../explorer/ExplorerContext';
import { track } from '../../services/analytics';
import './ReaderWords.css';

interface PageLike {
  id: string;
  content_chinese: string;
  words?: ReaderWord[] | null;
}

/**
 * A page's word chips: the page's own words when they came with it, else the
 * ones this session or this device already has, else asked for (once per
 * reader) from the server. Null until then — the caller shows plain text.
 */
export function useReaderPageWords(readerId: string, page: PageLike): ReaderWord[] | null {
  const own = page.words && wordsMatchText(page.words, page.content_chinese) ? page.words : null;
  const [words, setWords] = useState<ReaderWord[] | null>(own ?? sessionPageWords(page.id, page.content_chinese));

  useEffect(() => {
    const ready = own ?? sessionPageWords(page.id, page.content_chinese);
    setWords(ready);
    if (ready) return;
    let cancelled = false;
    (async () => {
      const local = await localPageWords(readerId, page.id, page.content_chinese);
      if (cancelled) return;
      if (local) {
        setWords(local);
        return;
      }
      const made = await requestReaderWords(readerId);
      const w = made.get(page.id) ?? sessionPageWords(page.id, page.content_chinese);
      if (!cancelled && w && wordsMatchText(w, page.content_chinese)) setWords(w);
    })();
    return () => {
      cancelled = true;
    };
  }, [readerId, page.id, page.content_chinese, own]);

  return words;
}

/** Hanzi already in my decks (refreshed when a card is added). */
export function useKnownHanzi(version = 0): Set<string> {
  const [known, setKnown] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    void knownHanzi().then((s) => {
      if (!cancelled) setKnown(s);
    });
    return () => {
      cancelled = true;
    };
  }, [version]);
  return known;
}

/** Characters marked by a read-aloud take, with a caret where extra words were said. */
function MarkedChars({ chars }: { chars: readonly ReadAloudChar[] }) {
  return (
    <>
      {chars.map((c, i) => (
        <Fragment key={i}>
          {c.extraBefore && (
            <span className="ra-extra" title={`You also said ${c.extraBefore}`} aria-hidden="true">‸</span>
          )}
          {c.mark === 'plain' ? c.char : (
            <span className={`ra-char ra-${c.mark}`} data-mark={c.mark} title={c.mark === 'ok' ? undefined : readAloudCharLabel(c)}>{c.char}</span>
          )}
        </Fragment>
      ))}
    </>
  );
}

/** Long-press (≈ 0.5 s) on a chip: `onLong`; the click that follows is swallowed. */
function useLongPress(onLong: (() => void) | null) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    return clear;
  }, []);
  if (!onLong) return { handlers: {}, consumeClick: () => false };
  return {
    handlers: {
      onPointerDown: () => {
        fired.current = false;
        clear();
        timer.current = setTimeout(() => {
          fired.current = true;
          onLong();
        }, 500);
      },
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
      onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    },
    consumeClick: () => {
      const was = fired.current;
      fired.current = false;
      return was;
    },
  };
}

function WordChip({ text, known, marked, onOpen, onLong }: {
  text: string;
  known: boolean;
  marked: readonly ReadAloudChar[] | null;
  onOpen: () => void;
  onLong: (() => void) | null;
}) {
  const press = useLongPress(onLong);
  const label = marked && marked.some((c) => c.mark !== 'ok' || c.extraBefore)
    ? marked.map(readAloudCharLabel).join(', ')
    : known ? `${text} (in your decks)` : text;
  return (
    <button
      type="button"
      className={`reader-word-chip${known ? ' known' : ''}`}
      aria-label={label}
      {...press.handlers}
      onClick={(e) => {
        e.stopPropagation();
        if (press.consumeClick()) return;
        track('reader.word_tap');
        onOpen();
      }}
    >
      {marked ? <MarkedChars chars={marked} /> : text}
    </button>
  );
}

/**
 * The revealed Chinese as tappable word chips (punctuation and line breaks
 * stay plain). While the page's Claude-made words aren't there yet (or could
 * not be made) the page is split on the device by the deterministic segmenter
 * (services/chineseSegmenter); only until its word lists load is it the plain
 * text. Tapping a
 * chip opens the language explorer's Word view (docs/LANGUAGE_EXPLORER.md) with
 * the chip's pinyin / gloss and its sentence — "More about this word" and
 * "+ Add as card" live there; it never bubbles to the "hide Chinese" tap.
 *
 * `marks` (🎤 Read it aloud, components/reader/ReadAloud.tsx): the page's own
 * characters marked in place — green read right, amber tone off, red wrong /
 * missed, a caret where extra words were said; a long press on a word that needs
 * a look plays it (`onSpeak`).
 */
export function ReaderWordsText({ readerId, page, className = 'reader-chinese-text', marks = null, onSpeak }: {
  readerId: string;
  page: PageLike;
  className?: string;
  marks?: ReadAloudResult | null;
  onSpeak?: (text: string) => void;
}) {
  const own = useReaderPageWords(readerId, page);
  const local = useSegmentedWords(page.content_chinese, !own);
  const words = own ?? local;
  const known = useKnownHanzi();
  const explorer = useExplorer();
  const markedChars = marks && marks.chars.length === [...page.content_chinese].length ? marks.chars : null;
  const extraAtEnd: ReactNode = markedChars && marks?.extraAtEnd ? (
    <span className="ra-extra" title={`You also said ${marks.extraAtEnd}`} aria-label={`You also said ${marks.extraAtEnd}`}>‸</span>
  ) : null;

  if (!words) {
    return (
      <div className={className} data-read-aloud={markedChars ? 'marked' : undefined}>
        {markedChars ? <MarkedChars chars={markedChars} /> : page.content_chinese}
        {extraAtEnd}
      </div>
    );
  }

  const offsets = wordOffsets(words);
  const openWord = (i: number) => {
    const w = words[i];
    const item = itemForText(w.text, {
      pinyin: w.pinyin || undefined,
      gloss: w.gloss || undefined,
      sentence: sentenceAround(page.content_chinese, offsets[i], offsets[i] + w.text.length),
    });
    if (item) explorer.open(item, { source: 'reader' });
  };

  // The words concatenate to the page's text, so a running code-point count lines each up with its marks.
  let cp = 0;
  return (
    <>
      <div
        className={`${className} reader-words`}
        data-testid="reader-words"
        data-read-aloud={markedChars ? 'marked' : undefined}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {words.map((w, i) => {
          const len = [...w.text].length;
          const marked = markedChars ? markedChars.slice(cp, cp + len) : null;
          cp += len;
          if (isTappableWord(w.text)) {
            return (
              <WordChip
                key={i}
                text={w.text}
                known={known.has(w.text)}
                marked={marked}
                onOpen={() => openWord(i)}
                onLong={marked && onSpeak && readAloudNeedsLook(marked) ? () => onSpeak(w.text) : null}
              />
            );
          }
          if (w.text.includes('\n')) return <br key={i} />;
          return (
            <span key={i} className="reader-word-punct">
              {marked ? <MarkedChars chars={marked} /> : w.text}
            </span>
          );
        })}
        {extraAtEnd}
      </div>
    </>
  );
}
