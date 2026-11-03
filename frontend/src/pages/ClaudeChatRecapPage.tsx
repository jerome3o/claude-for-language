import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { chatRecapRunId, recapEvent, recapSourceLabel } from '@shared/study/wordRecap';
import { openChatRecap } from '../services/wordRecap';
import { track } from '../services/analytics';
import { WordRecapPass } from '../components/readerRecap/WordRecapPass';

/**
 * `/coach/chat/:id/recap` — "📝 N words to recap" from a "💬 Ask Claude" chat's ⋯ menu: the SAME
 * word recap pass as the readers' (components/readerRecap/WordRecapPass) over the words tapped in
 * the chat and the words a 🎤 Read it back found mistakes in (services/claudeChatRecap.ts), each
 * card's cue the sentence of Claude's message it came from. Switches OFF by default: "Add to my
 * long-term review" → the "From my chats" deck + Up next; "⚡ Study it today" → a bump.
 * Immersive, offline-first.
 */
export function ClaudeChatRecapPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [ready, setReady] = useState(false);
  // The chat's run brought up to date with the words collected since (once per opening).
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    void openChatRecap(id).catch(() => null).finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [id]);
  const onRun = useCallback((words: number) => track(recapEvent('chat', 'start'), { from: 'menu', words }), []);
  if (!ready) return <div className="study-page-fullscreen"><div className="study-fullscreen" /></div>;
  return (
    <WordRecapPass
      runId={chatRecapRunId(id)}
      source="chat"
      sourceLabel={recapSourceLabel('chat')}
      backTo={{ path: `/coach/chat/${encodeURIComponent(id)}`, label: 'Back to the chat' }}
      onRun={onRun}
    />
  );
}

export default ClaudeChatRecapPage;
