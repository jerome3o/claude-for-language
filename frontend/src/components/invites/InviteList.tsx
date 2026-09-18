import { useState } from 'react';
import type { Invite } from '../../types/invites';
import { QRCode } from './QRCode';
import './invites.css';

interface InviteListProps {
  invites: Invite[];
  onRevoke: (id: string) => Promise<void> | void;
  /** Admin view: show who created each invite. */
  showCreator?: boolean;
  emptyText?: string;
}

function describeStatus(invite: Invite): { label: string; className: string } {
  switch (invite.status) {
    case 'revoked':
      return { label: 'Revoked', className: 'revoked' };
    case 'expired':
      return { label: 'Expired', className: 'expired' };
    case 'used': {
      const who = invite.redemptions.map(r => r.user_name || r.user_email || 'someone');
      return { label: who.length ? `Used by ${who.join(', ')}` : 'Used', className: 'used' };
    }
    default: {
      if (invite.use_count > 0) {
        const who = invite.redemptions.map(r => r.user_name || r.user_email || 'someone');
        return { label: `Used by ${who.join(', ')} · ${invite.max_uses - invite.use_count} left`, className: 'active' };
      }
      if (invite.opened_at) {
        return { label: 'Link opened · not signed in yet', className: 'opened' };
      }
      return { label: 'Unused', className: 'active' };
    }
  }
}

function describeTarget(invite: Invite): string {
  const parts: string[] = [];
  if (invite.inviter_role === 'tutor') parts.push('as my student');
  else if (invite.inviter_role === 'student') parts.push('as my tutor');
  else parts.push('access only');
  if (invite.share_deck_ids) {
    try {
      const n = JSON.parse(invite.share_deck_ids).length;
      if (n) parts.push(`${n} deck${n === 1 ? '' : 's'}`);
    } catch { /* ignore */ }
  }
  if (invite.email) parts.push(`only ${invite.email}`);
  if (invite.max_uses > 1) parts.push(`${invite.max_uses} uses`);
  if (invite.expires_at) parts.push(`expires ${new Date(invite.expires_at).toLocaleDateString()}`);
  return parts.join(' · ');
}

/** "Invites I've sent" (Connections) and "All invites" (Admin). */
export function InviteList({ invites, onRevoke, showCreator = false, emptyText = 'No invites yet.' }: InviteListProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (invites.length === 0) {
    return <p className="invite-muted">{emptyText}</p>;
  }

  const copy = async (invite: Invite) => {
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopiedId(invite.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch { /* ignore */ }
  };

  const revoke = async (invite: Invite) => {
    if (!confirm('Revoke this invite? The link will stop working.')) return;
    setBusyId(invite.id);
    try {
      await onRevoke(invite.id);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ul className="invite-list">
      {invites.map(invite => {
        const status = describeStatus(invite);
        const isOpen = openId === invite.id;
        return (
          <li key={invite.id} className={`invite-row ${status.className}`}>
            <button
              type="button"
              className="invite-row-main"
              onClick={() => setOpenId(isOpen ? null : invite.id)}
              aria-expanded={isOpen}
            >
              <span className={`invite-status-dot ${status.className}`} aria-hidden="true" />
              <span className="invite-row-text">
                <span className="invite-row-status">{status.label}</span>
                <span className="invite-row-meta">
                  {showCreator && <>{invite.creator_name || invite.creator_email || 'Unknown'} · </>}
                  {describeTarget(invite)}
                  {invite.note ? ` · “${invite.note}”` : ''}
                  {' · '}
                  {new Date(invite.created_at).toLocaleDateString()}
                </span>
              </span>
              <span className="invite-row-chevron" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen && (
              <div className="invite-row-details">
                {invite.status === 'active' && (
                  <div className="invite-qr-wrap invite-qr-small">
                    <QRCode value={invite.url} size={160} className="invite-qr" />
                  </div>
                )}
                <div className="invite-link-box">
                  <span className="invite-link-text">{invite.url}</span>
                  {invite.status === 'active' && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(invite)}>
                      {copiedId === invite.id ? 'Copied ✓' : 'Copy'}
                    </button>
                  )}
                </div>
                {invite.opened_at && invite.use_count === 0 && (
                  <p className="invite-muted">
                    Opened {new Date(`${invite.opened_at.replace(' ', 'T')}${/Z$|[+-]\d\d:\d\d$/.test(invite.opened_at) ? '' : 'Z'}`).toLocaleString()} but nobody has signed in.
                    If they saw a blank page or a blocked sign-in, ask them to open the link in Chrome or Safari.
                  </p>
                )}
                {invite.redemptions.length > 0 && (
                  <p className="invite-muted">
                    Joined: {invite.redemptions.map(r => `${r.user_name || r.user_email || 'someone'} (${new Date(r.redeemed_at).toLocaleDateString()})`).join(', ')}
                  </p>
                )}
                {invite.status === 'active' && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm invite-revoke-btn"
                    onClick={() => revoke(invite)}
                    disabled={busyId === invite.id}
                  >
                    {busyId === invite.id ? 'Revoking…' : 'Revoke'}
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
