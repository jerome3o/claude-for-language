/**
 * Exercise catalogue — every lesson exercise type with what it trains, how
 * it's checked, and a sample lesson the tutor can take (a trial: nothing is
 * recorded) or copy into their library to adapt and assign.
 *
 * Reads the shared registry (shared/lesson/registry.ts) and the bundled
 * samples (shared/lesson/samples.ts), so it works offline and lists a new
 * type as soon as it is registered.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  EXERCISE_TYPE_LIST,
  SKILL_LABELS,
  type ExerciseSkill,
  type ExerciseTypeInfo,
} from '@shared/lesson';
import { SAMPLE_LESSONS, sampleLesson, type SampleLesson } from '@shared/lesson/samples';
import { createLibraryItem } from '../../api/lessonEditor';
import { StudyCustomLesson } from '../../components/StudyCustomLesson';
import { ErrorMessage } from '../../components/Loading';
import '../StudyPage.css';
import './ExerciseCataloguePage.css';

/** Types added with the practice set — badged "New" in the catalogue. */
const NEW_TYPES = new Set(['sentence_making', 'write_typed', 'write_handwriting', 'dictation', 'oral_expression', 'conversation']);

const SKILL_ORDER: ExerciseSkill[] = ['listening', 'speaking', 'writing', 'reading', 'teaching'];

function exerciseCount(sample: SampleLesson): number {
  return sample.spec.sections.reduce((n, s) => n + s.exercises.length, 0);
}

function TypeCard({ info, onCopy, copying }: { info: ExerciseTypeInfo; onCopy: (s: SampleLesson) => void; copying: boolean }) {
  const sample = SAMPLE_LESSONS.find(s => s.type === info.type);
  return (
    <article className="cat-card" id={`type-${info.type}`}>
      <div className="cat-card-head">
        <span className="cat-card-icon" aria-hidden="true">{info.icon}</span>
        <div className="cat-card-titles">
          <h3>
            {info.name}
            {NEW_TYPES.has(info.type) && <span className="cat-badge new">New</span>}
          </h3>
          <span className="cat-card-summary">{info.summary}</span>
        </div>
      </div>
      <p className="cat-card-desc">{info.description}</p>
      <div className="cat-card-meta">
        <span className="cat-meta-item">✔︎ {info.checking}</span>
        {info.needs === 'microphone' && <span className="cat-badge">🎙 Uses the microphone</span>}
        {info.needs === 'handwriting' && <span className="cat-badge">✍️ Writing pad</span>}
      </div>
      {sample && (
        <div className="cat-sample">
          <span className="cat-sample-title">
            {sample.spec.icon} Sample: {sample.spec.title} · {exerciseCount(sample)} exercise{exerciseCount(sample) === 1 ? '' : 's'}
          </span>
          <div className="cat-sample-actions">
            <Link to={`/library/catalogue/${sample.id}`} className="btn btn-primary btn-sm">▶ Try it</Link>
            <button className="btn btn-secondary btn-sm" onClick={() => onCopy(sample)} disabled={copying}>
              {copying ? 'Copying…' : '＋ Copy to my library'}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

export function ExerciseCataloguePage() {
  const navigate = useNavigate();
  const [skill, setSkill] = useState<ExerciseSkill | 'all'>('all');
  const [copying, setCopying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = useMemo(
    () => SKILL_ORDER
      .filter(s => skill === 'all' || s === skill)
      .map(s => ({ skill: s, types: EXERCISE_TYPE_LIST.filter(t => t.skill === s) }))
      .filter(g => g.types.length > 0),
    [skill],
  );

  async function copy(sample: SampleLesson) {
    setCopying(sample.id);
    setError(null);
    try {
      const item = await createLibraryItem(sample.spec);
      navigate(`/library/${item.id}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not copy the sample (are you online?)');
      setCopying(null);
    }
  }

  return (
    <div className="page">
      <div className="container cat-page">
        <Link to="/library" className="cat-back">← Lesson library</Link>
        <h1>🧭 Exercise catalogue</h1>
        <p className="text-light cat-intro">
          The building blocks of a mini lesson. Each one comes with a sample lesson — <strong>Try it</strong> to take it
          yourself (nothing is recorded), or copy it into your library to adapt and assign. Claude can use every type
          when it drafts or edits a lesson for you.
        </p>

        <div className="cat-filters" role="tablist" aria-label="Filter by skill">
          <button role="tab" aria-selected={skill === 'all'} className={skill === 'all' ? 'on' : ''} onClick={() => setSkill('all')}>All</button>
          {SKILL_ORDER.map(s => (
            <button key={s} role="tab" aria-selected={skill === s} className={skill === s ? 'on' : ''} onClick={() => setSkill(s)}>
              {SKILL_LABELS[s].icon} {SKILL_LABELS[s].name}
            </button>
          ))}
        </div>

        {error && <ErrorMessage message={error} />}

        {groups.map(g => (
          <section key={g.skill} className="cat-group">
            <h2>{SKILL_LABELS[g.skill].icon} {SKILL_LABELS[g.skill].name}</h2>
            {g.types.map(info => (
              <TypeCard key={info.type} info={info} onCopy={copy} copying={copying !== null} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

/** A sample lesson taken as a trial — the study player with nothing recorded. */
export function CatalogueTrialPage() {
  const { sampleId = '' } = useParams<{ sampleId: string }>();
  const navigate = useNavigate();
  const sample = sampleLesson(sampleId);
  if (!sample) {
    return (
      <div className="page"><div className="container">
        <ErrorMessage message="That sample lesson doesn't exist." />
        <Link to="/library/catalogue">← Exercise catalogue</Link>
      </div></div>
    );
  }
  return (
    <div className="study-page-fullscreen">
      <StudyCustomLesson
        lesson={{ title: sample.spec.title, icon: sample.spec.icon ?? null, spec: sample.spec }}
        trial
        onComplete={() => {}}
        onEnd={() => navigate(`/library/catalogue#type-${sample.type}`)}
      />
    </div>
  );
}
