import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  bumpedCardsForNote,
  missingSiblingLine,
  missingSiblingTypes,
  siblingBumpedMessage,
  siblingBumpLabel,
  siblingTileLabel,
  siblingTiles,
  siblingTypeMeta,
  type SiblingTile,
} from '@shared/decks';
import { db, getStudyCutoff, loadQueueBumps, localDateKey, queueInput } from '../../db/database';
import { releaseCards, useCardHolds } from '../../services/cardHolds';
import { bumpCardTypes } from '../../services/studyBumps';
import { track, trackError } from '../../services/analytics';
import { StrengthBar } from '../study/SiblingCards';
import { useExplorer } from './ExplorerContext';
import '../study/SiblingCards.css';

/**
 * Where he's at with each card of the word — the explorer's "📚 You have this" block
 * (docs/LANGUAGE_EXPLORER.md "Card variants"). Jerome, Nov 2026: "If I've already got a card, in this
 * lookup view, from anywhere really, I'd love three little buttons … that show me where I'm at with
 * each variation of the card, like the answer card ⋯ menu."
 *
 * The SAME tiles as the study card's ⋯ menu (shared/decks/sibling-status.ts, components/study/SiblingCards.tsx):
 * 读 Read · 写 Write · 听 Listen with the status line and strength from this device's replayed card state
 * (offline), a dashed one for a type the word lacks. Here EVERY card of the note shows (no card is on
 * screen); "in today" = the cards the ⚡ pocket holds for the note. A tap opens the card's small panel
 * in place: ⚡ Study it today (the card-level bump the ⋯ menu makes) · Unsuspend / Wake now.
 */

/** Every card of the note as a tile, live from IndexedDB (cards, holds, the ⚡ pocket); undefined while loading. */
export function useWordCardTiles(noteId: string): { tiles: SiblingTile[]; missing: string[] } | undefined {
  const holds = useCardHolds();
  const data = useLiveQuery(async () => {
    const cards = await db.cards.where('note_id').equals(noteId).toArray();
    const cutoff = getStudyCutoff().ts;
    const inToday = new Set<string>();
    const pocket = await loadQueueBumps().catch(() => null);
    if (pocket) {
      const inputs = cards.map(queueInput);
      for (const b of pocket.bumps) {
        if (b.note_id !== noteId) continue;
        for (const c of bumpedCardsForNote(inputs, b, pocket.lastReviewMs, pocket.firstReviewMs, cutoff)) inToday.add(c.id);
      }
    }
    return { cards, inToday, cutoff };
  }, [noteId]);
  if (!data) return undefined;
  const tiles = siblingTiles(
    data.cards.map((c) => ({ ...queueInput(c), lapses: c.lapses })),
    '', // no card on screen: every card type of the word
    { cutoffMs: data.cutoff, today: localDateKey(), holds, inToday: data.inToday, canBump: true }
  );
  return { tiles, missing: data.cards.length ? missingSiblingTypes(data.cards.map((c) => c.card_type), '') : [] };
}

export function CardVariants({
  noteId,
  hanzi,
  kind,
  onBumped,
}: {
  /** The note the "📚 You have this" line points at (its Open card →). */
  noteId: string;
  hanzi: string;
  kind: 'word' | 'char';
  /** After ⚡ on a card: the line under the banner ("⚡ Listen → 汉字 added to today"). */
  onBumped?: (message: string) => void;
}) {
  const explorer = useExplorer();
  const data = useWordCardTiles(noteId);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setOpenId(null);
    setError(null);
  }, [noteId]);
  if (!data || (data.tiles.length === 0 && data.missing.length === 0)) return null;
  const open = data.tiles.find((t) => t.card_id === openId) ?? null;
  const act = (t: SiblingTile, action: string) => track('explorer.card_variant_action', { kind, card_type: t.card_type, action });

  async function bump(t: SiblingTile) {
    if (busy || !t.bump) return;
    setBusy(true);
    setError(null);
    try {
      await bumpCardTypes(noteId, [t.card_type], 'explorer');
      act(t, 'bump');
      if (explorer.source === 'add') track('add.word_added', { via: 'bump' });
      onBumped?.(siblingBumpedMessage(t, false));
      setOpenId(null);
    } catch (err) {
      trackError('explorer_variant_bump', err);
      setError(err instanceof Error ? err.message : 'Could not add the card');
    } finally {
      setBusy(false);
    }
  }

  async function release(t: SiblingTile) {
    if (busy || !t.release) return;
    setBusy(true);
    try {
      act(t, t.release);
      await releaseCards([t.card_id], 'explorer');
      setOpenId(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="xp-variants-wrap" data-testid="xp-variants">
      <div className="xp-variants" role="group" aria-label={`Your cards of ${hanzi}`}>
        {data.tiles.map((t) => (
          <button
            key={t.card_id}
            type="button"
            className={`sibling-tile xp-variant sibling-tone-${t.tone}${t.card_id === openId ? ' is-open' : ''}`}
            aria-label={siblingTileLabel(t)}
            aria-expanded={t.card_id === openId}
            data-testid={`xp-variant-${t.card_type}`}
            data-status={t.status}
            onClick={() => {
              setError(null);
              if (t.card_id === openId) {
                setOpenId(null);
                return;
              }
              track('explorer.card_variant_open', { kind, card_type: t.card_type, status: t.status });
              setOpenId(t.card_id);
            }}
          >
            <span className="sibling-tile-head">
              <span className="sibling-tile-symbol" lang="zh">{t.symbol}</span>
              <span className="sibling-tile-name">{t.name}</span>
              <StrengthBar strength={t.strength} tone={t.tone} />
            </span>
            <span className="sibling-tile-line">{t.line}</span>
          </button>
        ))}
        {data.missing.map((type) => {
          const meta = siblingTypeMeta(type);
          return (
            <div key={type} className="sibling-tile xp-variant is-missing" aria-disabled="true" data-testid={`xp-variant-${type}`} data-status="missing">
              <span className="sibling-tile-head">
                <span className="sibling-tile-symbol" lang="zh">{meta.symbol}</span>
                <span className="sibling-tile-name">{meta.name}</span>
              </span>
              <span className="sibling-tile-line">{missingSiblingLine(type)}</span>
            </div>
          );
        })}
      </div>
      {open && (
        <div className="xp-variant-panel" data-testid="xp-variant-panel">
          <div className="xp-variant-panel-head">
            <span lang="zh" aria-hidden="true">{open.symbol}</span> {open.detail} · <span lang="zh">{hanzi}</span>
          </div>
          <div className="xp-footer-row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!open.bump || busy}
              onClick={() => void bump(open)}
              data-testid="xp-variant-bump"
            >
              {busy && open.bump ? 'Adding…' : siblingBumpLabel(open.bump)}
            </button>
            {open.release && (
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void release(open)} data-testid="xp-variant-release">
                {open.release === 'unsuspend' ? '▶ Unsuspend' : '⏰ Wake now'}
              </button>
            )}
          </div>
          {!open.bump && open.bump_note && <div className="xp-variant-note" role="status">{open.bump_note}</div>}
          {error && <div className="xp-have-line xp-add-error" role="alert">{error}</div>}
        </div>
      )}
    </div>
  );
}
