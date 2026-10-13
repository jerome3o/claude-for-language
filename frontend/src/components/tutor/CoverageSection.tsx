import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { coverageHeadline } from '@shared/students/coverage';
import { firstName } from '@shared/call-activities';
import { coverageKey, getStudentCoverage } from '../../api/preparedActivities';
import './prepared-activities.css';

const INLINE = 4;

/** "Oct 5" for a YYYY-MM-DD day (read at noon UTC so no time zone moves it). */
function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (isNaN(d.getTime())) return date;
  const sameYear = d.getUTCFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC', ...(sameYear ? {} : { year: 'numeric' }) });
}

/**
 * "What <student> has covered": the lessons (recorded video lessons' topics,
 * logged lessons' titles), words / characters met and known well, and the
 * newest words — all from what the app already records (docs/VIDEO_CALLS.md
 * "Prepared activities"). The prepared-activities generator reads the same.
 */
export function CoverageSection({ relId, studentName }: { relId: string; studentName: string }) {
  const [all, setAll] = useState(false);
  const query = useQuery({ queryKey: coverageKey(relId), queryFn: () => getStudentCoverage(relId), staleTime: 120_000 });
  const c = query.data?.coverage;
  const name = firstName(studentName);
  if (query.isError) return null;
  const headline = c ? coverageHeadline(c) : '';
  const lessons = c ? (all ? c.lessons : c.lessons.slice(0, INLINE)) : [];

  return (
    <section className="detail-section cov-section" data-testid="coverage-section">
      <h2>What {name} has covered</h2>
      {query.isLoading && <div className="sn-empty">Loading…</div>}
      {c && (
        <div className="pa-card">
          <p className="pa-headline" data-testid="coverage-headline">{headline || `Nothing on record for ${name} yet.`}</p>
          {lessons.length > 0 && (
            <ol className="cov-lessons">
              {lessons.map((l) => (
                <li key={`${l.date}-${l.source}`} className="cov-lesson">
                  <span className="cov-date">{dayLabel(l.date)}</span>
                  <span className="cov-body">
                    {l.title && <span className="cov-title">{l.title}</span>}
                    {l.topics.length > 0 && (
                      <span className="cov-topics">
                        {l.topics.map((t) => (
                          <span key={t} className="cov-chip">{t}</span>
                        ))}
                      </span>
                    )}
                    <span className="cov-meta">
                      {l.source === 'call' ? '📹 Video lesson' : '📝 Lesson notes'}
                      {l.new_words > 0 ? ` · ${l.new_words} new word${l.new_words === 1 ? '' : 's'}` : ''}
                      {l.corrections > 0 ? ` · ${l.corrections} correction${l.corrections === 1 ? '' : 's'}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {c.lessons.length > INLINE && (
            <button type="button" className="pa-link" onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `Show all ${c.lessons.length}`}
            </button>
          )}
          {c.recent_words.length > 0 && (
            <div className="cov-words">
              <span className="cov-words-label">Recent words</span>
              <span className="cov-topics">
                {c.recent_words.slice(0, 18).map((w) => (
                  <span key={w.hanzi} className="cov-chip cov-word" title={`${w.pinyin} — ${w.english}`}>
                    {w.hanzi}
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
