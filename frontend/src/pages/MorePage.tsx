import { ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { useNavRole } from '../components/nav/useNavRole';
import { useMaintenanceActions } from '../components/nav/useMaintenanceActions';
import { getPendingFeatureRequestCount } from '../api/client';
import { listLibrary } from '../api/lessonEditor';
import './MorePage.css';

interface RowProps {
  icon: string;
  label: string;
  desc?: string;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  badge?: ReactNode;
}

/** One 56px row: icon · label + one-line description · chevron. */
export function NavRow({ icon, label, desc, to, onClick, disabled, danger, badge }: RowProps) {
  const body = (
    <>
      <span className="nav-row-icon" aria-hidden="true">{icon}</span>
      <span className="nav-row-text">
        <span className="nav-row-label">
          {label}
          {badge}
        </span>
        {desc && <span className="nav-row-desc">{desc}</span>}
      </span>
      <span className="nav-row-chevron" aria-hidden="true">›</span>
    </>
  );
  const className = `nav-row${danger ? ' nav-row-danger' : ''}`;
  if (to) {
    return <Link to={to} className={className}>{body}</Link>;
  }
  return (
    <button type="button" className={className} onClick={onClick} disabled={disabled}>
      {body}
    </button>
  );
}

export function NavSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="nav-section">
      <h2 className="nav-section-title">{title}</h2>
      <div className="nav-list">{children}</div>
    </section>
  );
}

/**
 * The More tab. Replaces the 15-item avatar dropdown: grouped, every row
 * 56px, tools first, plumbing last (and collapsed).
 */
export function MorePage() {
  const { user, logout } = useAuth();
  const role = useNavRole();
  const maintenance = useMaintenanceActions();
  const [showAdvanced, setShowAdvanced] = useState(false);

  // The Lesson Library is a teaching tool: shown to anyone with students, or
  // anyone who already has library items (a tutor between students).
  const libraryQuery = useQuery({
    queryKey: ['lesson-library-count'],
    queryFn: async () => (await listLibrary()).length,
    enabled: !role.hasStudents && role.loaded,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const showTeaching = role.hasStudents || (libraryQuery.data ?? 0) > 0;

  const pendingQuery = useQuery({
    queryKey: ['pending-feature-requests'],
    queryFn: getPendingFeatureRequestCount,
    enabled: !!user?.is_admin,
    retry: false,
  });
  const pendingCount = pendingQuery.data ?? 0;

  return (
    <div className="page">
      <div className="container more-page">
        <h1>More</h1>

        {user && (
          <Link to="/settings" className="more-user-card">
            {user.picture_url ? (
              <img src={user.picture_url} alt="" className="more-user-avatar" />
            ) : (
              <span className="more-user-avatar more-user-avatar-placeholder">
                {user.name?.[0] || user.email?.[0] || '?'}
              </span>
            )}
            <span className="nav-row-text">
              <span className="nav-row-label">{user.name || 'You'}</span>
              <span className="nav-row-desc">{user.email}</span>
            </span>
            <span className="nav-row-chevron" aria-hidden="true">›</span>
          </Link>
        )}

        <NavSection title="Practice">
          <NavRow icon="🧑‍🏫" label="Sentence Coach" desc="Check a sentence you wrote" to="/coach" />
          <NavRow icon="🔍" label="Sentence Breakdown" desc="Split any sentence into words" to="/analyze" />
          {!role.isTutorOnly && (
            <NavRow icon="📚" label="Readers" desc="Short stories at your level" to="/readers" />
          )}
          <NavRow icon="🎓" label="Mini Lessons" desc="Lessons made for you, mixed into study" to="/lessons" />
          {!role.isTutorOnly && (
            <NavRow icon="💬" label="Claude conversations" desc="Everything you asked Claude about your cards" to="/claude-chats" />
          )}
          <NavRow icon="🎮" label="Quests" desc="Carry out instructions in a tiny world" to="/quests" />
          <NavRow icon="📹" label="Video calls (beta)" desc="Live lessons with a whiteboard, then a transcript" to="/calls" />
        </NavSection>

        {!role.isTutorOnly && (
          <NavSection title="From your tutor">
            <NavRow
              icon="📝"
              label="Lesson Notes"
              desc={role.hasTutor ? 'Paste what your tutor sent you' : 'Notes from lessons, for readers and sentences'}
              to="/lesson-notes"
            />
          </NavSection>
        )}

        {showTeaching && (
          <NavSection title="Teaching">
            <NavRow icon="🗂️" label="Lesson Library" desc="Lessons you assign to students" to="/library" />
          </NavSection>
        )}

        <NavSection title="Account">
          <NavRow
            icon="⚙️"
            label="Settings"
            desc={role.isTutorOnly ? 'Backup · Start on' : 'Bio · Offline audio · Backup · Start on'}
            to="/settings"
          />
          <NavRow icon="🚪" label="Sign out" onClick={() => { logout(); }} danger />
        </NavSection>

        <section className="nav-section">
          <button
            type="button"
            className="nav-section-toggle"
            onClick={() => setShowAdvanced(v => !v)}
            aria-expanded={showAdvanced}
            aria-controls="more-advanced"
          >
            <span className="nav-section-title" style={{ margin: 0 }}>Advanced</span>
            <span className="nav-section-toggle-hint">
              {showAdvanced ? 'Hide' : 'Duplicate finder · Full sync · Update app · Debug · Sentence coverage'}
            </span>
            <span className={`nav-row-chevron nav-section-toggle-chevron${showAdvanced ? ' open' : ''}`} aria-hidden="true">›</span>
          </button>
          {showAdvanced && (
            <div className="nav-list" id="more-advanced">
              <NavRow icon="🪞" label="Duplicate Finder" desc="Find words that appear in more than one deck" to="/duplicate-finder" />
              <NavRow icon="💬" label="Sentence Coverage" desc="Example-sentence generation status" to="/settings/sentences" />
              <NavRow
                icon="🔄"
                label={maintenance.isSyncing ? 'Syncing…' : 'Full Sync'}
                desc="Reconcile all reviews with the server and recompute every card"
                onClick={maintenance.fullSync}
                disabled={maintenance.isSyncing}
              />
              <NavRow
                icon="⬇️"
                label={maintenance.isUpdating ? 'Checking…' : 'Update App'}
                desc="Check for a new version now"
                onClick={maintenance.updateApp}
                disabled={maintenance.isUpdating}
              />
              <NavRow
                icon="🐞"
                label={maintenance.debugConsoleOn ? 'Debug Console: On' : 'Debug Console: Off'}
                desc="On-device devtools (reloads the app)"
                onClick={maintenance.toggleDebugConsole}
              />
              <NavRow
                icon="🧪"
                label={maintenance.isDumping ? 'Building dump…' : 'Copy Debug Dump'}
                desc="Copy logs and local state for a bug report"
                onClick={maintenance.copyDump}
                disabled={maintenance.isDumping}
              />
              {user?.is_admin && (
                <NavRow
                  icon="🛠️"
                  label="Admin"
                  desc="Users, invites, feature requests"
                  to="/admin"
                  badge={pendingCount > 0 ? <span className="nav-row-badge">{pendingCount}</span> : undefined}
                />
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
