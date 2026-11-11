import { BumpByHanzi } from '../bumps/BumpButton';
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { addedToDeckLine, sourceDeckName, type SourceDeckKey } from '@shared/decks/source-decks';
import { proposeChatFlashcards } from '../../api/chat';
import { addCardsToSourceDeck, type AddedToDeck } from '../../services/sourceDecks';
import { AddedToDeckLine } from '../sourceDecks/AddedToDeckLine';
import { invalidateKnownHanzi } from '../../services/readerWords';
import { track, trackError } from '../../services/analytics';
import {
  batchNotesFrom,
  draftsFromProposal,
  proposeBodyFor,
  scopeLabel,
  type CardDraft,
  type FlashcardScope,
} from '../../services/chatLearning';
import { describeError } from './InlineNotice';
import type { ProposedChatCard } from '../../types';
import { SpinnerButton } from './SpinnerButton';

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; text: string; retryable: boolean }
  | { kind: 'ready' };

function snippet(text: string, max = 70): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * Make flashcards from this chat (docs/CHAT.md PR 3): Claude proposes cards
 * from the picked messages (or today's / the last 50), each one editable and
 * ticked unless it is already in my decks, then one tap adds them all — no deck
 * to choose (docs/STUDY_SESSION.md "Source decks"): straight into "From chats"
 * (a Claude chat's: "From Claude"; `POST /api/decks/source:chats/notes/batch`),
 * then "✓ 3 cards added to From chats · Change" (Change moves them) and Done.
 */
export function MakeFlashcardsSheet({
  conversationId,
  scope,
  sourceText,
  onClose,
  onAdded,
  propose: proposeOverride,
  fromLabel,
  initiallyChecked,
  onAddedCount,
  deckSource = 'chats',
}: {
  conversationId: string;
  /** The source deck the cards go to (shared/decks/source-decks.ts). */
  deckSource?: SourceDeckKey;
  scope: FlashcardScope;
  /**
   * Another conversation's proposals (a Claude chat: `POST /api/coach/conversations/:id/flashcards/propose`);
   * default = the tutor chat's propose for `scope`.
   */
  propose?: () => Promise<{ cards: ProposedChatCard[] }>;
  /** "From …" under the title (default: the scope's label). */
  fromLabel?: string;
  /** Which proposals start ticked (default: every card not already in my decks). */
  initiallyChecked?: (card: ProposedChatCard) => boolean;
  /** Replaces the chat's `chat.make_flashcards` event. */
  onAddedCount?: (count: number) => void;
  /** The text of a source message (for the "from …" line under a card). */
  sourceText: (messageId: string) => string | null;
  onClose: () => void;
  onAdded: (summary: string) => void;
}) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [drafts, setDrafts] = useState<CardDraft[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [added, setAdded] = useState<AddedToDeck | null>(null);

  const propose = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      const res = proposeOverride ? await proposeOverride() : await proposeChatFlashcards(conversationId, proposeBodyFor(scope));
      const drafts = draftsFromProposal(res.cards || []);
      setDrafts(initiallyChecked ? drafts.map((d) => ({ ...d, checked: initiallyChecked(d) })) : drafts);
      setPhase({ kind: 'ready' });
    } catch (error) {
      const status = (error as { status?: number }).status;
      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      setPhase({
        kind: 'error',
        text: offline ? 'Making cards needs a connection.' : describeError(error, "Claude couldn't make cards from these messages."),
        retryable: offline || status === undefined || status === 503 || status >= 500,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, scope]);

  useEffect(() => {
    void propose();
  }, [propose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const update = (key: string, patch: Partial<CardDraft>) =>
    setDrafts((list) => list.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const notes = batchNotesFrom(drafts);
  const count = notes.length;

  const add = async () => {
    if (count === 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const out = await addCardsToSourceDeck(deckSource, notes, 'chat_flashcards');
      const res = out.result;
      invalidateKnownHanzi();
      void queryClient.invalidateQueries({ queryKey: ['decks'] });
      const created = res.created?.length ?? 0;
      if (onAddedCount) onAddedCount(created);
      else track('chat.make_flashcards', { count: created, focus: scope.kind });
      if (!res.failed || res.failed.length === 0) {
        // Stay open on "✓ N cards added to From chats · Change" — Done closes.
        setAdded(out);
        return;
      }
      // Keep only what failed, with the reason, so it can be fixed and added again.
      const failedHanzi = new Map(res.failed.map((f) => [f.hanzi, f.error]));
      setDrafts((list) => list.filter((d) => d.checked && failedHanzi.has(d.hanzi.trim())));
      if (created) setAdded(out);
      setSaveError(
        `${res.failed.length} couldn't be added: ${res.failed
          .map((f) => `${f.hanzi} — ${f.error}`)
          .join('; ')}`,
      );
    } catch (error) {
      trackError('chat_make_flashcards', error);
      setSaveError(describeError(error, "Couldn't add the cards."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay chat-cards-overlay" onClick={onClose}>
      <div className="modal chat-cards-modal" role="dialog" aria-label="Make flashcards" onClick={(e) => e.stopPropagation()}>
        <div className="chat-cards-head">
          <div>
            <h3>Make flashcards</h3>
            <div className="chat-cards-sub">From {fromLabel ?? scopeLabel(scope)}</div>
          </div>
          <button type="button" className="chat-cards-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="chat-cards-body">
          {phase.kind === 'loading' && (
            <div className="chat-cards-status" role="status">
              <span className="chat-spinner" aria-hidden="true" /> Claude is reading {fromLabel ?? scopeLabel(scope)}…
            </div>
          )}
          {phase.kind === 'error' && (
            <div className="chat-cards-status">
              <div className="chat-notice chat-notice-error" role="alert">
                <span className="chat-notice-text">{phase.text}</span>
              </div>
              {phase.retryable && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void propose()}>
                  Try again
                </button>
              )}
            </div>
          )}
          {phase.kind === 'ready' && drafts.length === 0 && (
            <div className="chat-cards-status">No new words to make cards from in {fromLabel ?? scopeLabel(scope)}.</div>
          )}
          {phase.kind === 'ready' && added && !saveError && (
            <div className="chat-cards-status" data-testid="chat-cards-added">
              {added.noteIds.length} new card{added.noteIds.length === 1 ? '' : 's'} — they come up in your study like any new cards.
            </div>
          )}
          {phase.kind === 'ready' &&
            !(added && !saveError) &&
            drafts.map((d) => {
              const src = d.source_message_id ? sourceText(d.source_message_id) : null;
              const open = editing === d.key;
              return (
                <div key={d.key} className={`chat-card-item${d.checked ? '' : ' off'}`} data-testid="chat-card-item">
                  <label className="chat-card-check">
                    <input
                      type="checkbox"
                      checked={d.checked}
                      onChange={(e) => update(d.key, { checked: e.target.checked })}
                      aria-label={`Add ${d.hanzi}`}
                    />
                  </label>
                  <div className="chat-card-main">
                    {open ? (
                      <div className="chat-card-fields">
                        <label>
                          Hanzi
                          <input value={d.hanzi} lang="zh" onChange={(e) => update(d.key, { hanzi: e.target.value })} aria-label="Hanzi" />
                        </label>
                        <label>
                          Pinyin
                          <input value={d.pinyin} onChange={(e) => update(d.key, { pinyin: e.target.value })} aria-label="Pinyin" />
                        </label>
                        <label>
                          English
                          <input value={d.english} onChange={(e) => update(d.key, { english: e.target.value })} aria-label="English" />
                        </label>
                        <label>
                          Explanation
                          <textarea rows={3} value={d.fun_facts} onChange={(e) => update(d.key, { fun_facts: e.target.value })} aria-label="Explanation" />
                        </label>
                        <label>
                          Example sentence
                          <input
                            value={d.sentence_clue || ''}
                            lang="zh"
                            onChange={(e) => update(d.key, { sentence_clue: e.target.value })}
                            aria-label="Example sentence"
                          />
                        </label>
                        {(d.sentence_clue || '').trim() && (
                          <>
                            <label>
                              Sentence pinyin
                              <input value={d.sentence_clue_pinyin || ''} onChange={(e) => update(d.key, { sentence_clue_pinyin: e.target.value })} />
                            </label>
                            <label>
                              Sentence English
                              <input
                                value={d.sentence_clue_translation || ''}
                                onChange={(e) => update(d.key, { sentence_clue_translation: e.target.value })}
                              />
                            </label>
                          </>
                        )}
                        <button type="button" className="chat-link-btn" onClick={() => setEditing(null)}>
                          Done
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="chat-card-summary" onClick={() => setEditing(d.key)} aria-label={`Edit ${d.hanzi}`}>
                        <span className="chat-card-line">
                          <span className="chat-card-hanzi" lang="zh">
                            {d.hanzi}
                          </span>
                          <span className="chat-card-pinyin">{d.pinyin}</span>
                        </span>
                        <span className="chat-card-english">{d.english}</span>
                        {d.sentence_clue && (
                          <span className="chat-card-sentence" lang="zh">
                            {d.sentence_clue}
                          </span>
                        )}
                        {d.already_have && <span className="chat-card-have">Already in your decks</span>}
                        {src && <span className="chat-card-source">From “{snippet(src)}”</span>}
                        <span className="chat-card-edit">Edit</span>
                      </button>
                    )}
                    {d.already_have && editing !== d.key && (
                      <div className="chat-card-bump">
                        <BumpByHanzi hanzi={d.hanzi} source="chat" label="⚡ Study it today" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>

        {phase.kind === 'ready' && drafts.length > 0 && (
          <div className="chat-cards-foot">
            {added && <AddedToDeckLine added={added} surface="chat_flashcards" onMoved={setAdded} />}
            {saveError && (
              <div className="chat-notice chat-notice-error" role="alert">
                <span className="chat-notice-text">{saveError}</span>
              </div>
            )}
            {added && !saveError ? (
              <button
                type="button"
                className="btn btn-primary chat-cards-add"
                onClick={() => onAdded(`${addedToDeckLine(added.deckName, added.noteIds.length)}.`)}
                data-testid="chat-cards-done"
              >
                Done
              </button>
            ) : (
              <SpinnerButton
                type="button"
                className="btn btn-primary chat-cards-add"
                busy={saving}
                disabled={count === 0}
                onClick={() => void add()}
              >
                {count === 0 ? 'Pick a card' : `Add ${count} card${count === 1 ? '' : 's'} to ${sourceDeckName(deckSource)}`}
              </SpinnerButton>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
