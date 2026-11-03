import { useState } from 'react';
import { StudyMoreMenu, StudyMenuItem } from './StudyMoreMenu';

export const NEEDS_INTERNET = 'Needs internet';

/**
 * The one action row on the card back: Ask Claude · Edit card · ⋯. It sits
 * in the sticky footer above the ratings, so the sentences scroll underneath
 * it. Ask Claude works offline too (the card's thread reads from the device and a
 * question waits until the connection is back — "Will send when you're online");
 * `aiDisabled` remains for callers that truly can't ask. The ⋯ opens the sheet
 * with everything else.
 */
export function StudyActionRow({
  onAskClaude,
  askClaudeOpen,
  onEditCard,
  aiDisabled,
  menuItems,
  menuFooter,
}: {
  onAskClaude: () => void;
  askClaudeOpen: boolean;
  onEditCard: () => void;
  /** Ask Claude can't be used here at all (not just offline). */
  aiDisabled?: boolean;
  menuItems: StudyMenuItem[];
  menuFooter?: string | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="study-action-row" data-testid="study-action-row">
      <button
        className="btn btn-secondary study-action-btn"
        onClick={onAskClaude}
        disabled={aiDisabled}
        title={aiDisabled ? NEEDS_INTERNET : 'Ask Claude about this word'}
        data-testid="study-ask-claude"
        aria-label={aiDisabled ? 'Ask Claude (needs internet)' : 'Ask Claude'}
      >
        <span aria-hidden="true">💬</span> {askClaudeOpen ? 'Hide' : 'Ask Claude'}
      </button>
      <button
        className="btn btn-secondary study-action-btn"
        onClick={onEditCard}
        title="Edit this card"
      >
        <span aria-hidden="true">✏️</span> Edit card
      </button>
      <button
        className="btn btn-secondary study-action-btn study-action-more"
        onClick={() => setMenuOpen(true)}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="More actions"
      >
        ⋯
      </button>
      <StudyMoreMenu open={menuOpen} items={menuItems} footer={menuFooter} onClose={() => setMenuOpen(false)} />
    </div>
  );
}
