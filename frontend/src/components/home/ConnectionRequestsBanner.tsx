import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { connectionRequestsLine } from '@shared/chats/personLinks';
import { getMyRelationships } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { getOtherUserInRelationship, isClaudeUser } from '../../types';
import { track } from '../../services/analytics';

/**
 * "🤝 Minghui wants to be your tutor ›" on Home while a connection request waits on me. The
 * learner's Tutor tab (where requests used to show) went in Nov 2026; a request opens More →
 * Tutors & connections (/connections), which has Accept / Decline. Online only — nothing shows
 * while the list can't be fetched.
 */
export function ConnectionRequestsBanner() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['relationships'],
    queryFn: getMyRelationships,
    enabled: !!user,
    staleTime: 60_000,
    retry: false,
  });
  if (!user || !query.data) return null;
  const waiting = query.data.pending_incoming.filter(
    (rel) => rel.requester_id !== user.id && !isClaudeUser(getOtherUserInRelationship(rel, user.id).id),
  );
  const line = connectionRequestsLine(
    waiting.map((rel) => {
      const other = getOtherUserInRelationship(rel, user.id);
      return { name: other.name || other.email, requesterRole: rel.requester_role };
    }),
  );
  if (!line) return null;
  return (
    <Link
      to="/connections"
      className="card hw-notes-row"
      data-testid="home-connection-requests"
      onClick={() => track('chat.connection_requests_open', { count: waiting.length })}
    >
      <span className="hw-notes-row-text">{line}</span>
      <span className="hw-notes-row-chevron" aria-hidden="true">›</span>
    </Link>
  );
}
