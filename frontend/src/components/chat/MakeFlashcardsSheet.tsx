import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createDeck, createNotesBatch, getDecks } from '../../api/client';
import { proposeChatFlashcards } from '../../api/chat';
import { usePinnedDecks } from '../../hooks/usePinnedDecks';
import { invalidateKnownHanzi } from '../../services/readerWords';
import {
  batchNotesFrom,
  draftsFromProposal,
  initialDeck,
  loadLastDeck,
  proposeBodyFor,
  saveLastDeck,
  scopeLabel,
  type CardDraft,
  type FlashcardScope,
} from '../../services/chatLearning';
import { describeError } from './InlineNotice';
import { SpinnerButton } from './SpinnerButton';

const NEW_DECK = '__new__';

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
 * ticked unless it is already in my decks, then one tap adds them all to one
 * deck (`POST /api/decks/:id/notes/batch`). The deck is remembered.
 */
export function MakeFlashcardsSheet({
  conversationId,
  scope,
  sourceText,
  onClose,
  onAdded,
}: {
  conversationId: string;
  scope: FlashcardScope;
  /** The text of a source message (for the "from …" line under a card). */
  sourceText: (messageId: string) => string | null;
  onClose: () => void;
  onAdded: (summary: string) => void;
}) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [drafts, setDrafts] = useState<CardDraft[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [deckId, setDeckId] = useState('');
  const [newDeckName, setNewDeckName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { sortWithPinnedFirst, isPinned } = usePinnedDecks();

  const decksQuery = useQuery({ queryKey: ['decks'], queryFn: () => getDecks() });
  const decks = useMemo(() => sortWithPinnedFirst(decksQuery.data || []), [decksQuery.data, sortWithPinnedFirst]);

  useEffect(() => {
    if (!decksQuery.data || deckId) return;
    const first = initialDeck(decks, loadLastDeck());
    setDeckId(first || NEW_DECK);
  }, [decksQuery.data, decks, deckId]);

  const propose = useCallback(async () => {
    setPhase({ kind: 'loading' });
    try {
      const res = await proposeChatFlashcards(conversationId, proposeBodyFor(scope));
      setDrafts(draftsFromProposal(res.cards || []));
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
      let target = deckId;
      let deckName = decks.find((d) => d.id === deckId)?.name;
      if (target === NEW_DECK) {
        const name = newDeckName.trim();
        if (!name) throw new Error('Give the new deck a name.');
        const deck = await createDeck(name);
        target = deck.id;
        deckName = deck.name;
        setDeckId(deck.id);
        setNewDeckName('');
      }
      const res = await createNotesBatch(target, notes);
      saveLastDeck(target);
      invalidateKnownHanzi();
      void queryClient.invalidateQueries({ queryKey: ['decks'] });
      const created = res.created?.length ?? 0;
      if (!res.failed || res.failed.length === 0) {
        onAdded(`Added ${created} card${created === 1 ? '' : 's'} to ${deckName || 'your deck'}.`);
        return;
      }
      // Keep only what failed, with the reason, so it can be fixed and added again.
      const failedHanzi = new Map(res.failed.map((f) => [f.hanzi, f.error]));
      setDrafts((list) => list.filter((d) => d.checked && failedHanzi.has(d.hanzi.trim())));
      setSaveError(
        `${created ? `Added ${created} to ${deckName || 'your deck'}. ` : ''}${res.failed.length} couldn't be added: ${res.failed
          .map((f) => `${f.hanzi} — ${f.error}`)
          .join('; ')}`,
      );
    } catch (error) {
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
            <div className="chat-cards-sub">From {scopeLabel(scope)}</div>
          </div>
          <button type="button" className="chat-cards-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="chat-cards-body">
          {phase.kind === 'loading' && (
            <div className="chat-cards-status" role="status">
              <span className="chat-spinner" aria-hidden="true" /> Claude is reading {scopeLabel(scope)}…
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
            <div className="chat-cards-status">No new words to make cards from in {scopeLabel(scope)}.</div>
          )}
          {phase.kind === 'ready' &&
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
                  </div>
                </div>
              );
            })}
        </div>

        {phase.kind === 'ready' && drafts.length > 0 && (
          <div className="chat-cards-foot">
            <div className="chat-cards-deck">
              <label htmlFor="chat-cards-deck">Deck</label>
              <select id="chat-cards-deck" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
                {decks.map((deck) => (
                  <option key={deck.id} value={deck.id}>
                    {isPinned(deck.id) ? '📌 ' : ''}
                    {deck.name}
                  </option>
                ))}
                <option value={NEW_DECK}>＋ New deck…</option>
              </select>
            </div>
            {deckId === NEW_DECK && (
              <input
                type="text"
                className="new-deck-input chat-cards-newdeck"
                value={newDeckName}
                onChange={(e) => setNewDeckName(e.target.value)}
                placeholder="New deck name"
                aria-label="New deck name"
                maxLength={120}
              />
            )}
            {saveError && (
              <div className="chat-notice chat-notice-error" role="alert">
                <span className="chat-notice-text">{saveError}</span>
              </div>
            )}
            <SpinnerButton
              type="button"
              className="btn btn-primary chat-cards-add"
              busy={saving}
              disabled={count === 0 || !deckId || (deckId === NEW_DECK && !newDeckName.trim())}
              onClick={() => void add()}
            >
              {count === 0 ? 'Pick a card' : `Add ${count} card${count === 1 ? '' : 's'}`}
            </SpinnerButton>
          </div>
        )}
      </div>
    </div>
  );
}
