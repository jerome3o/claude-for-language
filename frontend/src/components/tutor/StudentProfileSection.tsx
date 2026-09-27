import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  EMPTY_STUDENT_PROFILE,
  STUDENT_PROFILE_EXAMPLES,
  studentProfileChips,
  type StudentProfileFields,
} from '@shared/students';
import { getStudentProfile } from '../../api/studentProfile';
import { StudentProfileSheet } from './StudentProfileSheet';
import { relativeDay } from './format';
import './tutor-dashboard.css';
import './student-profile.css';

/** Long enough that the summary is clamped with "Show all". */
const CLAMP_CHARS = 320;

/**
 * "Student profile · only you can see this" on the tutor's student page: what
 * kind of learner the student is and what homework suits them, read by every
 * agent that makes homework / lessons / readers / cards for them. Empty: what
 * it's for + examples to start from. Written: the facts, the text, Edit.
 */
export function StudentProfileSection({ relId, studentName }: { relId: string; studentName: string }) {
  const location = useLocation();
  const ref = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState<StudentProfileFields | null>(null);
  const [expanded, setExpanded] = useState(false);
  const query = useQuery({
    queryKey: ['student-profile', relId],
    queryFn: () => getStudentProfile(relId),
    staleTime: 60_000,
  });
  const profile = query.data ?? null;

  // Linked from the dashboard's "No student profile yet" hint.
  useEffect(() => {
    if (location.hash === '#student-profile' && query.isSuccess) ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [location.hash, query.isSuccess]);

  const fields: StudentProfileFields = profile
    ? { body: profile.body, level: profile.level, handwriting: profile.handwriting, words_per_lesson: profile.words_per_lesson }
    : EMPTY_STUDENT_PROFILE;
  const facts = studentProfileChips(fields);
  const long = fields.body.length > CLAMP_CHARS || fields.body.split('\n').length > 6;

  return (
    <section ref={ref} className="detail-section sp-section" id="student-profile" data-testid="student-profile-section">
      <div className="sp-head">
        <h2>Student profile</h2>
        <span className="sp-private" title={`${studentName} never sees this`}>
          <span aria-hidden="true">🔒</span> Only you can see this
        </span>
      </div>

      {query.isLoading && <div className="sn-empty">Loading…</div>}
      {query.isError && <div className="td-error">Could not load the profile</div>}

      {query.isSuccess && !profile && (
        <div className="sp-card sp-empty" data-testid="sp-empty">
          <p className="sp-lead">What kind of learner is {studentName}, and what homework suits them?</p>
          <ul className="sp-uses">
            <li>
              <span aria-hidden="true">✨</span>
              <span>
                Claude reads this whenever it makes homework, mini lessons, readers or cards for {studentName} — from your lesson
                notes, homework drafts, video lessons and the lesson editor.
              </span>
            </li>
            <li>
              <span aria-hidden="true">🔒</span>
              <span>{studentName} never sees it.</span>
            </li>
          </ul>
          <button type="button" className="btn btn-primary sp-write" onClick={() => setEditing(EMPTY_STUDENT_PROFILE)} data-testid="sp-write">
            ✍️ Write a profile
          </button>
          <div className="sp-start-label">Or start from an example</div>
          <div className="sp-start-list">
            {STUDENT_PROFILE_EXAMPLES.map((ex) => (
              <button
                key={ex.id}
                type="button"
                className="sp-start"
                onClick={() => setEditing({ ...ex.profile })}
                data-testid={`sp-start-${ex.id}`}
              >
                <span className="sp-start-title">{ex.title}</span>
                <span className="sp-start-summary">{ex.summary}</span>
                <span className="sp-start-chevron" aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {profile && (
        <div className="sp-card" data-testid="sp-summary">
          {facts.length > 0 && (
            <div className="sp-facts">
              {facts.map((f) => (
                <span key={f} className="sp-fact">{f}</span>
              ))}
            </div>
          )}
          {fields.body && (
            <div className={`sp-body ${long && !expanded ? 'sp-clamp' : ''}`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{fields.body}</ReactMarkdown>
            </div>
          )}
          {long && (
            <button type="button" className="btn-link sp-more" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
              {expanded ? 'Show less' : 'Show all'}
            </button>
          )}
          <div className="sp-foot">
            <span className="sp-meta">Updated {relativeDay(profile.updated_at)} · Claude follows it for {studentName}&rsquo;s homework</span>
            <button type="button" className="btn btn-secondary sp-small" onClick={() => setEditing(fields)} data-testid="sp-edit">
              ✏️ Edit
            </button>
          </div>
        </div>
      )}

      {editing && <StudentProfileSheet relId={relId} studentName={studentName} saved={fields} initial={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}
