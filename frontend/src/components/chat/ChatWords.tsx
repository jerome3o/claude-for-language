import { autoPinyin, devicePinyinLine } from '../../utils/autoPinyin';
import { isTappableWord, sentenceAround, wordOffsets } from '@shared/reader/words';
import { looksLikeChinese } from './messageTools';
import { preloadSegmenter, useSegmentedWords } from '../../services/chineseSegmenter';
import type { ChatWord } from '../../types';
import type { ReadAloudResult } from '@shared/reader/readAloud';
import { MarkedChars } from '../reader/ReaderWords';
import '../reader/ReaderWords.css';
import '../reader/ReadAloud.css';

export { tidyPinyin, devicePinyinLine } from '../../utils/autoPinyin';

// The word lists load in the background as soon as anything that shows word chips is loaded.
preloadSegmenter();

function wordPinyin(w: ChatWord): string {
  if (w.pinyin) return w.pinyin;
  try {
    return autoPinyin(w.text);
  } catch {
    return '';
  }
}

export interface TappedWord {
  word: ChatWord;
  sentence: string;
}

/**
 * A chat message's text as tappable word chips (docs/CHAT.md PR 3): the
 * reader's word chips, quieter for a word already in my decks, with the
 * pinyin over each word when asked. Without words (yet — or when making them
 * failed) Chinese text is split into words on the device (services/chineseSegmenter:
 * the deterministic segmenter), so the chips are words from the first frame; only
 * until the word lists have loaded is it the plain text (+ the device's pinyin line).
 */
export function ChatWordsText({
  text,
  words: given,
  showPinyin,
  known,
  onTapWord,
  suppressTap,
  lang = 'zh',
  marks = null,
}: {
  text: string;
  words: ChatWord[] | null;
  showPinyin: boolean;
  known: Set<string>;
  onTapWord: (tapped: TappedWord) => void;
  /** True while picking messages, or right after a long-press opened the ⋯ sheet (the tap is not a word tap). */
  suppressTap?: () => boolean;
  /** The words' language tag (an English line with Chinese inside keeps 'en' for its Latin glyphs). */
  lang?: string;
  /** 🎤 Read it back: the text's own characters marked in place (shared/reader/readAloud.ts), as on a reader page. */
  marks?: ReadAloudResult | null;
}) {
  const local = useSegmentedWords(text, !given && looksLikeChinese(text));
  const words = given ?? local;
  const markedChars = marks && marks.chars.length === [...text].length ? marks.chars : null;
  const extraAtEnd = markedChars && marks?.extraAtEnd ? (
    <span className="ra-extra" title={`You also said ${marks.extraAtEnd}`} aria-label={`You also said ${marks.extraAtEnd}`}>‸</span>
  ) : null;
  if (!words && markedChars) {
    return (
      <span className="chat-text" lang="zh" data-read-aloud="marked">
        <MarkedChars chars={markedChars} />
        {extraAtEnd}
      </span>
    );
  }
  if (!words) {
    const line = showPinyin && looksLikeChinese(text) ? devicePinyinLine(text) : '';
    return (
      <>
        <span className="chat-text" lang={looksLikeChinese(text) ? 'zh' : undefined}>
          {text}
        </span>
        {line && <span className="chat-pinyin-line">{line}</span>}
      </>
    );
  }

  const offsets = wordOffsets(words);
  // The words concatenate to the text, so a running code-point count lines each up with its marks.
  let cp = 0;
  return (
    <span className={`chat-words${showPinyin ? ' with-pinyin' : ''}`} lang={lang} data-testid="chat-words" data-read-aloud={markedChars ? 'marked' : undefined}>
      {words.map((w, i) => {
        const len = [...w.text].length;
        const marked = markedChars ? markedChars.slice(cp, cp + len) : null;
        cp += len;
        // A chip only for Chinese (as the Lab app's ChineseWords): an English word inside a Chinese
        // line stays plain — the explorer has nothing to show for it.
        if (isTappableWord(w.text) && looksLikeChinese(w.text)) {
          const isKnown = known.has(w.text.trim());
          const py = showPinyin ? wordPinyin(w) : '';
          return (
            <button
              key={i}
              type="button"
              className={`chat-word${isKnown ? ' known' : ''}`}
              aria-label={isKnown ? `${w.text} (in your decks)` : w.text}
              onClick={(e) => {
                // Picking messages / right after a long-press: the tap belongs to the message.
                if (suppressTap?.()) return;
                e.stopPropagation();
                onTapWord({ word: w, sentence: sentenceAround(text, offsets[i], offsets[i] + w.text.length) });
              }}
            >
              {py ? (
                <ruby>
                  {marked ? <MarkedChars chars={marked} /> : w.text}
                  <rt>{py}</rt>
                </ruby>
              ) : marked ? (
                <MarkedChars chars={marked} />
              ) : (
                w.text
              )}
            </button>
          );
        }
        if (w.text.includes('\n')) return <br key={i} />;
        return (
          <span key={i} className="chat-word-punct">
            {marked ? <MarkedChars chars={marked} /> : w.text}
          </span>
        );
      })}
      {extraAtEnd}
    </span>
  );
}
