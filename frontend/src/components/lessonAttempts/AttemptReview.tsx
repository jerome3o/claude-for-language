/**
 * One lesson attempt, exercise by exercise: what was asked, what the
 * learner answered (typed text with wrong characters marked, chosen options,
 * handwriting re-drawn, recordings playable with their transcript, Claude's
 * sentence feedback, conversation answers), whether it was right, and the
 * time spent — per exercise and per section. Read-only; used by the tutor's
 * review page and the learner's own "My answers".
 */

import {
  diffHanzi,
  exerciseTypeInfo,
  formatDuration,
  sectionTimes,
  type ExerciseAttempt,
  type LessonExercise,
  type LessonSentence,
} from '@shared/lesson';
import type { AttemptDetail, AttemptMedia } from '../../api/lessonPractice';
import { StrokesView } from '../handwriting/StrokesView';
import { StrokeRunView } from './StrokeRunView';
import { RecordingButton } from '../../pages/tutor/tutor-shared';
import './attempts.css';

const RATING = ['Again', 'Hard', 'Good', 'Easy'];

function Sentence({ s }: { s: LessonSentence }) {
  return (
    <span className="att-sentence">
      <span lang="zh-CN">{s.hanzi}</span>
      {s.pinyin && <span className="att-pinyin"> {s.pinyin}</span>}
      {s.english && <span className="att-english"> — {s.english}</span>}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="att-row">
      <span className="att-row-label">{label}</span>
      <span className="att-row-value">{children}</span>
    </div>
  );
}

function TypedDiff({ text, expected, alternatives }: { text: string | undefined; expected: string; alternatives?: string[] }) {
  if (!text) return <Row label="Answered">(nothing typed)</Row>;
  const d = diffHanzi(text, expected, alternatives);
  return (
    <>
      <Row label="Typed">
        <span className="att-chars" lang="zh-CN">
          {d.typed.map((m, i) => <span key={i} className={m.hit ? 'hit' : 'extra'}>{m.ch}</span>)}
        </span>
      </Row>
      {!d.correct && (
        <Row label="Answer">
          <span className="att-chars" lang="zh-CN">
            {d.expected.map((m, i) => <span key={i} className={m.hit ? 'hit' : 'miss'}>{m.ch}</span>)}
          </span>
        </Row>
      )}
    </>
  );
}

function Verdict({ attempt }: { attempt: ExerciseAttempt }) {
  if (attempt.correct === null) return <span className="att-verdict neutral">not scored</span>;
  const self = attempt.answer?.self_assessed;
  const pts = attempt.max_points > 1 ? ` ${attempt.points}/${attempt.max_points}` : '';
  return (
    <span className={`att-verdict ${attempt.correct ? 'ok' : 'bad'}`}>
      {attempt.correct ? '✓' : '✗'}{pts}{self ? ' · self-assessed' : ''}
    </span>
  );
}

function AnswerBody({ exercise, attempt, media }: { exercise: LessonExercise | undefined; attempt: ExerciseAttempt; media: AttemptMedia | undefined }) {
  const a = attempt.answer ?? {};
  if (!exercise) return <p className="att-muted">This exercise is no longer in the lesson.</p>;
  switch (exercise.type) {
    case 'note':
      return <p className="att-muted">{exercise.title || 'Teaching note'} — read.</p>;
    case 'scramble':
      return (
        <>
          <Row label="Task">{exercise.english}</Row>
          <Row label="Built">{a.order?.length ? a.order.join(' ') : '—'}</Row>
          {!attempt.correct && <Row label="Answer">{exercise.correct_order.join(' ')}</Row>}
          {a.hint_used && <Row label="Hint">looked at the English</Row>}
        </>
      );
    case 'choice':
    case 'listen_choice': {
      const chosen = a.choice !== undefined ? exercise.options[a.choice] : undefined;
      return (
        <>
          {exercise.type === 'choice' ? <Row label="Question">{exercise.question}</Row> : <Row label="Played"><Sentence s={exercise.audio} /></Row>}
          <Row label="Picked">{chosen ? <Sentence s={chosen} /> : '—'}</Row>
          {!attempt.correct && <Row label="Answer"><Sentence s={exercise.options[exercise.correct]} /></Row>}
          {a.plays !== undefined && <Row label="Listened">{a.plays}×</Row>}
        </>
      );
    }
    case 'translate':
      return (
        <>
          <Row label="English">{exercise.english}</Row>
          <Row label="Typed">{a.text ? <span lang="zh-CN">{a.text}</span> : '(said it / no text)'}</Row>
          <Row label="Reference"><span lang="zh-CN">{exercise.reference_hanzi}</span></Row>
        </>
      );
    case 'listen_translate':
      return (
        <>
          <Row label="Played"><Sentence s={exercise.audio} /></Row>
          <Row label="Their answer">{a.text || '(in their head)'}</Row>
          {a.plays !== undefined && <Row label="Listened">{a.plays}×</Row>}
        </>
      );
    case 'match':
      return <Row label="Wrong taps">{a.mistakes ?? 0}</Row>;
    case 'describe_image':
      return <Row label="Reference"><span lang="zh-CN">{exercise.reference_hanzi}</span></Row>;
    case 'speak':
      return <Row label="Prompt">{exercise.prompt}</Row>;
    case 'sentence_making':
      return (
        <>
          <Row label="Words"><span lang="zh-CN">{exercise.words.map(w => w.hanzi).join('、')}</span></Row>
          {exercise.task && <Row label="Task">{exercise.task}</Row>}
          {a.text && <Row label="Wrote"><span lang="zh-CN" className="att-big">{a.text}</span></Row>}
          {a.handwriting?.strokes && <StrokesView strokes={a.handwriting.strokes} label="Handwritten" maxHeight={120} />}
          {a.feedback && (
            <div className={`att-feedback ${a.feedback.verdict}`}>
              <strong>Claude: {a.feedback.verdict === 'correct' ? 'correct' : a.feedback.verdict === 'minor' ? 'almost' : 'not quite'}</strong>
              {!a.feedback.uses_all_words && ' · missed a target word'}
              {a.feedback.corrected && <div><Sentence s={a.feedback.corrected} /></div>}
              <div>{a.feedback.comment}</div>
            </div>
          )}
        </>
      );
    case 'write_typed':
      return (
        <>
          <Row label="Cue">{exercise.answer.english || exercise.answer.pinyin || '🔊'}</Row>
          <TypedDiff text={a.text} expected={exercise.answer.hanzi} alternatives={exercise.alternatives} />
        </>
      );
    case 'write_handwriting':
      return (
        <>
          <Row label="Cue">{exercise.answer.english || exercise.answer.pinyin || '🔊'}</Row>
          {a.handwriting?.writing ? <StrokeRunView run={a.handwriting.writing} /> : <div className="att-hw">
            {a.handwriting?.strokes ? <StrokesView strokes={a.handwriting.strokes} label="Wrote" maxHeight={120} /> : <span className="att-muted">(nothing)</span>}
            <span className="att-model" lang="zh-CN">{exercise.answer.hanzi}</span>
          </div>}
        </>
      );
    case 'dictation':
      return (
        <>
          <Row label="Played"><Sentence s={exercise.audio} /></Row>
          {exercise.input === 'handwrite' && a.handwriting?.writing ? (
            <StrokeRunView run={a.handwriting.writing} />
          ) : exercise.input === 'handwrite' ? (
            <div className="att-hw">
              {a.handwriting?.strokes ? <StrokesView strokes={a.handwriting.strokes} label="Wrote" maxHeight={120} /> : <span className="att-muted">(nothing)</span>}
              <span className="att-model" lang="zh-CN">{exercise.audio.hanzi}</span>
            </div>
          ) : (
            <TypedDiff text={a.text} expected={exercise.audio.hanzi} alternatives={exercise.alternatives} />
          )}
          {a.plays !== undefined && <Row label="Listened">{a.plays}×</Row>}
        </>
      );
    case 'oral_expression':
      return (
        <>
          <Row label="Prompt">{exercise.prompt}</Row>
          {media ? (
            <div className="att-recording">
              <RecordingButton url={media.audio_key} />
              <span className="att-muted">{a.recording ? formatDuration(a.recording.duration_ms) : ''}</span>
            </div>
          ) : a.recording ? (
            <p className="att-muted">Recording made — it uploads the next time their device syncs.</p>
          ) : (
            <p className="att-muted">No recording (said it without recording).</p>
          )}
          {media?.transcript && (
            <div className="att-transcript">
              <span lang="zh-CN">{media.transcript}</span>
              {media.transcript_translation && <span className="att-english"> — {media.transcript_translation}</span>}
            </div>
          )}
          {media && media.transcript_status === 'pending' && <p className="att-muted">Transcribing…</p>}
        </>
      );
    case 'conversation':
      return (
        <>
          <Row label="Situation">{exercise.situation}</Row>
          {a.plays !== undefined && <Row label="Listened">{a.plays}× {a.hint_used ? '· read the transcript' : ''}</Row>}
          <ol className="att-questions">
            {exercise.questions.map((q, i) => {
              const qa = a.questions?.[i];
              const picked = qa?.choice !== undefined && q.options ? q.options[qa.choice] : qa?.text;
              return (
                <li key={i} className={qa?.correct === true ? 'ok' : qa?.correct === false ? 'bad' : ''}>
                  <div>{q.question}</div>
                  <div className="att-q-answer">
                    {qa?.correct === true ? '✓ ' : qa?.correct === false ? '✗ ' : ''}{picked || '—'}
                    {qa?.correct === false && q.options && typeof q.correct === 'number' && (
                      <span className="att-muted"> (answer: {q.options[q.correct]})</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      );
  }
}

export function AttemptReview({ attempt }: { attempt: AttemptDetail }) {
  const { spec, data } = attempt;
  const sections = sectionTimes(data);
  const mediaByKey = new Map(attempt.media.map(m => [m.media_key, m]));
  const bySection = new Map<number, ExerciseAttempt[]>();
  for (const ex of data.exercises) {
    const list = bySection.get(ex.section) ?? [];
    list.push(ex);
    bySection.set(ex.section, list);
  }
  const longest = Math.max(1, ...sections.map(s => s.duration_ms));

  return (
    <div className="att-review">
      <div className="att-summary">
        <div className="att-stat"><span className="att-stat-num">{attempt.total ? `${attempt.correct}/${attempt.total}` : '—'}</span><span>score</span></div>
        <div className="att-stat"><span className="att-stat-num">{formatDuration(attempt.duration_ms)}</span><span>total time</span></div>
        <div className="att-stat"><span className="att-stat-num">{attempt.rating !== null ? RATING[attempt.rating] : '—'}</span><span>their rating</span></div>
      </div>

      {sections.length > 1 && (
        <div className="att-sections">
          {sections.map(s => (
            <div key={s.section} className="att-section-bar">
              <span className="att-section-name">{spec.sections[s.section]?.title || `Section ${s.section + 1}`}</span>
              <span className="att-bar"><span style={{ width: `${(s.duration_ms / longest) * 100}%` }} /></span>
              <span className="att-section-time">{formatDuration(s.duration_ms)}{s.scored ? ` · ${s.correct}/${s.scored}` : ''}</span>
            </div>
          ))}
        </div>
      )}

      {[...bySection.entries()].sort((a, b) => a[0] - b[0]).map(([si, list]) => (
        <section key={si} className="att-section">
          {spec.sections[si]?.title && <h2>{spec.sections[si].title}</h2>}
          {list.map(ex => {
            const exercise = spec.sections[ex.section]?.exercises[ex.index];
            const info = exerciseTypeInfo(ex.type);
            const media = ex.answer?.recording ? mediaByKey.get(ex.answer.recording.media_key) : undefined;
            return (
              <article key={`${ex.section}-${ex.index}`} className={`att-card ${ex.correct === false ? 'bad' : ex.correct ? 'ok' : ''}`}>
                <div className="att-card-head">
                  <span className="att-type">{info?.icon} {info?.name ?? ex.type}</span>
                  <Verdict attempt={ex} />
                  <span className="att-time">⏱ {formatDuration(ex.duration_ms)}</span>
                </div>
                <AnswerBody exercise={exercise} attempt={ex} media={media} />
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}
