import { useEffect, useMemo, useState } from 'react';
import { autoPinyin } from '../../utils/autoPinyin';
import { autoCheckText, sayBetterState, type AutoCheckCard } from '@shared/chats/autoCheck';
import type { MessageWithSender } from '../../types';
import { AddChunkModal, type Chunk } from '../AddChunkModal';
import { CorrectionDiffLine } from './ChatCorrection';

const devicePinyin = (text: string) => autoPinyin(text, { nonZh: 'consecutive' }).replace(/\s+/g, ' ').trim();

const cardChunk = (card: AutoCheckCard): Chunk => ({ hanzi: card.hanzi, pinyin: card.pinyin, english: card.english, fun_facts: card.fun_facts || undefined });

/**
 * "✨ How to say it better" (docs/CHAT.md "Auto-check"): what I wrote with the
 * wrong parts marked, the better sentence (pinyin, ▶), each mistake with why,
 * a more natural way if there is one, and cards. Built from the stored result
 * (or the tutor's correction, which wins), so it works offline.
 */
export function SayBetterSheet({
  message,
  viewerId,
  tutorName,
  playing,
  onPlay,
  onDiscuss,
  onOpenCoach,
  onClose,
}: {
  message: MessageWithSender;
  viewerId: string;
  tutorName: string;
  playing: boolean;
  onPlay: (text: string) => void;
  onDiscuss: () => void;
  /** "Open in Coach": continue in the Sentence Coach with this result (docs/CHAT.md "Chat ↔ Coach"). */
  onOpenCoach?: () => void;
  onClose: () => void;
}) {
  const [adding, setAdding] = useState<Chunk | null>(null);
  const state = sayBetterState(message, viewerId);
  // A photo's caption / a voice message's transcript is what was checked.
  const checkedText = autoCheckText(message);
  const check = message.auto_check && message.auto_check.text === checkedText ? message.auto_check : null;
  const correction = state === 'corrected' ? message.correction! : null;

  const view = useMemo(() => {
    const original = checkedText;
    if (correction) {
      const sameAsCheck = check && check.corrected === correction.text;
      const pinyin = sameAsCheck && check.corrected_pinyin ? check.corrected_pinyin : devicePinyin(correction.text);
      const english = sameAsCheck ? check.corrected_english : '';
      return {
        original,
        corrected: correction.text,
        pinyin,
        english,
        note: correction.note,
        mistakes: sameAsCheck ? check.mistakes : [],
        alternative: sameAsCheck ? check.alternative : null,
        card: { hanzi: correction.text, pinyin, english: english || message.translation || '', fun_facts: correction.note || undefined } as Chunk,
      };
    }
    if (!check) return null;
    return {
      original,
      corrected: check.corrected,
      pinyin: check.corrected_pinyin || devicePinyin(check.corrected),
      english: check.corrected_english,
      note: null as string | null,
      mistakes: check.mistakes,
      alternative: check.alternative,
      card: check.card
        ? cardChunk(check.card)
        : { hanzi: check.corrected, pinyin: check.corrected_pinyin || devicePinyin(check.corrected), english: check.corrected_english },
    };
  }, [message, check, correction, checkedText]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !adding && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [adding, onClose]);

  if (adding) return <AddChunkModal source="chat" chunk={adding} onClose={() => setAdding(null)} />;
  if (!view) return null;

  return (
    <div className="msg-sheet-overlay" onClick={onClose}>
      <div
        className="msg-sheet chat-saybetter-sheet"
        role="dialog"
        aria-label="How to say it better"
        data-testid="chat-saybetter-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="msg-sheet-handle" aria-hidden="true" />
        <h3 className="chat-saybetter-title">
          <span aria-hidden="true">✨</span> How to say it better
        </h3>
        {correction && (
          <div className="chat-saybetter-by">
            <span aria-hidden="true">✏️</span> {tutorName.split(' ')[0]} corrected this
          </div>
        )}

        <div className="chat-saybetter-label">You wrote</div>
        <div className="chat-saybetter-original" data-testid="chat-saybetter-diff">
          <CorrectionDiffLine original={view.original} corrected={view.corrected} />
        </div>

        <div className="chat-saybetter-label">Better</div>
        <div className="chat-saybetter-better">
          <div className="chat-saybetter-better-text">
            <div className="chat-saybetter-hanzi" lang="zh" data-testid="chat-saybetter-corrected">{view.corrected}</div>
            {view.pinyin && <div className="chat-saybetter-pinyin">{view.pinyin}</div>}
            {view.english && <div className="chat-saybetter-english">{view.english}</div>}
          </div>
          <button
            type="button"
            className={`chat-saybetter-play${playing ? ' playing' : ''}`}
            onClick={() => onPlay(view.corrected)}
            aria-label={playing ? 'Stop' : 'Play the better sentence'}
          >
            {playing ? '■' : '▶'}
          </button>
        </div>
        {view.note && <div className="chat-saybetter-note">{view.note}</div>}

        {view.mistakes.length > 0 && (
          <ul className="chat-saybetter-mistakes" data-testid="chat-saybetter-mistakes">
            {view.mistakes.map((m, i) => (
              <li key={i} className="chat-saybetter-mistake">
                <div className="chat-saybetter-mistake-main">
                  <div className="chat-saybetter-fix" lang="zh">
                    {m.quote ? (
                      <>
                        你说 <del>{m.quote}</del> → <ins>{m.fix}</ins>
                      </>
                    ) : (
                      <>
                        Missing: <ins>{m.fix}</ins>
                      </>
                    )}
                  </div>
                  <div className="chat-saybetter-why">{m.why}</div>
                </div>
                {m.card && (
                  <button type="button" className="chat-saybetter-card-btn" onClick={() => setAdding(cardChunk(m.card!))} aria-label={`Add ${m.card.hanzi} as a card`}>
                    + card
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {view.alternative && (
          <div className="chat-saybetter-alt">
            <div className="chat-saybetter-label">More natural</div>
            <div className="chat-saybetter-alt-hanzi" lang="zh">{view.alternative.hanzi}</div>
            {view.alternative.pinyin && <div className="chat-saybetter-pinyin">{view.alternative.pinyin}</div>}
            {view.alternative.english && <div className="chat-saybetter-english">{view.alternative.english}</div>}
            {view.alternative.note && <div className="chat-saybetter-why">{view.alternative.note}</div>}
          </div>
        )}

        <div className="chat-saybetter-actions">
          <button type="button" className="chat-saybetter-add" onClick={() => setAdding(view.card)} data-testid="chat-saybetter-add">
            + Add as flashcard
          </button>
          <button type="button" className="chat-saybetter-ask" onClick={onDiscuss}>
            💬 Ask Claude about this
          </button>
          {onOpenCoach && (
            <button type="button" className="chat-saybetter-ask" onClick={onOpenCoach} data-testid="chat-saybetter-open-coach">
              🎓 Open in Coach
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
