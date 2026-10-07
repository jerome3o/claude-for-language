import { useEffect, useMemo, useState } from 'react';
import { addNewWordsButton, newWordCards, type CoachWord } from '@shared/coach';
import { createNotesBatch, enrichWords, glossWords, type BatchNotesResult } from '../../api/client';
import { autoPinyin } from '../../utils/autoPinyin';
import type { LocalDeck } from '../../db/database';
import { bumpNotes } from '../../services/studyBumps';
import { syncService } from '../../services/sync';
import { track, trackError } from '../../services/analytics';
import '../bumps/bumps.css';

/**
 * The Coach's "➕ Add new words (N)" (shared/coach/newWords.ts; docs/CHAT.md
 * "Chat ↔ Coach"): the words of the sentence that are in none of his decks, one
 * row each, NOTHING ticked (like the bump picker). The ticked ones become full
 * cards — pinyin + meaning from the breakdown, the explanation (fun_facts) and a
 * short example written by the enrich path — in ONE batch call into the chosen
 * deck (the top of the study queue by default). A word that turns out to be in a
 * deck already is not added again: it gets "⚡ Study it today" instead.
 */
export function NewWordsSheet({
  words: given,
  sentence,
  decks,
  onAdded,
  onClose,
}: {
  words: CoachWord[];
  sentence: { hanzi: string; pinyin?: string | null; translation?: string | null };
  /** In study-queue order: the first is the default. */
  decks: LocalDeck[];
  /** The words now in a deck (added, or found there), so the chip stops offering them before the sync lands. */
  onAdded?: (hanzi: string[]) => void;
  onClose: () => void;
}) {
  // A breakdown row without pinyin gets the device's (with the 一 / 不 tone changes).
  const words = useMemo(() => given.map((w) => (w.pinyin ? w : { ...w, pinyin: autoPinyin(w.hanzi) })), [given]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [deckId, setDeckId] = useState(decks[0]?.id ?? '');
  const [stage, setStage] = useState<'pick' | 'saving' | 'done'>('pick');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BatchNotesResult | null>(null);
  const [bumped, setBumped] = useState<Set<string>>(() => new Set());
  const deck = decks.find((d) => d.id === deckId) ?? null;
  const chosen = words.filter((w) => picked.has(w.hanzi));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stage !== 'saving') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, stage]);

  const toggle = (hanzi: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(hanzi)) next.delete(hanzi);
      else next.add(hanzi);
      return next;
    });

  async function add() {
    if (stage !== 'pick' || chosen.length === 0 || !deck) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError("You're offline — adding cards needs a connection. Your ticks are kept.");
      return;
    }
    setStage('saving');
    setError(null);
    // A word without a meaning gets one first (Haiku, one call) — a card needs it.
    let ready = chosen;
    if (chosen.some((w) => !w.gloss)) {
      const glossed = await glossWords(chosen.map((w) => ({ hanzi: w.hanzi, pinyin: w.pinyin, english: w.gloss || undefined }))).catch(() => []);
      const english = new Map(glossed.map((g) => [g.hanzi, g.english]));
      ready = chosen.map((w) => (w.gloss ? w : { ...w, gloss: english.get(w.hanzi) ?? '' }));
    }
    const cards = newWordCards(ready, sentence);
    // The explanation (and a shorter example) to the card standard; the cards are saved without
    // it when Claude can't be reached — the meaning and the sentence they came from are enough.
    const enriched = await enrichWords(cards.map((c) => ({ hanzi: c.hanzi, pinyin: c.pinyin, english: c.english }))).catch((err) => {
      console.warn('[coach] enrich-words failed, saving without explanations', err);
      return [];
    });
    const byHanzi = new Map(enriched.map((e) => [e.hanzi, e]));
    const notes = cards.map((c) => {
      const e = byHanzi.get(c.hanzi);
      const ownClue = e?.sentence_clue && e.sentence_clue.includes(c.hanzi);
      return {
        ...c,
        ...(e?.fun_facts ? { fun_facts: e.fun_facts } : {}),
        ...(ownClue
          ? { sentence_clue: e!.sentence_clue, sentence_clue_pinyin: e!.sentence_clue_pinyin, sentence_clue_translation: e!.sentence_clue_translation }
          : {}),
      };
    });
    try {
      const res = await createNotesBatch(deck.id, notes, { skipExisting: true });
      setResult(res);
      setStage('done');
      onAdded?.([...res.created.map((n) => n.hanzi), ...(res.existing ?? []).map((e) => e.hanzi)]);
      track('coach.add_new_words', { count: res.created.length, existing: res.existing?.length ?? 0 });
      syncService.incrementalSync().catch(console.error);
    } catch (err) {
      trackError('coach_add_new_words', err);
      setError(err instanceof Error && err.message && !/^HTTP \d+$/.test(err.message) ? err.message : "Couldn't add the cards — try again.");
      setStage('pick');
    }
  }

  async function bump(noteId: string) {
    await bumpNotes([noteId], 'coach');
    setBumped((prev) => new Set(prev).add(noteId));
  }

  return (
    <div className="modal-overlay" onClick={stage === 'saving' ? undefined : onClose}>
      <div
        className="modal sentence-bump-sheet coach-new-words-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Add new words"
        data-testid="coach-new-words-sheet"
      >
        <div className="modal-header">
          <h2 className="modal-title">{stage === 'done' && result && result.created.length > 0 ? 'Cards added' : 'Add new words'}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close" disabled={stage === 'saving'}>&times;</button>
        </div>

        {stage !== 'done' ? (
          <>
            <p className="sentence-bump-help">These words aren’t in any of your decks yet. Tick the ones to learn.</p>
            <ul className="sentence-bump-list">
              {words.map((w) => (
                <li key={w.hanzi}>
                  <label className="sentence-bump-row" data-testid="coach-new-word-row">
                    <input
                      type="checkbox"
                      checked={picked.has(w.hanzi)}
                      disabled={stage === 'saving'}
                      onChange={() => toggle(w.hanzi)}
                      aria-label={w.hanzi}
                    />
                    <span className="sentence-bump-text">
                      <span className="sentence-bump-hanzi" lang="zh">{w.hanzi}</span>
                      {w.pinyin && <span className="sentence-bump-pinyin">{w.pinyin}</span>}
                      {w.gloss && <span className="sentence-bump-english">{w.gloss}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {decks.length > 0 && (
              <label className="coach-quick-deck coach-new-words-deck">
                <span>Add to</span>
                <select className="coach-deck-select" value={deckId} onChange={(e) => setDeckId(e.target.value)} disabled={stage === 'saving'} data-testid="coach-new-words-deck">
                  {decks.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </label>
            )}
            {error && <div className="coach-error mt-3" role="alert">{error}</div>}
            <div className="modal-actions sheet-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={stage === 'saving'}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary sentence-bump-add"
                onClick={add}
                disabled={stage === 'saving' || chosen.length === 0 || !deck}
                data-testid="coach-new-words-add"
              >
                {stage === 'saving' ? 'Adding…' : addNewWordsButton(chosen.length)}
              </button>
            </div>
          </>
        ) : (
          <>
            {result && result.created.length > 0 && (
              <p className="coach-new-words-done" role="status" data-testid="coach-new-words-done">
                ✓ Added {result.created.length} card{result.created.length === 1 ? '' : 's'} to {deck?.name}: {result.created.map((n) => n.hanzi).join('、')}
              </p>
            )}
            {result?.existing && result.existing.length > 0 && (
              <ul className="sentence-bump-list">
                {result.existing.map((e) => (
                  <li key={e.note_id} className="sentence-bump-row coach-new-words-existing">
                    <span className="sentence-bump-text">
                      <span className="sentence-bump-hanzi" lang="zh">{e.hanzi}</span>
                      <span className="sentence-bump-english">Already in {e.deck_name}</span>
                    </span>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={bumped.has(e.note_id)} onClick={() => void bump(e.note_id)}>
                      {bumped.has(e.note_id) ? '⚡ In today' : '⚡ Study it today'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {result && result.failed.length > 0 && (
              <div className="coach-error mt-3" role="alert">
                Couldn’t add {result.failed.map((f) => f.hanzi).join('、')}: {result.failed[0].error}
              </div>
            )}
            <div className="modal-actions sheet-footer">
              <button type="button" className="btn btn-primary" onClick={onClose} data-testid="coach-new-words-close">Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
