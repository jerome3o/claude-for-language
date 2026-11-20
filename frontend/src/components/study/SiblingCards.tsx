import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  missingSiblingLine,
  missingSiblingTypes,
  siblingBumpedMessage,
  siblingBumpLabel,
  siblingTileLabel,
  siblingTiles,
  siblingTypeMeta,
  type SiblingAction,
  type SiblingTile,
} from '@shared/decks';
import { db, getStudyCutoff, localDateKey, queueInput } from '../../db/database';
import { useCardHolds } from '../../services/cardHolds';
import { bumpCardTypes } from '../../services/studyBumps';
import { track, trackError } from '../../services/analytics';
import './SiblingCards.css';

/**
 * The word's other card types — the top row of the study card's ⋯ menu (shared/decks/sibling-status.ts;
 * docs/STUDY_SESSION.md "The word's other cards in ⋯"). One tile per OTHER card: 读 / 写 / 听, its status
 * from the card's replayed state on this device (offline), a three-step strength bar. A tap opens the
 * card's small sheet (SiblingCardSheet): ⚡ Study it today · Snooze / Suspend (or Unsuspend / Wake now) ·
 * Forget · Open card details. Replaces "Practise this word other ways…" (the same card-level ⚡ bump).
 */

export interface SiblingScope {
  noteId: string;
  currentCardId: string;
  currentCardType: string;
  /** Card ids already in today's study (the session's queue + the ⚡ pocket). */
  inToday: ReadonlySet<string>;
  /** False in a homework pass (its own ⚡ on the card). */
  canBump: boolean;
}

/** The tiles of the note, live from IndexedDB (cards, holds); undefined while loading. */
export function useSiblingTiles(scope: SiblingScope): { tiles: SiblingTile[]; missing: string[] } | undefined {
  const cards = useLiveQuery(() => db.cards.where('note_id').equals(scope.noteId).toArray(), [scope.noteId]);
  const holds = useCardHolds();
  if (!cards) return undefined;
  const tiles = siblingTiles(
    cards.map((c) => ({ ...queueInput(c), lapses: c.lapses })),
    scope.currentCardId,
    { cutoffMs: getStudyCutoff().ts, today: localDateKey(), holds, inToday: scope.inToday, canBump: scope.canBump }
  );
  return { tiles, missing: missingSiblingTypes(cards.map((c) => c.card_type), scope.currentCardType) };
}

export function StrengthBar({ strength, tone }: { strength: number; tone: string }) {
  return (
    <span className={`sibling-strength sibling-tone-${tone}`} aria-hidden="true">
      {[1, 2, 3].map((n) => (
        <span key={n} className={`sibling-strength-step${n <= strength ? ' is-on' : ''}`} />
      ))}
    </span>
  );
}

/** The ⋯ menu's top row: one tile per other card type (a disabled one for a type the word lacks). */
export function SiblingTilesRow({ scope, onOpen }: { scope: SiblingScope; onOpen: (tile: SiblingTile) => void }) {
  const data = useSiblingTiles(scope);
  if (!data || (data.tiles.length === 0 && data.missing.length === 0)) return null;
  return (
    <div className="sibling-tiles" role="group" aria-label="This word's other cards" data-testid="sibling-tiles">
      {data.tiles.map((t) => (
        <button
          key={t.card_id}
          type="button"
          className={`sibling-tile sibling-tone-${t.tone}`}
          aria-label={siblingTileLabel(t)}
          data-testid={`sibling-tile-${t.card_type}`}
          data-status={t.status}
          onClick={() => {
            track('study.sibling_open', { card_type: t.card_type, status: t.status });
            onOpen(t);
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
          <div key={type} className="sibling-tile is-missing" aria-disabled="true" data-testid={`sibling-tile-${type}`} data-status="missing">
            <span className="sibling-tile-head">
              <span className="sibling-tile-symbol" lang="zh">{meta.symbol}</span>
              <span className="sibling-tile-name">{meta.name}</span>
            </span>
            <span className="sibling-tile-line">{missingSiblingLine(type)}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * One other card's small sheet. Each action is the existing path: ⚡ = the card-level bump
 * (services/studyBumps bumpCardTypes, offline-first; the card joins this session via `onBumped` →
 * useStudySession addBumpedCards, a few cards after its sibling); Snooze / Suspend / Forget open the
 * existing sheets for THAT card; Unsuspend / Wake now release its hold.
 */
export function SiblingCardSheet({
  scope,
  cardId,
  hanzi,
  inSession,
  onBumped,
  onHold,
  onRelease,
  onForget,
  onDetails,
  onClose,
}: {
  scope: SiblingScope;
  cardId: string;
  hanzi: string;
  /** In a study session: a bumped card joins it ("comes up in a few cards"). */
  inSession: boolean;
  onBumped?: (cardIds: string[]) => void;
  /** Snooze… / Suspend… for this card (absent = not offered here). */
  onHold?: (mode: 'snooze' | 'suspend', tile: SiblingTile) => void;
  onRelease?: (tile: SiblingTile) => Promise<void> | void;
  onForget?: (tile: SiblingTile) => void;
  onDetails?: (tile: SiblingTile) => void;
  onClose: () => void;
}) {
  const data = useSiblingTiles(scope);
  const tile = data?.tiles.find((t) => t.card_id === cardId);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(onClose, 1600);
    return () => clearTimeout(t);
  }, [done, onClose]);

  if (!tile) return null;
  const act = (action: SiblingAction) => track('study.sibling_action', { card_type: tile.card_type, action });

  async function bump(t: SiblingTile) {
    if (busy || !t.bump) return;
    setBusy(true);
    setError(null);
    try {
      await bumpCardTypes(scope.noteId, [t.card_type], 'study_card');
      act('bump');
      onBumped?.([t.card_id]);
      setDone(siblingBumpedMessage(t, inSession));
    } catch (err) {
      trackError('study_sibling_bump', err);
      setError(err instanceof Error ? err.message : 'Could not add the card');
    } finally {
      setBusy(false);
    }
  }

  const items: Array<{ key: string; icon: string; label: string; hint?: string | null; disabled?: boolean; onClick: () => void }> = [];
  if (scope.canBump) {
    items.push({
      key: 'bump',
      icon: '⚡',
      label: siblingBumpLabel(tile.bump).replace(/^⚡ /, ''),
      hint: tile.bump ? null : tile.bump_note,
      disabled: !tile.bump || busy,
      onClick: () => void bump(tile),
    });
  }
  if (tile.release && onRelease) {
    items.push({
      key: 'release',
      icon: tile.release === 'unsuspend' ? '▶' : '⏰',
      label: tile.release === 'unsuspend' ? 'Unsuspend' : 'Wake now',
      onClick: () => {
        act(tile.release === 'unsuspend' ? 'unsuspend' : 'wake');
        void Promise.resolve(onRelease(tile)).then(() => onClose());
      },
    });
  } else if (onHold) {
    items.push({ key: 'snooze', icon: '💤', label: 'Snooze…', hint: 'Not today', onClick: () => { act('snooze'); onHold('snooze', tile); } });
    items.push({ key: 'suspend', icon: '⏸️', label: 'Suspend…', onClick: () => { act('suspend'); onHold('suspend', tile); } });
  }
  if (tile.can_forget && onForget) {
    items.push({ key: 'forget', icon: '↺', label: 'Forget this card…', hint: 'Back to New', onClick: () => { act('forget'); onForget(tile); } });
  }
  if (onDetails) {
    items.push({ key: 'details', icon: '📇', label: 'Open card details', onClick: () => { act('details'); onDetails(tile); } });
  }

  return (
    <>
      <div className="study-sheet-backdrop" onClick={busy ? undefined : onClose} role="presentation" />
      <div className="study-sheet sibling-sheet" role="dialog" aria-label={`${tile.name} card of ${hanzi}`} data-testid="sibling-sheet">
        <div className="study-sheet-grip" aria-hidden="true" />
        <div className={`sibling-sheet-head sibling-tone-${tile.tone}`}>
          <span className="sibling-sheet-symbol" lang="zh" aria-hidden="true">{tile.symbol}</span>
          <span className="sibling-sheet-text">
            <span className="sibling-sheet-title">
              {tile.detail} · <span lang="zh">{hanzi}</span>
            </span>
            <span className="sibling-sheet-status" data-testid="sibling-sheet-status">
              {tile.line}
              <StrengthBar strength={tile.strength} tone={tile.tone} />
            </span>
          </span>
        </div>
        {done ? (
          <div className="sibling-sheet-done" role="status" data-testid="sibling-sheet-done">✓ {done.replace(/^⚡ /, '')}</div>
        ) : (
          items.map((item) => (
            <button
              key={item.key}
              type="button"
              className="study-sheet-item"
              disabled={item.disabled}
              data-testid={`sibling-action-${item.key}`}
              onClick={item.onClick}
            >
              <span className="study-sheet-icon" aria-hidden="true">{item.icon}</span>
              <span className="study-sheet-label">{busy && item.key === 'bump' ? `${item.label}…` : item.label}</span>
              {item.hint && <span className="study-sheet-hint">{item.hint}</span>}
            </button>
          ))
        )}
        {error && <div className="study-inline-error" role="alert">{error}</div>}
      </div>
    </>
  );
}
