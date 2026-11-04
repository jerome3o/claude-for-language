/**
 * `/claude` — the learner's ✦ Claude tab (docs/CHAT.md "The Claude tab"; Jerome, Nov 2026: "it's not
 * obvious enough that you can just ask any question"). A fresh plain chat with Claude, the tab bar
 * under it, 🎤 dictating at once (Ask; ✏️ Type one tap away). The first message moves to the
 * thread's own page (`/chats/claude/:id`, replacing this one in history) — a normal Claude thread,
 * listed in Chats — so the tab is a new chat again next time.
 */
import { useNavigate } from 'react-router-dom';
import { ClaudeThreadView } from '../components/claude/ClaudeThreadView';
import { TabBar } from '../components/nav/TabBar';
import { moveRecapWords } from '../services/claudeChatRecap';
import { track } from '../services/analytics';

const GENERAL = { kind: 'general' } as const;

export function ClaudeTabPage() {
  const navigate = useNavigate();
  return (
    <div className="claude-tab-page" data-testid="claude-tab-page">
      <ClaudeThreadView
        threadId="new"
        newContext={GENERAL}
        source="claude_tab"
        hideBack
        autoListen
        onAutoListen={(listening) => track('claude.tab_open', { listening })}
        onThreadCreated={(threadId) => {
          moveRecapWords('new', threadId);
          navigate(`/chats/claude/${encodeURIComponent(threadId)}`, { replace: true });
        }}
      />
      <TabBar />
    </div>
  );
}

export default ClaudeTabPage;
