import { useState } from 'react';
import type { PendingInvite } from '../../types/tutorDashboard';
import { InviteQRSheet } from './InviteQRSheet';
import { OverflowMenu } from './OverflowMenu';
import { copyTextToClipboard } from '../../utils/clipboard';
import { relativeDay } from './format';
import './tutor-dashboard.css';

/**
 * A muted row for an invite link that nobody has used yet: "invited 3 days
 * ago · link not opened" with Resend (QR / copy) and Revoke under ⋯.
 */
export function PendingInviteRow({ invite, onRevoke }: { invite: PendingInvite; onRevoke: (id: string) => Promise<void> | void }) {
  const [showQR, setShowQR] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const title = invite.email || invite.note || 'Invite link';
  const opened = invite.opened_at ? 'opened, not signed in' : 'link not opened yet';

  const copy = async () => {
    const ok = await copyTextToClipboard(invite.url);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
  };

  const revoke = async () => {
    if (!confirm('Revoke this invite link? Anyone who still has it will not be able to join.')) return;
    setBusy(true);
    try {
      await onRevoke(invite.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="td-invite">
      <div className="td-avatar td-avatar-muted" aria-hidden="true">?</div>
      <div className="td-invite-text">
        <div className="td-invite-title">{title}</div>
        <div className="td-invite-meta">
          Invited {relativeDay(invite.created_at)} · {opened}
          {invite.share_deck_count > 0 ? ` · ${invite.share_deck_count} deck${invite.share_deck_count === 1 ? '' : 's'} attached` : ''}
        </div>
      </div>
      <div className="td-invite-actions">
        <button type="button" className="td-inline-btn" onClick={() => setShowQR(true)} disabled={busy}>
          Resend
        </button>
        <OverflowMenu
          label="Invite actions"
          items={[
            { label: copied ? 'Copied ✓' : 'Copy link', onClick: copy },
            { label: 'Show QR', onClick: () => setShowQR(true) },
            { label: 'Revoke invite', onClick: revoke, danger: true, disabled: busy },
          ]}
        />
      </div>
      {showQR && <InviteQRSheet url={invite.url} title="Resend invite" hint="Show the QR or send the link again — it is the same link." onClose={() => setShowQR(false)} />}
    </div>
  );
}
