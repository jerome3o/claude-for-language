import { forwardRef } from 'react';
import { itemForText } from '@shared/explorer';
import type { TranscriptRow } from '@shared/audio-lesson';
import { looksLikeChinese } from '@shared/chats/messageTools';
import { ChatWordsText, type TappedWord } from '../chat/ChatWords';
import { useExplorer } from '../explorer/ExplorerContext';
import '../chat/chat-learning.css';

/**
 * One row of an audio lesson's transcript (dialogue, sleep and story alike): the Chinese as word
 * chips made on the device (the chat / Ask Claude's ChatWordsText over the deterministic
 * segmenter, docs/LANGUAGE_EXPLORER.md "Word chips without an LLM") — a word opens the language
 * explorer's Word view; a tap anywhere else on the row seeks the audio to it. The row's pinyin and
 * English lines follow the player's 拼 / EN toggles.
 */
export const TranscriptLine = forwardRef<
  HTMLLIElement,
  {
    row: TranscriptRow;
    current: boolean;
    showPinyin: boolean;
    showEnglish: boolean;
    known: Set<string>;
    onSeek: (ms: number) => void;
  }
>(function TranscriptLine({ row, current, showPinyin, showEnglish, known, onSeek }, ref) {
  const explorer = useExplorer();
  const zh = row.lang === 'zh';
  const tapWord = ({ word, sentence }: TappedWord) => {
    const item = itemForText(word.text, { pinyin: word.pinyin || undefined, gloss: word.gloss || undefined, sentence });
    if (item) explorer.open(item, { source: 'audio_lesson' });
  };
  return (
    <li ref={ref} className={`al-line al-line-${row.lang} ${current ? 'current' : ''}`} onClick={() => onSeek(row.start_ms)}>
      <span className="al-line-text" lang={zh ? 'zh-CN' : 'en'}>
        {looksLikeChinese(row.text) ? (
          <ChatWordsText text={row.text} words={null} showPinyin={false} known={known} onTapWord={tapWord} lang={zh ? 'zh-CN' : 'en'} />
        ) : (
          row.text
        )}
        {row.repeat && (
          <span className="al-line-repeat" aria-label={`said ${row.repeat} times`}>
            ×{row.repeat}
          </span>
        )}
      </span>
      {showPinyin && row.pinyin && <span className="al-line-pinyin">{row.pinyin}</span>}
      {showEnglish && row.english && <span className="al-line-en">{row.english}</span>}
    </li>
  );
});
