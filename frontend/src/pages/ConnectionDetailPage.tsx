import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getRelationship,
  getConversations,
  createConversation,
  getSharedDecks,
  getStudentSharedDecks,
  removeRelationship,
} from '../api/client';
import { getLessonLog } from '../api/insights';
import { getStudentOverview, updateSharedDeckCopy, openConversation } from '../api/tutorDashboard';
import type { StudentOverview } from '../types/tutorDashboard';
import {
  getOtherUserInRelationship,
  getMyRoleInRelationship,
  isClaudeUser,
  ConversationWithLastMessage,
} from '../types';
import { Loading, ErrorMessage, EmptyState } from '../components/Loading';
import { useAuth } from '../contexts/AuthContext';
import { StudentLessonsSection } from '../components/editor/StudentLessonsSection';
import { OverflowMenu } from '../components/tutor/OverflowMenu';
import { NeedsAttention } from '../components/tutor/NeedsAttention';
import { SetupChecklist } from '../components/tutor/SetupChecklist';
import { SendHomeworkSheet } from '../components/tutor/SendHomeworkSheet';
import { Avatar } from '../components/tutor/StudentCard';
import { dayLabel, minutes, percent, plural, relativeDay, shortDate, shortDateTime } from '../components/tutor/format';
import '../components/tutor/tutor-dashboard.css';
import './ConnectionDetailPage.css';

function formatConversationDate(dateStr: string) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'short' });
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ConversationsList({ relId, conversations, isLoading, onStart }: { relId: string; conversations: ConversationWithLastMessage[]; isLoading: boolean; onStart: () => void }) {
  if (isLoading) return <Loading message="Loading conversations..." />;
  if (conversations.length === 0) {
    return (
      <EmptyState
        icon="💬"
        title="No conversations yet"
        description="Send a message to get started"
        action={<button className="btn btn-primary" onClick={onStart}>Message</button>}
      />
    );
  }
  return (
    <div className="conversations-list">
      {conversations.map((conv) => (
        <Link key={conv.id} to={`/connections/${relId}/chat/${conv.id}`} className="conversation-item">
          <div className="conversation-info">
            <span className="conversation-title">{conv.title || 'Chat'}</span>
            {conv.last_message && (
              <span className="conversation-preview">
                {conv.last_message.content.slice(0, 50)}
                {conv.last_message.content.length > 50 ? '...' : ''}
              </span>
            )}
          </div>
          <span className="conversation-time">
            {conv.last_message_at ? formatConversationDate(conv.last_message_at) : formatConversationDate(conv.created_at)}
          </span>
        </Link>
      ))}
    </div>
  );
}

/** "Last studied today, 12:32 AM · 🔥 1 day · 7 active days / 30" */
function studentStatusLine(o: StudentOverview): string {
  if (o.is_new) {
    return `${o.joined_via_invite ? 'Joined via your link' : 'Connected'} · ${shortDateTime(o.joined_at)}`;
  }
  const s = o.status;
  const parts = [
    s.last_studied_at ? `Last studied ${relativeDay(s.last_studied_at)}, ${new Date(s.last_studied_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : 'Not studied yet',
    `🔥 ${s.streak_days} day${s.streak_days === 1 ? '' : 's'}`,
    `${s.active_days_30} active day${s.active_days_30 === 1 ? '' : 's'} / 30`,
  ];
  return parts.join(' · ');
}

export function ConnectionDetailPage() {
  const { relId } = useParams<{ relId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [showHomeworkSheet, setShowHomeworkSheet] = useState(false);
  const [showNewConvModal, setShowNewConvModal] = useState(false);
  const [showStudentDecks, setShowStudentDecks] = useState(false);
  const [newConvTitle, setNewConvTitle] = useState('');
  const [newConvScenario, setNewConvScenario] = useState('');
  const [newConvUserRole, setNewConvUserRole] = useState('');
  const [newConvAIRole, setNewConvAIRole] = useState('');
  const [messageBusy, setMessageBusy] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [updatingShare, setUpdatingShare] = useState<string | null>(null);
  const [updateNote, setUpdateNote] = useState<string | null>(null);

  const relationshipQuery = useQuery({
    queryKey: ['relationship', relId],
    queryFn: () => getRelationship(relId!),
    enabled: !!relId,
  });

  const relationship = relationshipQuery.data;
  const iAmTutor = !!relationship && !!user && getMyRoleInRelationship(relationship, user.id) === 'tutor';
  const otherUserId = relationship && user ? getOtherUserInRelationship(relationship, user.id).id : null;
  const isClaudeRelationship = !!otherUserId && isClaudeUser(otherUserId);
  const tutorView = iAmTutor && !isClaudeRelationship;

  const overviewQuery = useQuery({
    queryKey: ['student-overview', relId],
    queryFn: () => getStudentOverview(relId!),
    enabled: !!relId && tutorView,
    staleTime: 60_000,
  });

  const conversationsQuery = useQuery({
    queryKey: ['conversations', relId],
    queryFn: () => getConversations(relId!),
    enabled: !!relId,
  });

  const sharedDecksQuery = useQuery({
    queryKey: ['sharedDecks', relId],
    queryFn: () => getSharedDecks(relId!),
    enabled: !!relId && !tutorView,
  });

  const studentSharedDecksQuery = useQuery({
    queryKey: ['studentSharedDecks', relId],
    queryFn: () => getStudentSharedDecks(relId!),
    enabled: !!relId,
  });

  const lessonLogQuery = useQuery({
    queryKey: ['lessonLog', relId],
    queryFn: () => getLessonLog(relId!),
    enabled: !!relId && tutorView,
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

  const removeMutation = useMutation({
    mutationFn: () => removeRelationship(relId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relationships'] });
      queryClient.invalidateQueries({ queryKey: ['tutor-dashboard'] });
      navigate('/connections');
    },
  });

  // ?new=1 (from the "+ New" link inside a chat): start a fresh conversation
  // straight away. The Claude relationship keeps its scenario form.
  const handledNew = useRef(false);
  useEffect(() => {
    if (!relationship || handledNew.current || searchParams.get('new') !== '1') return;
    handledNew.current = true;
    setSearchParams({}, { replace: true });
    if (isClaudeRelationship) {
      setShowNewConvModal(true);
    } else {
      createConvMutation.mutate({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relationship, searchParams]);

  /** Message: most recent conversation, created when there is none (H3). */
  const handleMessage = async () => {
    if (isClaudeRelationship) {
      setShowNewConvModal(true);
      return;
    }
    const known = overviewQuery.data?.last_conversation_id ?? conversationsQuery.data?.[0]?.id ?? null;
    if (known) {
      navigate(`/connections/${relId}/chat/${known}`);
      return;
    }
    setMessageBusy(true);
    setPageError(null);
    try {
      const { conversation_id } = await openConversation(relId!);
      queryClient.invalidateQueries({ queryKey: ['conversations', relId] });
      navigate(`/connections/${relId}/chat/${conversation_id}`);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Could not open the conversation');
    } finally {
      setMessageBusy(false);
    }
  };

  const handleUpdateShare = async (sharedDeckId: string, name: string) => {
    setUpdatingShare(sharedDeckId);
    setUpdateNote(null);
    try {
      const res = await updateSharedDeckCopy(relId!, sharedDeckId);
      setUpdateNote(
        res.added === 0 && res.audio_filled === 0
          ? `${name} is already up to date.`
          : `Added ${plural(res.added, 'new word')} to their copy of ${name}. Their progress is kept.`
      );
      queryClient.invalidateQueries({ queryKey: ['student-overview', relId] });
      queryClient.invalidateQueries({ queryKey: ['tutor-dashboard'] });
    } catch (err) {
      setUpdateNote(err instanceof Error ? err.message : 'Could not update the deck');
    } finally {
      setUpdatingShare(null);
    }
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

  if (relationshipQuery.error || !relationship) {
    return <ErrorMessage message="Connection not found" />;
  }

  const otherUser = getOtherUserInRelationship(relationship, user!.id);
  const otherName = otherUser.name || otherUser.email || 'Unknown';
  const conversations = conversationsQuery.data || [];
  const sharedDecks = sharedDecksQuery.data || [];
  const studentSharedDecks = studentSharedDecksQuery.data || [];
  const overview = overviewQuery.data ?? null;

  const removeConnection = () => {
    if (confirm(`Remove ${otherName} as your ${iAmTutor ? 'student' : 'tutor'}?`)) {
      removeMutation.mutate();
    }
  };

  const menuItems = tutorView
    ? [
        {
          label: showStudentDecks
            ? 'Hide decks the student shared with you'
            : `Decks the student shared with you${studentSharedDecks.length ? ` (${studentSharedDecks.length})` : ''}`,
          onClick: () => setShowStudentDecks((v) => !v),
        },
        { label: 'Progress (30-day summary)', to: `/connections/${relId}/progress` },
        { label: 'Assign from lesson library', to: '/library' },
        { label: removeMutation.isPending ? 'Removing…' : 'Remove connection', onClick: removeConnection, danger: true, disabled: removeMutation.isPending },
      ]
    : [{ label: removeMutation.isPending ? 'Removing…' : 'Remove connection', onClick: removeConnection, danger: true, disabled: removeMutation.isPending }];

  // ===================== Tutor's student page =====================
  if (tutorView) {
    const lastLesson = lessonLogQuery.data?.[0] ?? null;
    return (
      <div className="page">
        <div className="container">
          <div className="td-topbar">
            <Link to="/connections" className="back-link">‹ Students</Link>
            <OverflowMenu items={menuItems} />
          </div>

          <div className="td-student-head">
            <Avatar name={otherUser.name} email={otherUser.email} picture_url={otherUser.picture_url} size="lg" />
            <div>
              <h1>{otherName}</h1>
              <div className="td-student-status">
                {overview ? studentStatusLine(overview) : overviewQuery.isError ? 'Could not load activity' : 'Loading…'}
                {lastLesson && ` · last lesson ${shortDate(lastLesson.lesson_at)}`}
              </div>
            </div>
          </div>

          <div className="td-actions">
            <button type="button" className="btn btn-primary" onClick={handleMessage} disabled={messageBusy}>💬 Message</button>
            <button type="button" className="btn btn-secondary" onClick={() => setShowHomeworkSheet(true)}>📤 Send homework</button>
          </div>
          {pageError && <div className="td-error">{pageError}</div>}

          {overviewQuery.isLoading && <Loading message="Loading activity…" />}
          {overviewQuery.isError && (
            <div className="td-error">{overviewQuery.error instanceof Error ? overviewQuery.error.message : 'Could not load the student overview'}</div>
          )}

          {/* New student: the onboarding checklist instead of empty stats */}
          {overview?.is_new && (
            <section className="detail-section">
              <SetupChecklist overview={overview} onMessage={handleMessage} onSendHomework={() => setShowHomeworkSheet(true)} />
            </section>
          )}

          {/* Needs attention */}
          {overview && !overview.is_new && (
            <section className="detail-section">
              <h2>Needs attention</h2>
              <NeedsAttention relId={relId!} items={overview.needs_attention} unheardTotal={overview.pills.recordings_to_hear} />
            </section>
          )}

          {/* Deeper pages, one tap away */}
          <nav className="td-nav" aria-label="Student pages">
            <Link to={`/connections/${relId}/insights`}>Insights</Link>
            <Link to={`/connections/${relId}/history`}>History</Link>
            <Link to={`/connections/${relId}/recordings`}>
              Recordings{overview && overview.pills.recordings_to_hear > 0 ? ` (${overview.pills.recordings_to_hear})` : ''}
            </Link>
            <Link to={`/connections/${relId}/progress`}>Progress</Link>
          </nav>

          {/* Homework: decks I shared + lessons I assigned */}
          <section className="detail-section">
            <h2>Homework</h2>
            {updateNote && <div className="td-result" role="status">{updateNote}</div>}
            {overview && overview.homework.decks.length === 0 && overview.homework.lessons.length === 0 && (
              <EmptyState
                icon="📚"
                title="No homework yet"
                description="Send a deck or a lesson — it lands on their home screen after their next sync."
                action={<button className="btn btn-secondary" onClick={() => setShowHomeworkSheet(true)}>Send homework</button>}
              />
            )}
            {overview && overview.homework.decks.length > 0 && (
              <div className="td-list" style={{ gap: '0.5rem' }}>
                {overview.homework.decks.map((d) => (
                  <div key={d.shared_deck_id} className="td-hw-row">
                    <Link to={`/connections/${relId}/shared-decks/${d.shared_deck_id}/progress`} className="td-hw-main" style={{ textDecoration: 'none', color: 'inherit' }}>
                      <div className="td-hw-title">
                        <span lang="zh">{d.source_deck_name}</span> <span className="td-hw-when">· sent {shortDate(d.shared_at)}</span>
                      </div>
                      <div className="td-bar" aria-hidden="true">
                        <div className="td-bar-started" style={{ width: `${d.percent_started}%` }} />
                        <div className="td-bar-mastered" style={{ width: `${d.percent_mastered}%` }} />
                      </div>
                      <div className="td-hw-meta">
                        {d.target_deck_name == null
                          ? 'The student deleted their copy'
                          : `${d.cards_started}/${d.cards_total} cards started · ${d.cards_mastered} mastered`}
                        {d.notes_missing > 0 && <span className="td-pill td-pill-muted">{plural(d.notes_missing, 'new word')} not sent</span>}
                      </div>
                    </Link>
                    <div className="td-hw-actions">
                      {d.notes_missing > 0 && d.target_deck_name != null ? (
                        <button type="button" className="td-inline-btn" disabled={updatingShare === d.shared_deck_id} onClick={() => handleUpdateShare(d.shared_deck_id, d.source_deck_name)}>
                          {updatingShare === d.shared_deck_id ? 'Updating…' : 'Update'}
                        </button>
                      ) : (
                        <span className="td-chevron">›</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* The student's mini lessons (assigned by me, by others, their own) */}
            <div className="td-nested-section">
              <StudentLessonsSection relId={relId!} isTutor={true} />
            </div>
          </section>

          {/* Decks the student shared with me — behind ⋯ */}
          {showStudentDecks && (
            <section className="detail-section">
              <h2>Decks the student shared with you</h2>
              {studentSharedDecksQuery.isLoading ? (
                <Loading message="Loading…" />
              ) : studentSharedDecks.length === 0 ? (
                <p className="td-muted">Nothing yet — the student can share a deck from its deck page.</p>
              ) : (
                <div className="shared-decks-list">
                  {studentSharedDecks.map((sd) => (
                    <Link key={sd.id} to={`/connections/${relId}/student-shared-decks/${sd.id}/progress`} className="shared-deck-item clickable">
                      <div className="shared-deck-info">
                        <span className="shared-deck-name">{sd.deck_name}</span>
                        <span className="shared-deck-meta">{sd.note_count} notes • Shared {formatConversationDate(sd.shared_at)}</span>
                      </div>
                      <span className="shared-deck-arrow">→</span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Conversations */}
          <section className="detail-section">
            <h2>Conversations</h2>
            <ConversationsList relId={relId!} conversations={conversations} isLoading={conversationsQuery.isLoading} onStart={handleMessage} />
          </section>

          {/* Activity: last two days, more in Progress */}
          {overview && !overview.is_new && (
            <section className="detail-section">
              <h2>Activity</h2>
              <div className="td-list" style={{ gap: '0.5rem' }}>
                {overview.activity.length === 0 && <p className="td-muted">No reviews in the last 30 days.</p>}
                {overview.activity.map((day) => (
                  <Link key={day.day} to={`/connections/${relId}/progress/day/${day.day}`} className="td-activity-row">
                    <span>
                      <span className="td-activity-day">{dayLabel(day.day)}</span>
                      <span className="td-activity-stats">
                        · {plural(day.reviews, 'review')} · {percent(day.accuracy)}{day.time_ms > 0 ? ` · ${minutes(day.time_ms)}` : ''}
                      </span>
                    </span>
                    <span className="td-chevron">›</span>
                  </Link>
                ))}
                <Link to={`/connections/${relId}/progress`} className="btn btn-secondary" style={{ minHeight: 44 }}>
                  Show 30 days
                </Link>
              </div>
            </section>
          )}
        </div>

        {showHomeworkSheet && (
          <SendHomeworkSheet
            relId={relId!}
            studentName={otherUser.name || otherUser.email || 'your student'}
            sharedDecks={overview?.homework.decks ?? []}
            assignedLessons={overview?.homework.lessons ?? []}
            onClose={() => setShowHomeworkSheet(false)}
          />
        )}
      </div>
    );
  }

  // ===================== Student's tutor page / Claude =====================
  return (
    <div className="page">
      <div className="container">
        <div className="td-topbar">
          <Link to="/connections" className="back-link">‹ Connections</Link>
          <OverflowMenu items={menuItems} />
        </div>

        <div className="td-student-head">
          {isClaudeRelationship ? (
            <div className="td-avatar td-avatar-lg" aria-hidden="true">🤖</div>
          ) : (
            <Avatar name={otherUser.name} email={otherUser.email} picture_url={otherUser.picture_url} size="lg" />
          )}
          <div>
            <h1>{otherName}</h1>
            <div className="td-student-status">
              {isClaudeRelationship ? 'Practice Chinese conversations' : iAmTutor ? 'Your student' : 'Your tutor'}
            </div>
          </div>
        </div>

        <div className="td-actions">
          <button type="button" className="btn btn-primary" onClick={handleMessage} disabled={messageBusy}>
            {isClaudeRelationship ? '💬 New practice conversation' : '💬 Message'}
          </button>
        </div>
        {pageError && <div className="td-error">{pageError}</div>}

        <section className="detail-section">
          <h2>Conversations</h2>
          <ConversationsList relId={relId!} conversations={conversations} isLoading={conversationsQuery.isLoading} onStart={handleMessage} />
        </section>

        {!isClaudeRelationship && (
          <section className="detail-section">
            <h2>Homework from your tutor</h2>
            {sharedDecksQuery.isLoading ? (
              <Loading message="Loading shared decks..." />
            ) : sharedDecks.length === 0 ? (
              <EmptyState icon="📚" title="No shared decks" description="Your tutor hasn't shared any decks yet" />
            ) : (
              <div className="shared-decks-list">
                {sharedDecks.map((sd) => (
                  <div key={sd.id} className="shared-deck-item">
                    <span className="shared-deck-name">{sd.source_deck_name}</span>
                    <span className="shared-deck-date">Shared {formatConversationDate(sd.shared_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {!isClaudeRelationship && studentSharedDecks.length > 0 && (
          <section className="detail-section">
            <h2>Decks you shared</h2>
            <div className="shared-decks-list">
              {studentSharedDecks.map((sd) => (
                <div key={sd.id} className="shared-deck-item">
                  <div className="shared-deck-info">
                    <span className="shared-deck-name">{sd.deck_name}</span>
                    <span className="shared-deck-meta">{sd.note_count} notes • Shared {formatConversationDate(sd.shared_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* New Conversation Modal — kept for Claude practice conversations (scenario + roles) */}
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
                  placeholder={isClaudeRelationship ? 'e.g., Restaurant Practice' : 'e.g., Lesson Questions'}
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
                <button type="submit" className="btn btn-primary" disabled={createConvMutation.isPending}>
                  {createConvMutation.isPending ? 'Creating...' : 'Start Chat'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowNewConvModal(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
