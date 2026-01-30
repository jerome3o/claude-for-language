import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getRelationship,
  getConversations,
  createConversation,
  getSharedDecks,
  getStudentSharedDecks,
  shareDeck,
  removeRelationship,
  getDecks,
} from '../api/client';
import {
  getOtherUserInRelationship,
  getMyRoleInRelationship,
  Deck,
  isClaudeUser,
} from '../types';
import { Loading, ErrorMessage, EmptyState } from '../components/Loading';
import { useAuth } from '../contexts/AuthContext';
import './ConnectionDetailPage.css';

export function ConnectionDetailPage() {
  const { relId } = useParams<{ relId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [showShareModal, setShowShareModal] = useState(false);
  const [showNewConvModal, setShowNewConvModal] = useState(false);
  const [newConvTitle, setNewConvTitle] = useState('');
  const [newConvScenario, setNewConvScenario] = useState('');
  const [newConvUserRole, setNewConvUserRole] = useState('');
  const [newConvAIRole, setNewConvAIRole] = useState('');

  const relationshipQuery = useQuery({
    queryKey: ['relationship', relId],
    queryFn: () => getRelationship(relId!),
    enabled: !!relId,
  });

  const conversationsQuery = useQuery({
    queryKey: ['conversations', relId],
    queryFn: () => getConversations(relId!),
    enabled: !!relId,
  });

  const sharedDecksQuery = useQuery({
    queryKey: ['sharedDecks', relId],
    queryFn: () => getSharedDecks(relId!),
    enabled: !!relId,
  });

  // Student-shared decks (decks the student shared with the tutor)
  const studentSharedDecksQuery = useQuery({
    queryKey: ['studentSharedDecks', relId],
    queryFn: () => getStudentSharedDecks(relId!),
    enabled: !!relId,
  });

  const decksQuery = useQuery({
    queryKey: ['decks'],
    queryFn: getDecks,
    enabled: showShareModal,
  });

  const createConvMutation = useMutation({
    mutationFn: (options: { title?: string; scenario?: string; user_role?: string; ai_role?: string }) =>
      createConversation(relId!, options),
    onSuccess: (conv) => {
      queryClient.invalidateQueries({ queryKey: ['conversations', relId] });
      setShowNewConvModal(false);
      setNewConvTitle('');
      setNewConvScenario('');
      setNewConvUserRole('');
      setNewConvAIRole('');
      navigate(`/connections/${relId}/chat/${conv.id}`);
    },
  });

  const shareDeckMutation = useMutation({
    mutationFn: (deckId: string) => shareDeck(relId!, deckId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sharedDecks', relId] });
      setShowShareModal(false);
    },
  });

  const removeMutation = useMutation({
    mutationFn: () => removeRelationship(relId!),
    onSuccess: () => {
      navigate('/connections');
    },
  });

  const handleStartChat = () => {
    setShowNewConvModal(true);
  };

  const handleCreateConversation = (e: React.FormEvent) => {
    e.preventDefault();
    createConvMutation.mutate({
      title: newConvTitle.trim() || undefined,
      scenario: newConvScenario.trim() || undefined,
      user_role: newConvUserRole.trim() || undefined,
      ai_role: newConvAIRole.trim() || undefined,
    });
  };

  if (relationshipQuery.isLoading) {
    return <Loading />;
  }

  if (relationshipQuery.error || !relationshipQuery.data) {
    return <ErrorMessage message="Connection not found" />;
  }

  const relationship = relationshipQuery.data;
  const otherUser = getOtherUserInRelationship(relationship, user!.id);
  const myRole = getMyRoleInRelationship(relationship, user!.id);
  const iAmTutor = myRole === 'tutor';
  const isClaudeRelationship = isClaudeUser(otherUser.id);

  const conversations = conversationsQuery.data || [];
  const sharedDecks = sharedDecksQuery.data || [];
  const studentSharedDecks = studentSharedDecksQuery.data || [];

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="page">
      <div className="container">
        {/* Header */}
        <div className="connection-detail-header">
          <Link to="/connections" className="back-link">← Back</Link>
          <div className="connection-detail-user">
            {otherUser.picture_url ? (
              <img src={otherUser.picture_url} alt="" className="connection-detail-avatar" />
            ) : (
              <div className="connection-detail-avatar placeholder">
                {(otherUser.name || otherUser.email || '?')[0].toUpperCase()}
              </div>
            )}
            <div className="connection-detail-info">
              <h1>{otherUser.name || 'Unknown'}</h1>
              <span className={`role-badge ${myRole}`}>
                {iAmTutor ? 'Your Student' : 'Your Tutor'}
              </span>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="quick-actions">
          <button className="btn btn-primary" onClick={handleStartChat}>
            New Chat
          </button>
          {iAmTutor && (
            <>
              <button className="btn btn-secondary" onClick={() => setShowShareModal(true)}>
                Share Deck
              </button>
              <Link to={`/connections/${relId}/progress`} className="btn btn-secondary">
                View Progress
              </Link>
            </>
          )}
        </div>

        {/* Conversations */}
        <div className="detail-section">
          <h2>Conversations</h2>
          {conversationsQuery.isLoading ? (
            <Loading message="Loading conversations..." />
          ) : conversations.length === 0 ? (
            <EmptyState
              icon="💬"
              title="No conversations yet"
              description="Start a chat to discuss learning progress"
              action={
                <button className="btn btn-primary" onClick={handleStartChat}>
                  Start Chat
                </button>
              }
            />
          ) : (
            <div className="conversations-list">
              {conversations.map((conv) => (
                <Link
                  key={conv.id}
                  to={`/connections/${relId}/chat/${conv.id}`}
                  className="conversation-item"
                >
                  <div className="conversation-info">
                    <span className="conversation-title">
                      {conv.title || 'Chat'}
                    </span>
                    {conv.last_message && (
                      <span className="conversation-preview">
                        {conv.last_message.content.slice(0, 50)}
                        {conv.last_message.content.length > 50 ? '...' : ''}
                      </span>
                    )}
                  </div>
                  <span className="conversation-time">
                    {conv.last_message_at ? formatDate(conv.last_message_at) : formatDate(conv.created_at)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Shared Decks (Tutor -> Student) */}
        <div className="detail-section">
          <h2>{iAmTutor ? 'Decks You Shared' : 'Shared Decks'}</h2>
          {sharedDecksQuery.isLoading ? (
            <Loading message="Loading shared decks..." />
          ) : sharedDecks.length === 0 ? (
            <EmptyState
              icon="📚"
              title="No shared decks"
              description={iAmTutor ? 'Share a deck with your student' : 'Your tutor hasn\'t shared any decks yet'}
              action={iAmTutor && (
                <button className="btn btn-secondary" onClick={() => setShowShareModal(true)}>
                  Share Deck
                </button>
              )}
            />
          ) : (
            <div className="shared-decks-list">
              {sharedDecks.map((sd) => (
                iAmTutor ? (
                  <Link
                    key={sd.id}
                    to={`/connections/${relId}/shared-decks/${sd.id}/progress`}
                    className="shared-deck-item clickable"
                  >
                    <div className="shared-deck-info">
                      <span className="shared-deck-name">{sd.source_deck_name}</span>
                      <span className="shared-deck-date">
                        Shared {formatDate(sd.shared_at)}
                      </span>
                    </div>
                    <span className="shared-deck-arrow">→</span>
                  </Link>
                ) : (
                  <div key={sd.id} className="shared-deck-item">
                    <span className="shared-deck-name">{sd.source_deck_name}</span>
                    <span className="shared-deck-date">
                      Shared {formatDate(sd.shared_at)}
                    </span>
                  </div>
                )
              ))}
            </div>
          )}
        </div>

        {/* Student Shared Decks (Student -> Tutor) */}
        {(studentSharedDecks.length > 0 || iAmTutor) && (
          <div className="detail-section">
            <h2>{iAmTutor ? 'Student\'s Shared Decks' : 'Decks You Shared'}</h2>
            {studentSharedDecksQuery.isLoading ? (
              <Loading message="Loading student shared decks..." />
            ) : studentSharedDecks.length === 0 ? (
              <EmptyState
                icon="📖"
                title={iAmTutor ? 'No decks shared by student' : 'No decks shared'}
                description={iAmTutor
                  ? 'Your student hasn\'t shared any of their decks yet'
                  : 'Share your decks from the deck detail page'}
              />
            ) : (
              <div className="shared-decks-list">
                {studentSharedDecks.map((sd) => (
                  iAmTutor ? (
                    <Link
                      key={sd.id}
                      to={`/connections/${relId}/student-shared-decks/${sd.id}/progress`}
                      className="shared-deck-item clickable"
                    >
                      <div className="shared-deck-info">
                        <span className="shared-deck-name">{sd.deck_name}</span>
                        <span className="shared-deck-meta">
                          {sd.note_count} notes • Shared {formatDate(sd.shared_at)}
                        </span>
                      </div>
                      <span className="shared-deck-arrow">→</span>
                    </Link>
                  ) : (
                    <div key={sd.id} className="shared-deck-item">
                      <div className="shared-deck-info">
                        <span className="shared-deck-name">{sd.deck_name}</span>
                        <span className="shared-deck-meta">
                          {sd.note_count} notes • Shared {formatDate(sd.shared_at)}
                        </span>
                      </div>
                    </div>
                  )
                ))}
              </div>
            )}
          </div>
        )}

        {/* Remove Connection */}
        <div className="detail-section danger-zone">
          <h2>Danger Zone</h2>
          <button
            className="btn btn-danger"
            onClick={() => {
              if (confirm(`Remove ${otherUser.name || otherUser.email} as your ${iAmTutor ? 'student' : 'tutor'}?`)) {
                removeMutation.mutate();
              }
            }}
            disabled={removeMutation.isPending}
          >
            {removeMutation.isPending ? 'Removing...' : 'Remove Connection'}
          </button>
        </div>
      </div>

      {/* New Conversation Modal */}
      {showNewConvModal && (
        <div className="modal-overlay" onClick={() => setShowNewConvModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{isClaudeRelationship ? 'New Practice Conversation' : 'New Conversation'}</h3>
            <form onSubmit={handleCreateConversation}>
              <div className="form-group">
                <label htmlFor="conv-title">Title (optional)</label>
                <input
                  id="conv-title"
                  type="text"
                  value={newConvTitle}
                  onChange={(e) => setNewConvTitle(e.target.value)}
                  placeholder={isClaudeRelationship ? 'e.g., Restaurant Practice' : 'e.g., Homework Help'}
                />
              </div>
              {isClaudeRelationship && (
                <>
                  <div className="form-group">
                    <label htmlFor="conv-scenario">Scenario (optional)</label>
                    <textarea
                      id="conv-scenario"
                      value={newConvScenario}
                      onChange={(e) => setNewConvScenario(e.target.value)}
                      placeholder="Describe the situation, e.g., 'You are ordering food at a Chinese restaurant. The waiter only speaks Mandarin.'"
                      rows={3}
                    />
                    <small className="form-hint">This helps Claude understand the context for the conversation.</small>
                  </div>
                  <div className="form-group">
                    <label htmlFor="conv-user-role">Your role (optional)</label>
                    <input
                      id="conv-user-role"
                      type="text"
                      value={newConvUserRole}
                      onChange={(e) => setNewConvUserRole(e.target.value)}
                      placeholder="e.g., A tourist visiting Beijing"
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="conv-ai-role">Claude's role (optional)</label>
                    <input
                      id="conv-ai-role"
                      type="text"
                      value={newConvAIRole}
                      onChange={(e) => setNewConvAIRole(e.target.value)}
                      placeholder="e.g., A friendly restaurant waiter"
                    />
                  </div>
                </>
              )}
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowNewConvModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={createConvMutation.isPending}>
                  {createConvMutation.isPending ? 'Creating...' : 'Start Chat'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Share Deck Modal */}
      {showShareModal && (
        <div className="modal-overlay" onClick={() => setShowShareModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Share a Deck</h3>
            {decksQuery.isLoading ? (
              <Loading message="Loading your decks..." />
            ) : (decksQuery.data?.length || 0) === 0 ? (
              <EmptyState
                icon="📚"
                title="No decks to share"
                description="Create a deck first"
              />
            ) : (
              <div className="share-deck-list">
                {decksQuery.data?.map((deck: Deck) => (
                  <button
                    key={deck.id}
                    className="share-deck-option"
                    onClick={() => shareDeckMutation.mutate(deck.id)}
                    disabled={shareDeckMutation.isPending}
                  >
                    <span className="share-deck-name">{deck.name}</span>
                    {deck.description && (
                      <span className="share-deck-desc">{deck.description}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowShareModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
