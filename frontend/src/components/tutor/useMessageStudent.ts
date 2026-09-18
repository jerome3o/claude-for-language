import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { openConversation } from '../../api/tutorDashboard';

/**
 * "Message" opens the most recent conversation directly (creating one when
 * there is none) — no title modal. Returns the click handler + busy flag.
 */
export function useMessageStudent(relId: string, knownConversationId?: string | null) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const message = async () => {
    if (knownConversationId) {
      navigate(`/connections/${relId}/chat/${knownConversationId}`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { conversation_id } = await openConversation(relId);
      navigate(`/connections/${relId}/chat/${conversation_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the conversation');
    } finally {
      setBusy(false);
    }
  };

  return { message, busy, error };
}
