import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  getMyRelationships,
  createRelationship,
  acceptRelationship,
  removeRelationship,
  cancelInvitation,
} from '../api/client';
import {
  TutorRelationshipWithUsers,
  RelationshipRole,
  PendingInvitationWithInviter,
  getOtherUserInRelationship,
  isClaudeUser,
} from '../types';
import { Loading, ErrorMessage, EmptyState } from '../components/Loading';
import { useAuth } from '../contexts/AuthContext';
import './ConnectionsPage.css';

export function ConnectionsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<RelationshipRole>('tutor');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null);

  const relationshipsQuery = useQuery({
    queryKey: ['relationships'],
    queryFn: getMyRelationships,
  });

  const createMutation = useMutation({
    mutationFn: ({ email, role }: { email: string; role: RelationshipRole }) =>
      createRelationship(email, role),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['relationships'] });
      setShowInviteForm(false);
      setInviteEmail('');
      setInviteError(null);
      // Show success message for invitations to non-users
      if (result.type === 'invitation') {
        setInviteSuccess(`Invitation sent to ${result.data.recipient_email}`);
        setTimeout(() => setInviteSuccess(null), 5000);
      }
    },
    onError: (error: Error) => {
      setInviteError(error.message);
    },
  });

  const acceptMutation = useMutation({
    mutationFn: acceptRelationship,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relationships'] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: removeRelationship,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relationships'] });
    },
  });

  const cancelInvitationMutation = useMutation({
    mutationFn: cancelInvitation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['relationships'] });
    },
  });

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviteError(null);
    createMutation.mutate({ email: inviteEmail.trim(), role: inviteRole });
  };

  if (relationshipsQuery.isLoading) {
    return <Loading />;
  }

  if (relationshipsQuery.error) {
    return <ErrorMessage message="Failed to load connections" />;
  }

  const relationships = relationshipsQuery.data!;
  const { tutors, students, pending_incoming, pending_outgoing, pending_invitations } = relationships;

  // Helper to render a pending invitation (for non-users)
  const renderInvitationInfo = (inv: PendingInvitationWithInviter) => {
    return (
      <div className="connection-user">
        <div className="connection-avatar connection-avatar-placeholder">
          {inv.recipient_email[0].toUpperCase()}
        </div>
        <div className="connection-user-info">
          <span className="connection-name">{inv.recipient_email}</span>
          <span className="connection-email">
            Not signed up yet
          </span>
        </div>
      </div>
    );
  };

  const renderUserInfo = (rel: TutorRelationshipWithUsers) => {
    const otherUser = getOtherUserInRelationship(rel, user!.id);
    const isClaude = isClaudeUser(otherUser.id);
    return (
      <div className="connection-user">
        {isClaude ? (
          <div className="connection-avatar connection-avatar-ai">
            🤖
          </div>
        ) : otherUser.picture_url ? (
          <img src={otherUser.picture_url} alt="" className="connection-avatar" />
        ) : (
          <div className="connection-avatar connection-avatar-placeholder">
            {(otherUser.name || otherUser.email || '?')[0].toUpperCase()}
          </div>
        )}
        <div className="connection-user-info">
          <span className="connection-name">
            {otherUser.name || 'Unknown'}
            {isClaude && <span className="connection-ai-badge">AI</span>}
          </span>
          <span className="connection-email">
            {isClaude ? 'Practice Chinese conversations' : otherUser.email}
          </span>
        </div>
      </div>
    );
  };

  const getPendingDescription = (rel: TutorRelationshipWithUsers) => {
    const otherUser = getOtherUserInRelationship(rel, user!.id);
    const otherName = otherUser.name || otherUser.email || 'Someone';

    // If they are the requester, their role tells us what they want to be
    if (rel.requester_id !== user!.id) {
      // I'm the recipient - they initiated
      if (rel.requester_role === 'tutor') {
        return `${otherName} wants to be your tutor`;
      } else {
        return `${otherName} wants you to be their tutor`;
      }
    }
    return '';
  };

  return (
    <div className="page">
      <div className="container">
        <div className="connections-header">
          <h1>Connections</h1>
          <button
            className="btn btn-primary"
            onClick={() => setShowInviteForm(!showInviteForm)}
          >
            {showInviteForm ? 'Cancel' : '+ Invite'}
          </button>
        </div>

        {/* Success message for sent invitations */}
        {inviteSuccess && (
          <div className="card mb-4 invite-success">
            <p className="text-success">{inviteSuccess}</p>
          </div>
        )}

        {/* Invite Form */}
        {showInviteForm && (
          <div className="card mb-4 invite-form">
            <h3>Invite Someone</h3>
            <form onSubmit={handleInvite}>
              <div className="form-group">
                <label htmlFor="invite-email">Their Email</label>
                <input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="email@example.com"
                  required
                />
              </div>
              <div className="form-group">
                <label>I want to be their...</label>
                <div className="role-options">
                  <label className={`role-option ${inviteRole === 'tutor' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="role"
                      value="tutor"
                      checked={inviteRole === 'tutor'}
                      onChange={() => setInviteRole('tutor')}
                    />
                    <span className="role-icon">Tutor</span>
                    <span className="role-desc">I'll teach them</span>
                  </label>
                  <label className={`role-option ${inviteRole === 'student' ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="role"
                      value="student"
                      checked={inviteRole === 'student'}
                      onChange={() => setInviteRole('student')}
                    />
                    <span className="role-icon">Student</span>
                    <span className="role-desc">They'll teach me</span>
                  </label>
                </div>
              </div>
              {inviteError && <p className="text-error mb-2">{inviteError}</p>}
              <button
                type="submit"
                className="btn btn-primary btn-block"
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? 'Sending...' : 'Send Invite'}
              </button>
            </form>
          </div>
        )}

        {/* Pending Incoming */}
        {pending_incoming.length > 0 && (
          <div className="connections-section">
            <h2>Pending Requests</h2>
            <div className="connections-list">
              {pending_incoming.map((rel) => (
                <div key={rel.id} className="connection-card pending">
                  {renderUserInfo(rel)}
                  <p className="connection-description">{getPendingDescription(rel)}</p>
                  <div className="connection-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => acceptMutation.mutate(rel.id)}
                      disabled={acceptMutation.isPending}
                    >
                      Accept
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        if (confirm('Decline this request?')) {
                          removeMutation.mutate(rel.id);
                        }
                      }}
                      disabled={removeMutation.isPending}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pending Outgoing */}
        {pending_outgoing.length > 0 && (
          <div className="connections-section">
            <h2>Sent Requests</h2>
            <div className="connections-list">
              {pending_outgoing.map((rel) => {
                const otherUser = getOtherUserInRelationship(rel, user!.id);
                return (
                  <div key={rel.id} className="connection-card pending outgoing">
                    {renderUserInfo(rel)}
                    <p className="connection-description">
                      Waiting for {otherUser.name || otherUser.email} to accept
                    </p>
                    <div className="connection-actions">
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          if (confirm('Cancel this request?')) {
                            removeMutation.mutate(rel.id);
                          }
                        }}
                        disabled={removeMutation.isPending}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Pending Invitations (to non-users) */}
        {pending_invitations && pending_invitations.length > 0 && (
          <div className="connections-section">
            <h2>Pending Invitations</h2>
            <p className="section-subtitle">Waiting for these people to sign up</p>
            <div className="connections-list">
              {pending_invitations.map((inv) => (
                <div key={inv.id} className="connection-card pending invitation">
                  {renderInvitationInfo(inv)}
                  <p className="connection-description">
                    Invited as your {inv.inviter_role === 'tutor' ? 'student' : 'tutor'}
                  </p>
                  <div className="connection-actions">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        if (confirm('Cancel this invitation?')) {
                          cancelInvitationMutation.mutate(inv.id);
                        }
                      }}
                      disabled={cancelInvitationMutation.isPending}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* My Tutors */}
        <div className="connections-section">
          <h2>My Tutors</h2>
          {tutors.length === 0 ? (
            <EmptyState
              icon="👨‍🏫"
              title="No tutors yet"
              description="Invite someone to be your tutor"
            />
          ) : (
            <div className="connections-list">
              {tutors.map((rel) => (
                <Link
                  key={rel.id}
                  to={`/connections/${rel.id}`}
                  className="connection-card active"
                >
                  {renderUserInfo(rel)}
                  <span className="connection-role-badge tutor">Tutor</span>
                  <span className="connection-arrow">→</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* My Students */}
        <div className="connections-section">
          <h2>My Students</h2>
          {students.length === 0 ? (
            <EmptyState
              icon="👨‍🎓"
              title="No students yet"
              description="Invite someone to be your student"
            />
          ) : (
            <div className="connections-list">
              {students.map((rel) => (
                <Link
                  key={rel.id}
                  to={`/connections/${rel.id}`}
                  className="connection-card active"
                >
                  {renderUserInfo(rel)}
                  <span className="connection-role-badge student">Student</span>
                  <span className="connection-arrow">→</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
