import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CharWordStatus } from '@shared/chars';
import { sourceDeckForExplorer } from '@shared/decks/source-decks';
import { normalizeHanzi } from '@shared/import/parse';
import { explorerAddHint, explorerAddProblem, explorerAddPrompt, explorerAddStep, type ExplorerAddFillReason } from '@shared/explorer/addCard';
import { glossWords } from '../../api/client';
import { autoPinyin } from '../../utils/autoPinyin';
import { track, trackError } from '../../services/analytics';
import { invalidateKnownHanzi } from '../../services/readerWords';
import { addCardToSourceDeck, type AddedToDeck } from '../../services/sourceDecks';
import type { Chunk } from '../AddChunkModal';
import { BumpButton } from '../bumps/BumpButton';
import { AddedToDeckLine } from '../sourceDecks/AddedToDeckLine';
import { CardVariants } from './CardVariants';
import { useExplorer } from './ExplorerContext';

/** What the learner has of this word / character: null = still reading this device's cards. */
export interface CardTieInHave {
  /** Their notes with this spelling (empty = none). */
  noteIds: string[];
  /** "📚 You have this card in HSK 2" / "✓ Known — you have 性 as a card in HSK 5". */
  line: string;
  status?: CharWordStatus;
}

/**
 * The explorer's card tie-in (docs/LANGUAGE_EXPLORER.md): "📚 You have …" → Open card → /
 * ⚡ Study it today, or "+ Add as card" — ONE tap, no deck picker: the card goes straight into the
 * source deck of where the explorer was opened (a reader → "From readers", a chat → "From chats",
 * else "From the explorer"; shared/decks/source-decks.ts) and the footer says "✓ Added to … ·
 * Change". The Word view's pinned footer and the Character view's status block are both this.
 */
export function CardTieIn({
  kind,
  have,
  addLabel,
  chunk,
  onClose,
  testIds,
  className = 'xp-footer',
  hanzi,
}: {
  kind: 'word' | 'char';
  /** The word / character on screen (matched against the opener's just-made cards). */
  hanzi?: string;
  have: CardTieInHave | null;
  addLabel: string;
  /**
   * What "+ Add" saves — built when tapped, and may WAIT for the view's in-flight lookups (the
   * button says "Adding…" meanwhile), so a fast tap never saves a card without its meaning.
   */
  chunk: () => Chunk | Promise<Chunk>;
  /** Close the explorer (Open card navigates away). */
  onClose: () => void;
  testIds: { root: string; checking: string; add: string };
  className?: string;
}) {
  const navigate = useNavigate();
  const explorer = useExplorer();
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // What "+ Add" just made: the note isn't in this device's store until the sync it starts
  // finishes, so the footer offers ⚡ Study it today / Open card for it straight away (before,
  // "✓ Added" was all — Jerome closed and reopened the explorer until the card showed up).
  const [added, setAdded] = useState<(AddedToDeck & { noteId: string; hanzi: string }) | null>(null);
  const [bumpMsg, setBumpMsg] = useState<string | null>(null);
  // A card the opener just made (Claude's "✓ Added" chips): not on this device until the sync
  // lands, so it shows as added — never "+ Add as card" again.
  const hanziKey = hanzi ? normalizeHanzi(hanzi) : '';
  const made = hanziKey && have && have.noteIds.length === 0 ? explorer.justAdded?.find((n) => normalizeHanzi(n.hanzi) === hanziKey) : undefined;
  const shownAdded = added ?? (made ? { key: sourceDeckForExplorer(explorer.source), noteIds: [made.noteId], deckId: made.deckId, deckName: made.deckName, noteId: made.noteId, hanzi: made.hanzi } : null);

  // The fill sheet (shared/explorer/addCard.ts): no meaning after the lookups + the gloss, or
  // offline — the meaning to type, never a raw "english is required".
  const [fill, setFill] = useState<{ chunk: Chunk; reason: ExplorerAddFillReason } | null>(null);
  const isOnline = useOnline();

  async function save(c: Chunk) {
    const key = sourceDeckForExplorer(explorer.source);
    setAdding(true);
    setAddError(null);
    try {
      const out = await addCardToSourceDeck(key, c, 'explorer');
      track('explorer.add_card', { kind, source_deck: true, deck_key: key });
      if (explorer.source === 'add') track('add.word_added', { via: 'card' });
      invalidateKnownHanzi();
      setFill(null);
      setAdded({ ...out, hanzi: c.hanzi });
    } catch (e) {
      trackError('add_card', e);
      setAddError(e instanceof Error ? e.message : "Couldn't add it — try again.");
    } finally {
      setAdding(false);
    }
  }

  async function add() {
    setAdding(true);
    setAddError(null);
    let c: Chunk;
    try {
      c = await chunk();
    } catch {
      c = { hanzi: hanzi ?? '', pinyin: '', english: '' };
    }
    const input = { hanzi: c.hanzi, pinyin: c.pinyin, english: c.english, devicePinyin: deviceWordPinyin(c.hanzi), online: isOnlineNow(), glossed: false };
    let step = explorerAddStep(input);
    if (step.kind === 'gloss') {
      // No meaning on the device (a word outside the 60k list): the gloss path fills it.
      const want = step.hanzi;
      const glossed = await glossWords([{ hanzi: want, ...(step.pinyin ? { pinyin: step.pinyin } : {}) }])
        .then((r) => r.find((w) => w.hanzi === want) ?? r[0] ?? null)
        .catch(() => null);
      track('explorer.add_gloss', { kind, found: !!glossed?.english?.trim() });
      step = explorerAddStep({ ...input, pinyin: step.pinyin || glossed?.pinyin || '', english: glossed?.english ?? '', online: isOnlineNow(), glossed: true });
    }
    if (step.kind === 'fill') {
      track('explorer.add_fill', { kind, reason: step.reason });
      setFill({ chunk: { ...c, hanzi: step.hanzi, pinyin: step.pinyin, english: step.english }, reason: step.reason });
      setAdding(false);
      return;
    }
    if (step.kind === 'add') await save({ ...c, hanzi: step.hanzi, pinyin: step.pinyin, english: step.english });
    else setAdding(false);
  }

  return (
    <div className={className} data-testid={testIds.root} data-status={have ? (have.noteIds.length ? have.status ?? 'in_decks' : 'none') : 'checking'}>
      {have === null ? (
        // Still reading this device's cards: a quiet placeholder — never nothing, never a
        // "+ Add" for something they already have.
        <div className="xp-have-line xp-checking" role="status" data-testid={testIds.checking}>📚 Checking your cards…</div>
      ) : have.noteIds.length > 0 ? (
        <div className={`xp-have${have.status === 'known' ? ' xp-have--known' : ''}`}>
          <div className="xp-have-line">{have.line}</div>
          {/* Where he's at with each card of the word (the study card ⋯ menu's tiles; docs/LANGUAGE_EXPLORER.md "Card variants"). */}
          <CardVariants noteId={have.noteIds[0]} hanzi={hanzi ?? ''} kind={kind} onBumped={setBumpMsg} />
          {bumpMsg && <div className="bump-hint" role="status">{bumpMsg}</div>}
          <div className="xp-footer-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                onClose();
                navigate(`/cards/${have.noteIds[0]}`);
              }}
            >
              Open card →
            </button>
            <BumpButton
              noteIds={have.noteIds}
              source="explorer"
              label="⚡ Study it today"
              onBumped={(m) => {
                track('explorer.bump', { kind });
                if (explorer.source === 'add') track('add.word_added', { via: 'bump' });
                setBumpMsg(m);
              }}
            />
          </div>
        </div>
      ) : shownAdded ? (
        <div className="xp-have" data-testid="xp-added">
          <AddedToDeckLine added={shownAdded} surface="explorer" onMoved={(now) => setAdded({ ...shownAdded, ...now })} className="xp-added-line" open={false} />
          {bumpMsg && <div className="bump-hint" role="status">{bumpMsg}</div>}
          <div className="xp-footer-row">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                onClose();
                navigate(`/cards/${shownAdded.noteId}`);
              }}
            >
              Open card →
            </button>
            <BumpButton
              noteIds={[shownAdded.noteId]}
              source="explorer"
              label="⚡ Study it today"
              hanziById={new Map([[shownAdded.noteId, shownAdded.hanzi]])}
              justCreated
              onBumped={(m) => {
                track('explorer.bump', { kind, just_added: true });
                if (explorer.source === 'add') track('add.word_added', { via: 'bump' });
                setBumpMsg(m);
              }}
            />
          </div>
        </div>
      ) : (
        fill ? (
          <MeaningFill
            chunk={fill.chunk}
            reason={fill.reason}
            online={isOnline}
            adding={adding}
            error={addError}
            onCancel={() => {
              setFill(null);
              setAddError(null);
            }}
            onSave={(c) => void save(c)}
          />
        ) : (
          <>
            {addError && <div className="xp-have-line xp-add-error" role="alert">{addError}</div>}
            <button type="button" className="btn btn-primary xp-add" onClick={() => void add()} disabled={adding} aria-busy={adding} data-testid={testIds.add}>
              {adding ? 'Adding…' : addError ? 'Try again' : addLabel}
            </button>
          </>
        )
      )}
    </div>
  );
}

const isOnlineNow = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/** The device's reading of a word (auto-pinyin + 一 / 不), one word = no spaces (zhège). */
function deviceWordPinyin(hanzi: string): string {
  try {
    return autoPinyin(hanzi).replace(/\s+/g, '');
  } catch {
    return '';
  }
}

/** navigator.onLine, kept current (the fill sheet's Add waits for a connection). */
function useOnline(): boolean {
  const [online, setOnline] = useState(isOnlineNow);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/**
 * The fill sheet in the explorer's footer (shared/explorer/addCard.ts): "What does 吴侬软语 mean?",
 * why it asks, the pinyin (the device's reading when the view had none) and the meaning to type.
 * Add waits for a connection — never a raw "english is required" / network error.
 */
function MeaningFill({
  chunk,
  reason,
  online,
  adding,
  error,
  onCancel,
  onSave,
}: {
  chunk: Chunk;
  reason: ExplorerAddFillReason;
  online: boolean;
  adding: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (c: Chunk) => void;
}) {
  const [pinyin, setPinyin] = useState(chunk.pinyin);
  const [english, setEnglish] = useState(chunk.english);
  const englishRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!chunk.english) englishRef.current?.focus();
  }, [chunk.english]);
  const problem = explorerAddProblem(english, online);
  const hint = online ? (reason === 'offline' ? 'You’re back online.' : explorerAddHint('no_meaning', false)) : explorerAddHint('offline', !!chunk.english);
  return (
    <form
      className="xp-fill"
      data-testid="explorer-add-fill"
      data-reason={reason}
      onSubmit={(e) => {
        e.preventDefault();
        if (problem || adding) return;
        onSave({ ...chunk, pinyin: pinyin.trim(), english: english.trim() });
      }}
    >
      <div className="xp-fill-q">{explorerAddPrompt(chunk.hanzi)}</div>
      <div className="xp-fill-hint" role="status" data-testid="explorer-add-fill-hint">{hint}</div>
      <label className="xp-fill-field">
        <span>Pinyin</span>
        <input value={pinyin} onChange={(e) => setPinyin(e.target.value)} autoComplete="off" autoCapitalize="off" data-testid="explorer-add-fill-pinyin" />
      </label>
      <label className="xp-fill-field">
        <span>Meaning</span>
        <input
          ref={englishRef}
          value={english}
          onChange={(e) => setEnglish(e.target.value)}
          placeholder="In English"
          autoComplete="off"
          enterKeyHint="done"
          data-testid="explorer-add-fill-english"
        />
      </label>
      {error && <div className="xp-have-line xp-add-error" role="alert">{error}</div>}
      <div className="xp-footer-row">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!!problem || adding} data-testid="explorer-add-fill-save">
          {adding ? 'Adding…' : !online ? 'Waiting for a connection…' : 'Add as card'}
        </button>
      </div>
    </form>
  );
}
