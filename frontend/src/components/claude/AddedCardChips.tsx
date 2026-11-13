import { useNavigate } from 'react-router-dom';
import type { AddedCard } from '@shared/claude/cardTools';
import { itemForText } from '@shared/explorer';
import { track } from '../../services/analytics';
import { useExplorer, type JustAddedNote } from '../explorer/ExplorerContext';
import './added-card-chips.css';

/**
 * The words of Claude's "✓ Added 2 cards" line, each a chip (docs/CHAT.md "Claude thread view" →
 * "Cards Claude added"): a tap opens the language explorer on that word / sentence (source
 * `claude_card`), whose card tie-in shows it as just added — ⚡ Study it today / Open card — even
 * before the sync brings the new note to this device. Wraps; never a list.
 */
export function AddedCardChips({ cards, surface }: { cards: readonly AddedCard[]; surface: 'thread' | 'card_sheet' | 'coach' }) {
  const explorer = useExplorer();
  const navigate = useNavigate();
  if (cards.length === 0) return null;
  const justAdded: JustAddedNote[] = cards.map((c) => ({ noteId: c.note_id, hanzi: c.hanzi, deckId: c.deck_id ?? '', deckName: c.deck_name ?? 'From Claude' }));
  const open = (c: AddedCard) => {
    track('claude.added_card_open', { surface, count: cards.length });
    const item = itemForText(c.hanzi, { ...(c.pinyin ? { pinyin: c.pinyin } : {}), ...(c.english ? { gloss: c.english } : {}) });
    // No Chinese to explore (a card in Latin letters only): its card hub instead.
    if (!item) {
      navigate(`/cards/${c.note_id}`);
      return;
    }
    explorer.open(item, { source: 'claude_card', justAdded });
  };
  return (
    <span className="added-card-chips" data-testid="added-card-chips">
      {cards.map((c) => (
        <button
          key={c.note_id}
          type="button"
          className="added-card-chip"
          lang="zh-CN"
          onClick={(e) => {
            e.stopPropagation();
            open(c);
          }}
          aria-label={`Open ${c.hanzi} in the explorer`}
          title={c.english ?? undefined}
          data-testid="added-card-chip"
        >
          <span className="added-card-chip-text">{c.hanzi}</span>
          <span className="added-card-chip-go" aria-hidden="true">›</span>
        </button>
      ))}
    </span>
  );
}
