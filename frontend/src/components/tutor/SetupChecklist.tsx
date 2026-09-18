import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { StudentOverview, SetupStep } from '../../types/tutorDashboard';
import { sendInstallHowTo } from '../../api/tutorDashboard';
import { InviteQRSheet } from './InviteQRSheet';
import { copyTextToClipboard } from '../../utils/clipboard';
import { relativeTime, shortDate } from './format';
import './tutor-dashboard.css';

const COMPACT_TITLES: Record<SetupStep['key'], string> = {
  signed_in: 'Signed in',
  homework: 'Homework received',
  installed: 'Installed the app',
  first_session: 'First study session',
};

function CheckBox({ done }: { done: boolean }) {
  return <span className="td-check-box" aria-hidden="true">{done ? '✓' : ''}</span>;
}

/** The four-step grid inside a dashboard card. */
export function SetupChecklistCompact({ overview }: { overview: StudentOverview }) {
  return (
    <div className="td-checklist-compact" aria-label="Getting set up">
      {overview.setup.steps.map((s) => (
        <div key={s.key} className={`td-check ${s.done ? 'done' : ''}`}>
          <CheckBox done={s.done} />
          <span className="td-check-label">
            {COMPACT_TITLES[s.key]}
            {s.key === 'signed_in' && s.done && overview.student && ` (${shortDate(overview.joined_at)})`}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Full "Getting set up" card + "If they get stuck" for the student page of a
 * brand-new student (no review events yet). Replaces the empty progress page.
 */
export function SetupChecklist({
  overview,
  onMessage,
  onSendHomework,
}: {
  overview: StudentOverview;
  onMessage: () => void;
  onSendHomework: () => void;
}) {
  const relId = overview.relationship_id;
  const { setup } = overview;
  const [showQR, setShowQR] = useState(false);
  const [copied, setCopied] = useState(false);
  const [howToSent, setHowToSent] = useState(false);

  const howTo = useMutation({
    mutationFn: () => sendInstallHowTo(relId),
    onSuccess: () => setHowToSent(true),
  });

  const copyLink = async () => {
    if (!setup.invite) return;
    const ok = await copyTextToClipboard(setup.invite.url);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
  };

  const actionFor = (step: SetupStep) => {
    switch (step.key) {
      case 'homework':
        return !step.done ? (
          <button type="button" className="td-inline-btn" onClick={onSendHomework}>Send homework</button>
        ) : null;
      case 'installed':
        return !step.done ? (
          <button type="button" className="td-inline-btn" onClick={() => howTo.mutate()} disabled={howTo.isPending || howToSent}>
            {howToSent ? 'How-to sent ✓' : howTo.isPending ? 'Sending…' : 'Send how-to'}
          </button>
        ) : null;
      case 'first_session':
        return !step.done ? (
          <button type="button" className="td-inline-btn" onClick={onMessage}>Message</button>
        ) : null;
      default:
        return null;
    }
  };

  const detailFor = (step: SetupStep) => {
    // The server gives ISO timestamps in the detail for two steps; make them readable.
    if (step.key === 'signed_in' && step.done) {
      return [overview.student.email, shortDate(overview.joined_at)].filter(Boolean).join(' · ');
    }
    if (step.key === 'first_session' && step.done) {
      return step.detail.replace(/(\d{4}-\d{2}-\d{2}T[^\s]+)/, (m) => shortDate(m));
    }
    return step.detail;
  };

  const audioText =
    setup.audio.cached == null
      ? 'Audio: not downloaded yet'
      : `Audio: ${Math.min(setup.audio.cached, setup.audio.total || setup.audio.cached)}/${setup.audio.total} clips on their device${setup.audio.total > 0 && setup.audio.cached >= setup.audio.total ? ' ✓' : ''}`;

  return (
    <>
      <section className="td-setup" aria-labelledby="td-setup-title">
        <div className="td-setup-head">
          <h2 id="td-setup-title">Getting set up</h2>
          <span className="td-pill td-pill-setup">{setup.done_count} of {setup.steps.length}</span>
        </div>
        <div className="td-setup-steps">
          {setup.steps.map((step) => (
            <div key={step.key} className={`td-step ${step.done ? 'done' : ''}`}>
              <CheckBox done={step.done} />
              <div className="td-step-main">
                <div className="td-step-title">{step.title}</div>
                <div className="td-step-detail">{detailFor(step)}</div>
              </div>
              {actionFor(step)}
            </div>
          ))}
        </div>
        {howTo.error && <div className="td-error td-mt">{howTo.error instanceof Error ? howTo.error.message : 'Could not send the how-to'}</div>}
        <p className="td-setup-foot">
          {audioText} · Last opened: {setup.last_opened_at ? relativeTime(setup.last_opened_at) : 'not yet'}
        </p>
      </section>

      <section className="td-stuck" aria-labelledby="td-stuck-title">
        <h3 id="td-stuck-title">If they get stuck</h3>
        <div className="td-stuck-actions">
          {setup.invite ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setShowQR(true)}>Show QR again</button>
              <button type="button" className="btn btn-secondary" onClick={copyLink}>{copied ? 'Copied ✓' : 'Copy invite link'}</button>
            </>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={onMessage}>Message</button>
          )}
        </div>
        <p>
          {setup.invite
            ? 'The link keeps working for this student even after they have signed in — scanning it again just opens the app.'
            : 'This student did not join through one of your invite links. Create a new link from Students → + Invite student if they need to sign in on another phone.'}
        </p>
      </section>

      {showQR && setup.invite && (
        <InviteQRSheet
          url={setup.invite.url}
          title="Invite link"
          hint="Scanning this again on their phone just opens the app for them."
          onClose={() => setShowQR(false)}
        />
      )}
    </>
  );
}
