import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDecks } from '../../api/client';
import { createInvite } from '../../api/invites';
import type { Invite } from '../../types/invites';
import { QRCode } from './QRCode';
import { useNetwork } from '../../contexts/NetworkContext';
import { OfflineWarning } from '../OfflineWarning';
import './invites.css';

type RoleChoice = 'tutor' | 'student' | 'none';

interface InviteSheetProps {
  onClose: () => void;
  onCreated?: (invite: Invite) => void;
}

/**
 * The happy path for inviting a student: pick "I'm their tutor" (default),
 * tick the decks they should start with, tap Create link, send or show the
 * QR. Expiry, multi-use and email binding hide under Options.
 */
export function InviteSheet({ onClose, onCreated }: InviteSheetProps) {
  const { isOnline } = useNetwork();
  const [role, setRole] = useState<RoleChoice>('tutor');
  const [selectedDecks, setSelectedDecks] = useState<Set<string>>(new Set());
  const [showOptions, setShowOptions] = useState(false);
  const [email, setEmail] = useState('');
  const [expiresDays, setExpiresDays] = useState<string>('');
  const [multiUse, setMultiUse] = useState(false);
  const [maxUses, setMaxUses] = useState(10);
  const [note, setNote] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [copied, setCopied] = useState(false);

  const decksQuery = useQuery({ queryKey: ['decks'], queryFn: getDecks, enabled: role === 'tutor' });
  const decks = (decksQuery.data ?? []).filter(d => d.user_id !== null);

  // Escape closes; lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const toggleDeck = (id: string) => {
    setSelectedDecks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    setError(null);
    setIsCreating(true);
    try {
      const created = await createInvite({
        inviter_role: role === 'none' ? null : role,
        share_deck_ids: role === 'tutor' ? Array.from(selectedDecks) : [],
        email: email.trim() || null,
        expires_in_days: expiresDays ? Number(expiresDays) : null,
        max_uses: multiUse ? Math.max(2, maxUses) : 1,
        note: note.trim() || null,
      });
      setInvite(created);
      onCreated?.(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the invite');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select the text so the user can copy by hand
      const el = document.getElementById('invite-link-text');
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
    }
  };

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const handleShare = async () => {
    if (!invite) return;
    try {
      await navigator.share({
        title: 'Learn Chinese with me',
        text: 'Here is your invite link to the Chinese learning app:',
        url: invite.url,
      });
    } catch {
      // user cancelled — nothing to do
    }
  };

  return (
    <div className="invite-sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="invite-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-sheet-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="invite-sheet-header">
          <h2 id="invite-sheet-title">{invite ? 'Your invite link' : 'Invite student'}</h2>
          <button type="button" className="invite-sheet-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {!invite ? (
          <div className="invite-sheet-body">
            <p className="invite-sheet-lead">
              They open the link, tap <strong>Continue with Google</strong>, and land on their
              first deck. No email needed.
            </p>

            <div className="invite-field">
              <span className="invite-label">Our relationship</span>
              <div className="invite-role-options" role="radiogroup" aria-label="Relationship">
                <label className={`invite-role-option${role === 'tutor' ? ' selected' : ''}`}>
                  <input type="radio" name="invite-role" checked={role === 'tutor'} onChange={() => setRole('tutor')} />
                  <span className="invite-role-title">I'm their tutor</span>
                  <span className="invite-role-desc">They become my student</span>
                </label>
                <label className={`invite-role-option${role === 'student' ? ' selected' : ''}`}>
                  <input type="radio" name="invite-role" checked={role === 'student'} onChange={() => setRole('student')} />
                  <span className="invite-role-title">They're my tutor</span>
                  <span className="invite-role-desc">I become their student</span>
                </label>
                <label className={`invite-role-option${role === 'none' ? ' selected' : ''}`}>
                  <input type="radio" name="invite-role" checked={role === 'none'} onChange={() => setRole('none')} />
                  <span className="invite-role-title">Just let them in</span>
                  <span className="invite-role-desc">No connection, only access</span>
                </label>
              </div>
            </div>

            {role === 'tutor' && (
              <div className="invite-field">
                <span className="invite-label">Share these decks when they join</span>
                {decksQuery.isLoading ? (
                  <p className="invite-muted">Loading your decks…</p>
                ) : decks.length === 0 ? (
                  <p className="invite-muted">You have no decks yet — you can share one later from the connection page.</p>
                ) : (
                  <div className="invite-deck-list">
                    {decks.map(deck => (
                      <label key={deck.id} className={`invite-deck-option${selectedDecks.has(deck.id) ? ' selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selectedDecks.has(deck.id)}
                          onChange={() => toggleDeck(deck.id)}
                        />
                        <span className="invite-deck-name">{deck.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              className="invite-options-toggle"
              onClick={() => setShowOptions(v => !v)}
              aria-expanded={showOptions}
            >
              {showOptions ? '▾' : '▸'} Options
            </button>

            {showOptions && (
              <div className="invite-options">
                <label className="invite-option-row">
                  <span className="invite-option-label">Only for this email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="optional — their Google email"
                    inputMode="email"
                    autoCapitalize="none"
                  />
                </label>
                <label className="invite-option-row">
                  <span className="invite-option-label">Expires</span>
                  <select value={expiresDays} onChange={e => setExpiresDays(e.target.value)}>
                    <option value="">Never</option>
                    <option value="1">In 1 day</option>
                    <option value="7">In 7 days</option>
                    <option value="30">In 30 days</option>
                    <option value="90">In 90 days</option>
                  </select>
                </label>
                <label className="invite-option-row invite-option-inline">
                  <input type="checkbox" checked={multiUse} onChange={e => setMultiUse(e.target.checked)} />
                  <span className="invite-option-label">Allow multiple people to use this link</span>
                </label>
                {multiUse && (
                  <label className="invite-option-row">
                    <span className="invite-option-label">Max uses</span>
                    <input
                      type="number"
                      min={2}
                      max={1000}
                      value={maxUses}
                      onChange={e => setMaxUses(Number(e.target.value) || 2)}
                    />
                  </label>
                )}
                <label className="invite-option-row">
                  <span className="invite-option-label">Note to self</span>
                  <input
                    type="text"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                    placeholder="e.g. Tuesday class"
                    maxLength={200}
                  />
                </label>
              </div>
            )}

            {error && <p className="text-error invite-error">{error}</p>}
            <OfflineWarning message="You're offline. Invite links can't be created right now." />

            <button
              type="button"
              className="btn btn-primary btn-block invite-create-btn"
              onClick={handleCreate}
              disabled={!isOnline || isCreating}
            >
              {isCreating ? 'Creating…' : 'Create link'}
            </button>
          </div>
        ) : (
          <div className="invite-sheet-body invite-result">
            <div className="invite-qr-wrap">
              <QRCode value={invite.url} size={220} className="invite-qr" />
              <p className="invite-muted">Let them scan this, or send the link.</p>
            </div>

            <div className="invite-link-box">
              <span id="invite-link-text" className="invite-link-text">{invite.url}</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleCopy}>
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
            </div>

            <div className="invite-result-actions">
              {canShare && (
                <button type="button" className="btn btn-primary btn-block" onClick={handleShare}>
                  Share…
                </button>
              )}
              <button type="button" className="btn btn-secondary btn-block" onClick={onClose}>
                Done
              </button>
            </div>

            <p className="invite-muted invite-result-summary">
              {invite.inviter_role === 'tutor' && 'They will be added as your student'}
              {invite.inviter_role === 'student' && 'They will be added as your tutor'}
              {invite.inviter_role === null && 'They will get an account, no connection'}
              {invite.share_deck_ids ? ` and get ${JSON.parse(invite.share_deck_ids).length} deck(s) to start with` : ''}
              {invite.email ? ` — only ${invite.email} can use it` : ''}
              {invite.expires_at ? ` — expires ${new Date(invite.expires_at).toLocaleDateString()}` : ''}
              {invite.max_uses > 1 ? ` — up to ${invite.max_uses} people` : ''}.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
