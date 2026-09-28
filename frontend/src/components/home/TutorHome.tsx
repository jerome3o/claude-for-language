import { Link } from 'react-router-dom';
import { LiveCallBanner } from '../calls/CallBanner';
import { useQuery } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import { getMyRelationships } from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../db/database';
import { NavRow, NavSection } from '../../pages/MorePage';
import './TutorHome.css';

/**
 * `/` for a tutor account (users.role = 'tutor'). No streak, no "Study today's
 * cards", no homework card, no learner onboarding: a teacher's start page —
 * students, the things they make, and a way to try any of it as a student
 * would see it without recording a single review.
 */
export function TutorHome() {
  const { user } = useAuth();
  const relationships = useQuery({
    queryKey: ['nav-relationships'],
    queryFn: getMyRelationships,
    staleTime: 30_000,
    retry: false,
  });
  const students = (relationships.data?.students ?? []).filter((r) => r.status === 'active');
  // Queue order (higher priority first, then newest) — the same order the Decks tab shows.
  const decks = useLiveQuery(async () => (await db.decks.toArray()).sort((a, b) =>
    (b.study_priority ?? 0) - (a.study_priority ?? 0) || (b.created_at ?? '').localeCompare(a.created_at ?? '')
  ), []) ?? [];
  const firstName = user?.name?.split(' ')[0];

  return (
    <div className="page">
      <div className="container tutor-home">
        <LiveCallBanner variant="card" />
        <h1>{firstName ? `Hi ${firstName}` : 'Teaching'}</h1>
        <p className="tutor-home-lead">Your students, and everything you make for them.</p>

        <Link to="/connections" className="tutor-home-students card">
          <span className="tutor-home-students-icon" aria-hidden="true">👥</span>
          <span className="tutor-home-students-text">
            <strong>
              {relationships.isLoading
                ? 'Your students'
                : students.length === 0
                  ? 'Invite your first student'
                  : `${students.length} student${students.length === 1 ? '' : 's'}`}
            </strong>
            <span>How they are doing, what needs attention, send homework</span>
          </span>
          <span className="nav-row-chevron" aria-hidden="true">›</span>
        </Link>

        <NavSection title="Make">
          <NavRow icon="🗂️" label="Lesson Library" desc="Mini lessons you assign" to="/library" />
          <NavRow icon="📚" label="Readers" desc="Graded stories to share" to="/readers" />
          <NavRow icon="🃏" label="Decks" desc="Word lists you send as homework" to="/decks" />
          <NavRow icon="📹" label="Video calls (beta)" desc="Lessons with a whiteboard and a transcript" to="/calls" />
        </NavSection>

        <section className="nav-section" aria-labelledby="tutor-home-try">
          <h2 className="nav-section-title" id="tutor-home-try">Try it as your student</h2>
          <p className="tutor-home-note">
            Go through a deck or a lesson exactly as a student gets it. Nothing is recorded — no reviews, no streak, no schedule.
          </p>
          {decks.length === 0 ? (
            <p className="tutor-home-note">Your decks will appear here.</p>
          ) : (
            <div className="nav-list">
              {decks.slice(0, 5).map((deck) => (
                <NavRow key={deck.id} icon="▶" label={deck.name} desc="Try this deck" to={`/decks/${deck.id}/try`} />
              ))}
            </div>
          )}
          <Link to="/library" className="tutor-home-try-lessons">Try a lesson: open it in the Library → Try it</Link>
        </section>
      </div>
    </div>
  );
}
