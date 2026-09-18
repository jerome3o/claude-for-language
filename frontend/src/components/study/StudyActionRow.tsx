import { useState } from 'react';
import { StudyMoreMenu, StudyMenuItem } from './StudyMoreMenu';

export const NEEDS_INTERNET = 'Needs internet';

/**
 * The one action row on the card back: Ask Claude · Sentences · ⋯.
 * The AI buttons are disabled with a "needs internet" hint whenever study is
 * offline (automatic or forced); the ⋯ opens the sheet with everything else.
 */
export function StudyActionRow({
  onAskClaude,
  askClaudeOpen,
  onToggleSentences,
  sentencesOpen,
  sentencesNeedInternet,
  aiDisabled,
  menuItems,
  menuFooter,
}: {
  onAskClaude: () => void;
  askClaudeOpen: boolean;
  onToggleSentences: () => void;
  sentencesOpen: boolean;
  /** True when opening Sentences would have to generate them (no cached set). */
  sentencesNeedInternet: boolean;
  aiDisabled: boolean;
  menuItems: StudyMenuItem[];
  menuFooter?: string | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const sentencesDisabled = aiDisabled && sentencesNeedInternet && !sentencesOpen;

  return (
    <div className="study-action-row" data-testid="study-action-row">
      <button
        className="btn btn-secondary study-action-btn"
        onClick={onAskClaude}
        disabled={aiDisabled}
        title={aiDisabled ? NEEDS_INTERNET : 'Ask Claude about this word'}
        aria-label={aiDisabled ? 'Ask Claude (needs internet)' : 'Ask Claude'}
      >
        <span aria-hidden="true">💬</span> {askClaudeOpen ? 'Hide' : 'Ask Claude'}
      </button>
      <button
        className="btn btn-secondary study-action-btn"
        onClick={onToggleSentences}
        disabled={sentencesDisabled}
        aria-expanded={sentencesOpen}
        title={sentencesDisabled ? NEEDS_INTERNET : sentencesOpen ? 'Hide the sentences' : 'Example sentences for this word'}
      >
        <span aria-hidden="true">✨</span> {sentencesOpen ? 'Hide sentences' : 'Sentences'}
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
