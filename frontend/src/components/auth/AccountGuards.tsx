/**
 * The two questions that keep local data safe (CLAUDE.md "Sign-in & sessions", shared/auth/session.ts):
 *  - Sign out with something not uploaded: "Sync first" / "Sign out anyway" (anyway deletes
 *    nothing — the data stays and uploads when the same account signs in again);
 *  - a DIFFERENT account signing in while the previous one's data hasn't uploaded: "Sign back in
 *    as <previous>" (upload it first) / "Discard and continue". Without this, signing in as
 *    someone else would mix two accounts' data on one device.
 * Rendered once in App.tsx. Lab twin: ui/kit/AccountDialogs.kt.
 */
import { useState } from 'react';
import { signOutWarning, switchAccountWarning, unsyncedTotal, type UnsyncedCounts } from '@shared/auth/session';
import { useAuth } from '../../contexts/AuthContext';
import { useNetwork } from '../../contexts/NetworkContext';
import { track } from '../../services/analytics';
import { countUnsynced } from '../../services/unsyncedData';
import './SignedOutBanner.css';

const countProps = (c: UnsyncedCounts) => ({ reviews: c.reviews, recordings: c.recordings, other: c.other });

export function SignOutPromptView({ counts, busy, note, onSyncFirst, onSignOutAnyway, onCancel }: {
  counts: UnsyncedCounts; busy: boolean; note?: string | null;
  onSyncFirst: () => void; onSignOutAnyway: () => void; onCancel: () => void;
}) {
  return (
    <div className="modal-overlay account-guard-overlay" onClick={onCancel}>
      <div className="modal account-guard" role="dialog" aria-modal="true" aria-labelledby="account-guard-title" onClick={(e) => e.stopPropagation()} data-testid="signout-unsynced">
        <h3 id="account-guard-title">Sign out?</h3>
        <p>{signOutWarning(counts)}</p>
        {note && <p className="account-guard-note" role="status">{note}</p>}
        <div className="account-guard-actions">
          <button type="button" className="btn btn-primary" onClick={onSyncFirst} disabled={busy} data-testid="signout-sync-first">
            {busy ? 'Syncing…' : 'Sync first'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onSignOutAnyway} disabled={busy} data-testid="signout-anyway">
            Sign out anyway
          </button>
          <button type="button" className="btn btn-link" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function AccountSwitchView({ counts, previousEmail, nextEmail, busy, onSignBackIn, onDiscard }: {
  counts: UnsyncedCounts; previousEmail: string | null; nextEmail: string | null; busy: boolean;
  onSignBackIn: () => void; onDiscard: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="modal-overlay account-guard-overlay">
      <div className="modal account-guard" role="alertdialog" aria-modal="true" aria-labelledby="account-switch-title" data-testid="account-switch">
        <h3 id="account-switch-title">This device has another account’s work</h3>
        <p>{switchAccountWarning(counts, previousEmail)}</p>
        {nextEmail && <p className="account-guard-note">You signed in as {nextEmail}.</p>}
        <div className="account-guard-actions">
          <button type="button" className="btn btn-primary" onClick={onSignBackIn} disabled={busy} data-testid="account-switch-back">
            Sign back in{previousEmail ? ` as ${previousEmail}` : ''}
          </button>
          {!confirming ? (
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)} disabled={busy} data-testid="account-switch-discard">
              Discard and continue
            </button>
          ) : (
            <button type="button" className="btn account-guard-danger" onClick={onDiscard} disabled={busy} data-testid="account-switch-discard-confirm">
              {busy ? 'Discarding…' : `Discard ${unsyncedTotal(counts).toLocaleString('en-US')} unsent item${unsyncedTotal(counts) === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function AccountGuards() {
  const { signOutPrompt, confirmSignOut, cancelSignOut, accountSwitch, resolveAccountSwitch } = useAuth();
  const { triggerSync, isOnline } = useNetwork();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (accountSwitch) {
    const choose = async (choice: 'sign_back_in' | 'discard') => {
      setBusy(true);
      track('auth.unsynced_warning', { reason: 'switch_account', choice, ...countProps(accountSwitch.counts) });
      try { await resolveAccountSwitch(choice); } finally { setBusy(false); }
    };
    return <AccountSwitchView {...accountSwitch} busy={busy} onSignBackIn={() => void choose('sign_back_in')} onDiscard={() => void choose('discard')} />;
  }
  if (!signOutPrompt) return null;
  const counts = signOutPrompt;
  const syncFirst = async () => {
    track('auth.unsynced_warning', { reason: 'sign_out', choice: 'sync_first', ...countProps(counts) });
    if (!isOnline) { setNote('You’re offline — connect, then Sync first.'); return; }
    setBusy(true);
    setNote(null);
    try {
      await triggerSync();
      const left = await countUnsynced();
      if (unsyncedTotal(left) === 0) {
        setBusy(false);
        await confirmSignOut();
        return;
      }
      setNote(`Still waiting: ${signOutWarning(left).split('.')[0]}.`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <SignOutPromptView
      counts={counts}
      busy={busy}
      note={note}
      onSyncFirst={() => void syncFirst()}
      onSignOutAnyway={() => { track('auth.unsynced_warning', { reason: 'sign_out', choice: 'sign_out_anyway', ...countProps(counts) }); void confirmSignOut(); }}
      onCancel={() => { if (busy) return; track('auth.unsynced_warning', { reason: 'sign_out', choice: 'cancel', ...countProps(counts) }); setNote(null); cancelSignOut(); }}
    />
  );
}
