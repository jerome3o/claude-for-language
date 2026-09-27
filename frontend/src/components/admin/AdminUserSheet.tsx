import { useEffect, useState } from 'react';
import type { UserRole } from '../../types';
import {
  AdminShareRow,
  AdminUserInspection,
  DeletionPreview,
  deleteAdminUser,
  getDeletionPreview,
  inspectAdminUser,
  setAdminUserRole,
} from '../../api/admin';
import { API_BASE } from '../../api/client';
import './AdminUserSheet.css';

const LABELS: Record<string, string> = {
  decks: 'Decks',
  notes: 'Notes',
  cards: 'Cards',
  review_events: 'Review events',
  recordings: 'Recordings',
  readers: 'Readers',
  custom_lessons: 'Mini lessons',
  library_lessons: 'Library lessons',
  relationships: 'Tutor / student links',
  conversations: 'Conversations',
  messages: 'Chat messages',
  calls: 'Video calls',
  coach_conversations: 'Coach chats',
  quests: 'Quests',
  feature_requests: 'Feature requests',
  invites: 'Invite links',
  sessions: 'Sign-in sessions',
  deck_copies_in_other_accounts: "Deck copies in students' accounts",
  reader_copies_in_other_accounts: "Reader copies in students' accounts",
  lessons_assigned_to_others: 'Lessons assigned to students',
};

function when(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function ShareLine({ share, side }: { share: AdminShareRow; side: 'sent' | 'received' }) {
  const name = side === 'sent' ? share.source_name : share.target_name;
  const ghost = !share.source_exists && !share.target_exists;
  return (
    <li className={ghost ? 'admin-sheet-ghost' : undefined}>
      <span className="admin-sheet-deck-name">{name ?? share.target_name ?? share.source_name ?? share.source_deck_id.slice(0, 8)}</span>
      <span className="admin-sheet-muted">
        {' '}· tutor deck {share.source_exists ? '✓' : 'deleted'} · student copy {share.target_exists ? '✓' : 'deleted'} · {when(share.shared_at)}
      </span>
    </li>
  );
}

/**
 * One account for the admin: who they are, how their device last synced,
 * relationships, decks including deleted ones and shares, role switch, and
 * the typed-email account deletion.
 */
export function AdminUserSheet({
  userId,
  onClose,
  onRoleChanged,
  onDeleted,
}: {
  userId: string;
  onClose: () => void;
  onRoleChanged: (id: string, role: UserRole) => void;
  onDeleted: (id: string) => void;
}) {
  const [data, setData] = useState<AdminUserInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roleBusy, setRoleBusy] = useState(false);
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    inspectAdminUser(userId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load'); });
    return () => { cancelled = true; };
  }, [userId]);

  const changeRole = async (role: UserRole) => {
    if (!data || role === data.user.role) return;
    setRoleBusy(true);
    try {
      await setAdminUserRole(userId, role);
      setData({ ...data, user: { ...data.user, role } });
      onRoleChanged(userId, role);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to change role');
    } finally {
      setRoleBusy(false);
    }
  };

  const openDelete = async () => {
    setDeleteError(null);
    try {
      setPreview(await getDeletionPreview(userId));
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Failed to load the preview');
    }
  };

  const email = data?.user.email ?? '';
  const confirmed = !!email && confirm.trim().toLowerCase() === email.toLowerCase();

  const doDelete = async () => {
    if (!confirmed) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAdminUser(userId, confirm.trim());
      onDeleted(userId);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed');
      setDeleting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal admin-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="admin-sheet-title">
        <div className="modal-header">
          <h2 className="modal-title" id="admin-sheet-title">{data?.user.name || data?.user.email || 'Account'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        {error && <div className="admin-error">{error}</div>}
        {!data && !error && <p className="admin-sheet-muted">Loading…</p>}

        {data && (
          <>
            <p className="admin-sheet-muted admin-sheet-email">{data.user.email}</p>

            <section className="admin-sheet-section">
              <h3>Role</h3>
              <div className="admin-role-switch" role="radiogroup" aria-label="Role">
                {(['student', 'tutor'] as const).map((role) => (
                  <button
                    key={role}
                    type="button"
                    role="radio"
                    aria-checked={data.user.role === role}
                    className={`admin-role-option${data.user.role === role ? ' selected' : ''}`}
                    disabled={roleBusy}
                    onClick={() => changeRole(role)}
                  >
                    {role === 'student' ? '🎒 Student' : '🧑‍🏫 Tutor'}
                  </button>
                ))}
              </div>
              <p className="admin-sheet-hint">
                {data.user.role === 'tutor'
                  ? 'Tutor app: opens on Students, Library tab, no study reminders; decks and lessons can be tried without recording anything.'
                  : 'Learner app: Study home, streaks and daily cards.'}
              </p>
            </section>

            <section className="admin-sheet-section">
              <h3>Device &amp; sync</h3>
              <dl className="admin-sheet-grid">
                <dt>Installed as</dt><dd>{data.sync.install_kind ?? 'unknown'}</dd>
                <dt>Last opened</dt><dd>{when(data.sync.last_opened_at)}</dd>
                <dt>Last review sync</dt><dd>{when(data.sync.last_event_sync_at)}</dd>
                <dt>Last review</dt><dd>{when(data.counts.last_review_at)}</dd>
                <dt>Cached clips</dt><dd>{data.sync.cached_audio_count ?? '—'}</dd>
                <dt>Sessions</dt><dd>{data.sync.active_sessions} active · {data.sync.mcp_tokens} MCP</dd>
              </dl>
            </section>

            <section className="admin-sheet-section">
              <h3>Links</h3>
              {data.relationships.length === 0 ? (
                <p className="admin-sheet-muted">None</p>
              ) : (
                <ul className="admin-sheet-list">
                  {data.relationships.map((r) => (
                    <li key={r.id}>
                      {r.my_role === 'tutor' ? 'Tutor of ' : 'Student of '}
                      <strong>{r.other.name || r.other.email}</strong>
                      <span className="admin-sheet-muted"> · {r.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="admin-sheet-section">
              <h3>Decks ({data.decks.decks.length})</h3>
              <ul className="admin-sheet-list">
                {data.decks.decks.map((d) => (
                  <li key={d.id}>
                    <span className="admin-sheet-deck-name">{d.name}</span>
                    <span className="admin-sheet-muted"> · {d.note_count} words · made {when(d.created_at)}</span>
                  </li>
                ))}
              </ul>
              {data.decks.deleted_decks.length > 0 && (
                <>
                  <h4>Deleted ({data.decks.deleted_decks.length})</h4>
                  <ul className="admin-sheet-list">
                    {data.decks.deleted_decks.map((d) => (
                      <li key={d.id}>
                        <span className="admin-sheet-deck-name">{d.name_hint ?? d.id.slice(0, 8)}</span>
                        <span className="admin-sheet-muted"> · {when(d.deleted_at)} · {d.notes_deleted_with_it} words</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {data.decks.untombstoned_deleted_sources.length > 0 && (
                <p className="admin-sheet-warning">
                  {data.decks.untombstoned_deleted_sources.length} deck{data.decks.untombstoned_deleted_sources.length === 1 ? ' was' : 's were'} deleted
                  before deletions synced (23 Sep). Devices drop them on their next sync.
                </p>
              )}
              {data.decks.shares_sent.length > 0 && (
                <>
                  <h4>Sent to students ({data.decks.shares_sent.length})</h4>
                  <ul className="admin-sheet-list">{data.decks.shares_sent.map((s) => <ShareLine key={s.id} share={s} side="sent" />)}</ul>
                </>
              )}
              {data.decks.shares_received.length > 0 && (
                <>
                  <h4>From tutors ({data.decks.shares_received.length})</h4>
                  <ul className="admin-sheet-list">{data.decks.shares_received.map((s) => <ShareLine key={s.id} share={s} side="received" />)}</ul>
                </>
              )}
            </section>

            {data.recent_feature_requests.length > 0 && (
              <section className="admin-sheet-section">
                <h3>Recent reports</h3>
                <ul className="admin-sheet-list">
                  {data.recent_feature_requests.map((r) => (
                    <li key={r.id}>
                      {r.content}
                      <span className="admin-sheet-muted"> · {when(r.created_at)} · {r.page_context || '/'} · {r.status}</span>
                      {r.screenshot_url && (
                        <> · <a href={`${API_BASE}${r.screenshot_url}`} target="_blank" rel="noopener noreferrer">screenshot</a></>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="admin-sheet-section admin-sheet-danger">
              <h3>Delete account</h3>
              {!preview ? (
                <button type="button" className="btn btn-danger-outline" onClick={openDelete} disabled={data.user.is_admin}>
                  {data.user.is_admin ? 'Admins cannot be deleted' : 'Delete this account…'}
                </button>
              ) : (
                <>
                  {preview.blockers.length > 0 ? (
                    <div className="admin-error">{preview.blockers.join(' ')}</div>
                  ) : (
                    <>
                      <p>This permanently deletes:</p>
                      <ul className="admin-sheet-counts">
                        {Object.entries(preview.will_delete).filter(([, n]) => n > 0).map(([k, n]) => (
                          <li key={k}><strong>{n}</strong> {LABELS[k] ?? k}</li>
                        ))}
                        <li><strong>{preview.r2_objects}</strong> stored audio / image files</li>
                      </ul>
                      {Object.values(preview.will_keep).some((n) => n > 0) && (
                        <>
                          <p>Kept (they belong to other people now):</p>
                          <ul className="admin-sheet-counts">
                            {Object.entries(preview.will_keep).filter(([, n]) => n > 0).map(([k, n]) => (
                              <li key={k}><strong>{n}</strong> {LABELS[k] ?? k}</li>
                            ))}
                          </ul>
                        </>
                      )}
                      <label className="admin-sheet-confirm">
                        Type <strong>{email}</strong> to confirm
                        <input
                          type="email"
                          value={confirm}
                          onChange={(e) => setConfirm(e.target.value)}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={email}
                        />
                      </label>
                      <button type="button" className="btn btn-danger" disabled={!confirmed || deleting} onClick={doDelete}>
                        {deleting ? 'Deleting…' : 'Delete account forever'}
                      </button>
                    </>
                  )}
                </>
              )}
              {deleteError && <div className="admin-error">{deleteError}</div>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
