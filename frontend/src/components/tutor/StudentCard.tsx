import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { StudentOverview } from '../../types/tutorDashboard';
import { SetupChecklistCompact } from './SetupChecklist';
import { InviteQRSheet } from './InviteQRSheet';
import { useMessageStudent } from './useMessageStudent';
import { initial, percent, relativeDay, shortDate } from './format';
import './tutor-dashboard.css';

export function Avatar({ name, email, picture_url, size = 'md', muted = false }: { name: string | null; email: string | null; picture_url: string | null; size?: 'md' | 'lg'; muted?: boolean }) {
  const cls = `td-avatar ${size === 'lg' ? 'td-avatar-lg' : ''} ${muted ? 'td-avatar-muted' : ''}`;
  return picture_url ? <img src={picture_url} alt="" className={cls} /> : <div className={cls} aria-hidden="true">{initial(name, email)}</div>;
}

/** "Studied today · 🔥 3 days · 84% today" / "Last studied 3 days ago · 🔥 0" */
export function studyStatusLine(o: StudentOverview): string {
  const s = o.status;
  if (!s.last_studied_at) return 'Hasn\'t studied yet';
  const parts: string[] = [];
  parts.push(s.studied_today ? 'Studied today' : `Last studied ${relativeDay(s.last_studied_at)}`);
  parts.push(`🔥 ${s.streak_days} day${s.streak_days === 1 ? '' : 's'}`);
  if (s.studied_today && s.today.accuracy != null) parts.push(`${percent(s.today.accuracy)} today`);
  return parts.join(' · ');
}

export function StudentCard({ overview, onSendHomework }: { overview: StudentOverview; onSendHomework: (o: StudentOverview) => void }) {
  const { student, relationship_id: relId } = overview;
  const name = student.name || student.email || 'Student';
  const { message, busy } = useMessageStudent(relId, overview.last_conversation_id);
  const [showQR, setShowQR] = useState(false);

  if (overview.is_new) {
    return (
      <article className="td-card td-card-new" aria-label={`${name}, getting set up`}>
        <Link to={`/connections/${relId}`} className="td-card-head">
          <Avatar name={student.name} email={student.email} picture_url={student.picture_url} />
          <span className="td-card-title">
            <span className="td-card-name">
              {name}
              <span className="td-pill td-pill-setup">Getting set up</span>
            </span>
            <span className="td-card-status">Joined {relativeDay(overview.joined_at)} · hasn't studied yet</span>
          </span>
          <span className="td-chevron">›</span>
        </Link>
        <SetupChecklistCompact overview={overview} />
        <div className="td-card-actions">
          {overview.setup.invite ? (
            <button type="button" className="btn btn-secondary" onClick={() => setShowQR(true)}>Show invite QR again</button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={() => onSendHomework(overview)}>📤 Send homework</button>
          )}
          <button type="button" className="btn btn-secondary" onClick={message} disabled={busy}>💬 Message</button>
        </div>
        {showQR && overview.setup.invite && (
          <InviteQRSheet url={overview.setup.invite.url} title={`Invite link for ${name}`} onClose={() => setShowQR(false)} hint={`Created ${shortDate(overview.joined_at)} · scanning it again just opens the app.`} />
        )}
      </article>
    );
  }

  const { pills } = overview;
  return (
    <article className="td-card" aria-label={name}>
      <Link to={`/connections/${relId}`} className="td-card-head">
        <Avatar name={student.name} email={student.email} picture_url={student.picture_url} />
        <span className="td-card-title">
          <span className="td-card-name">{name}</span>
          <span className="td-card-status">{studyStatusLine(overview)}</span>
        </span>
        <span className="td-chevron">›</span>
      </Link>
      <div className="td-pills">
        {pills.struggling_words > 0 ? (
          <Link to={`/connections/${relId}/insights`} className="td-pill td-pill-struggling">
            {pills.struggling_words} word{pills.struggling_words === 1 ? '' : 's'} struggling
          </Link>
        ) : (
          <span className="td-pill td-pill-ok">No words struggling</span>
        )}
        {pills.flags_open > 0 && (
          <Link to={`/connections/${relId}#flags`} className="td-pill td-pill-flags">
            🚩 {pills.flags_open} flagged card{pills.flags_open === 1 ? '' : 's'}
          </Link>
        )}
        {pills.recordings_to_hear > 0 && (
          <Link to={`/connections/${relId}/recordings`} className="td-pill td-pill-recordings">
            🎤 {pills.recordings_to_hear} recording{pills.recordings_to_hear === 1 ? '' : 's'} to hear
          </Link>
        )}
        {pills.homework_percent != null && (
          <Link to={`/connections/${relId}`} className="td-pill td-pill-homework">Homework {pills.homework_percent}%</Link>
        )}
      </div>
      <div className="td-card-actions">
        <button type="button" className="btn btn-secondary" onClick={message} disabled={busy}>💬 Message</button>
        <button type="button" className="btn btn-secondary" onClick={() => onSendHomework(overview)}>📤 Send homework</button>
      </div>
    </article>
  );
}
