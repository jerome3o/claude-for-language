/**
 * Print view: minimal chrome, numbered exercises, answer key at the end,
 * @media print styles. Reached from the editor (which passes its current,
 * possibly unsaved spec via location.state) or from a library card.
 *
 * Routes: /library/:id/print, /lessons/:id/print
 */

import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { CustomLessonSpec, LessonExercise } from '@shared/lesson';
import { getEditableLesson, getLibraryItem } from '../../api/lessonEditor';
import type { EditorTargetType } from '../../types/lessonEditor';
import { Loading, ErrorMessage } from '../../components/Loading';
import './LessonPrintPage.css';

function letter(i: number): string {
  return String.fromCharCode(65 + i);
}

function Sentence({ hanzi, pinyin, english }: { hanzi: string; pinyin?: string; english?: string }) {
  return (
    <span className="pr-sentence">
      <span className="pr-hanzi">{hanzi}</span>
      {pinyin && <span className="pr-pinyin">{pinyin}</span>}
      {english && <span className="pr-english">{english}</span>}
    </span>
  );
}

function Body({ ex }: { ex: LessonExercise }) {
  switch (ex.type) {
    case 'note':
      return (
        <div className="pr-note">
          {ex.title && <div className="pr-note-title">{ex.title}</div>}
          {ex.body && ex.body.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
          {ex.sentences?.map((s, i) => <div key={i} className="pr-line"><Sentence {...s} /></div>)}
        </div>
      );
    case 'scramble':
      return (
        <>
          <div className="pr-instr">Arrange the tiles into a sentence meaning: <em>{ex.english}</em></div>
          <div className="pr-tiles">{ex.tiles.map((t, i) => <span key={i} className="pr-tile">{t}</span>)}</div>
          <div className="pr-answerline" />
        </>
      );
    case 'choice':
      return (
        <>
          <div className="pr-instr">{ex.question}</div>
          <ol className="pr-options" type="A">{ex.options.map((o, i) => <li key={i}><Sentence hanzi={o.hanzi} pinyin={o.pinyin} /></li>)}</ol>
        </>
      );
    case 'translate':
      return (
        <>
          <div className="pr-instr">Translate into Chinese: <em>{ex.english}</em></div>
          {ex.note && <div className="pr-hint">{ex.note}</div>}
          <div className="pr-answerline" />
        </>
      );
    case 'match': {
      const english = [...ex.pairs.map(p => p.english)].sort();
      return (
        <>
          <div className="pr-instr">Match each word with its meaning.</div>
          <table className="pr-match">
            <tbody>
              {ex.pairs.map((p, i) => (
                <tr key={i}><td>{p.hanzi}</td><td className="pr-match-gap" /><td>{english[i]}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      );
    }
    case 'describe_image':
      return (
        <>
          <div className="pr-instr">{ex.task || 'Describe the picture, in Chinese.'}</div>
          <div className="pr-hint">Scene: {ex.image_prompt}</div>
          <div className="pr-answerline" /><div className="pr-answerline" />
        </>
      );
    case 'speak':
      return <div className="pr-instr">Say it out loud: <em>{ex.prompt}</em></div>;
    case 'listen_choice':
      return (
        <>
          <div className="pr-instr">{ex.question || 'Which one did you hear?'} <span className="pr-hint">(teacher reads the sentence aloud)</span></div>
          <ol className="pr-options" type="A">{ex.options.map((o, i) => <li key={i}>{o.hanzi}</li>)}</ol>
        </>
      );
    case 'listen_translate':
      return (
        <>
          <div className="pr-instr">Listen and translate into English. <span className="pr-hint">(teacher reads the sentence aloud)</span></div>
          <div className="pr-answerline" />
        </>
      );
    case 'sentence_making':
      return (
        <>
          <div className="pr-instr">{ex.task || 'Make your own sentence using these words.'}{ex.input === 'handwrite' ? ' (write it by hand)' : ''}</div>
          <div className="pr-tiles">{ex.words.map((w, i) => <span key={i} className="pr-tile">{w.hanzi}{w.pinyin ? ` ${w.pinyin}` : ''}</span>)}</div>
          <div className="pr-answerline" /><div className="pr-answerline" />
        </>
      );
    case 'write_typed':
    case 'write_handwriting': {
      const cues = ex.cues ?? ['english', 'pinyin'];
      return (
        <>
          <div className="pr-instr">
            {ex.prompt || 'Write it in characters'}
            {cues.includes('english') && ex.answer.english ? <>: <em>{ex.answer.english}</em></> : null}
            {cues.includes('pinyin') && ex.answer.pinyin ? <> — {ex.answer.pinyin}</> : null}
            {cues.includes('audio') ? <span className="pr-hint"> (teacher reads it aloud)</span> : null}
          </div>
          <div className="pr-answerline" />
        </>
      );
    }
    case 'dictation':
      return (
        <>
          <div className="pr-instr">Dictation: write down what you hear. <span className="pr-hint">(teacher reads the sentence aloud)</span></div>
          <div className="pr-answerline" />
        </>
      );
    case 'oral_expression':
      return (
        <>
          <div className="pr-instr">Speak: <em>{ex.prompt}</em>{ex.question_audio ? <> — {ex.question_audio.hanzi}</> : null}</div>
          {ex.hints?.length ? <div className="pr-hint">Useful words: {ex.hints.map(w => w.hanzi).join('、')}</div> : null}
        </>
      );
    case 'conversation':
      return (
        <>
          <div className="pr-instr">Conversation — {ex.situation}. Listen, then answer. <span className="pr-hint">(teacher reads the dialogue aloud)</span></div>
          <ol className="pr-options">
            {ex.questions.map((q, i) => (
              <li key={i}>
                {q.question}
                {q.options ? <ol type="A">{q.options.map((o, j) => <li key={j}>{o}</li>)}</ol> : <div className="pr-answerline" />}
              </li>
            ))}
          </ol>
        </>
      );
  }
}

function answer(ex: LessonExercise): React.ReactNode {
  switch (ex.type) {
    case 'scramble':
      return <>{ex.correct_order.join('')}{ex.alt_orders?.length ? ` (also: ${ex.alt_orders.map(a => a.join('')).join(' / ')})` : ''}</>;
    case 'choice': {
      const o = ex.options[ex.correct];
      return <>{letter(ex.correct)}. {o?.hanzi}{o?.english ? ` — ${o.english}` : ''}{ex.explanation ? ` (${ex.explanation})` : ''}</>;
    }
    case 'translate':
      return <>{ex.reference_hanzi}{ex.reference_pinyin ? ` (${ex.reference_pinyin})` : ''}</>;
    case 'match':
      return <>{ex.pairs.map(p => `${p.hanzi} = ${p.english}`).join('; ')}</>;
    case 'describe_image':
      return <>{ex.reference_hanzi}{ex.reference_pinyin ? ` (${ex.reference_pinyin})` : ''}{ex.reference_english ? ` — ${ex.reference_english}` : ''}</>;
    case 'speak':
      return ex.example ? <>e.g. {ex.example.hanzi}{ex.example.english ? ` — ${ex.example.english}` : ''}</> : null;
    case 'listen_choice': {
      const o = ex.options[ex.correct];
      return <>Read: {ex.audio.hanzi}{ex.audio.pinyin ? ` (${ex.audio.pinyin})` : ''}. Answer: {letter(ex.correct)}. {o?.hanzi}{ex.explanation ? ` (${ex.explanation})` : ''}</>;
    }
    case 'listen_translate':
      return <>Read: {ex.audio.hanzi}{ex.audio.pinyin ? ` (${ex.audio.pinyin})` : ''}. Answer: {ex.audio.english}</>;
    case 'sentence_making':
    case 'oral_expression':
      return ex.example ? <>e.g. {ex.example.hanzi}{ex.example.english ? ` — ${ex.example.english}` : ''}</> : null;
    case 'write_typed':
    case 'write_handwriting':
      return <>{ex.answer.hanzi}{ex.answer.pinyin ? ` (${ex.answer.pinyin})` : ''}</>;
    case 'dictation':
      return <>Read: {ex.audio.hanzi}{ex.audio.pinyin ? ` (${ex.audio.pinyin})` : ''}</>;
    case 'conversation':
      return (
        <>
          Read: {ex.lines.map(l => `${ex.speakers[l.speaker]?.name ?? ''}: ${l.hanzi}`).join(' / ')}.{' '}
          Answers: {ex.questions.map((q, i) => `${i + 1}) ${q.options && typeof q.correct === 'number' ? `${letter(q.correct)}. ${q.options[q.correct] ?? ''}` : q.answer ?? ''}`).join('; ')}
        </>
      );
    default:
      return null;
  }
}

export function PrintableLesson({ spec }: { spec: CustomLessonSpec }) {
  let n = 0;
  const numbered = spec.sections.map(section => ({
    title: section.title,
    exercises: section.exercises.map(ex => ({ ex, n: ex.type === 'note' ? 0 : ++n })),
  }));
  const key = numbered.flatMap(s => s.exercises).filter(e => e.n > 0).map(e => ({ n: e.n, a: answer(e.ex) })).filter(e => e.a);

  return (
    <article className="pr-lesson">
      <h1>{spec.icon ? `${spec.icon} ` : ''}{spec.title}</h1>
      {spec.description && <p className="pr-desc">{spec.description}</p>}
      {numbered.map((section, si) => (
        <section key={si}>
          {section.title && <h2>{section.title}</h2>}
          {section.exercises.map(({ ex, n }, ei) => (
            <div key={ei} className={`pr-exercise ${ex.type === 'note' ? 'note' : ''}`}>
              {n > 0 && <div className="pr-num">{n}.</div>}
              <div className="pr-body"><Body ex={ex} /></div>
            </div>
          ))}
        </section>
      ))}
      {key.length > 0 && (
        <section className="pr-key">
          <h2>Answer key</h2>
          <ol>{key.map(k => <li key={k.n} value={k.n}>{k.a}</li>)}</ol>
        </section>
      )}
    </article>
  );
}

export function LessonPrintPage({ target }: { target: EditorTargetType }) {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const passed = (location.state as { spec?: CustomLessonSpec } | null)?.spec ?? null;

  const query = useQuery({
    queryKey: [target === 'library' ? 'library-item' : 'editable-lesson', id],
    queryFn: async (): Promise<{ spec: CustomLessonSpec }> =>
      target === 'library' ? { spec: (await getLibraryItem(id)).spec } : { spec: (await getEditableLesson(id)).spec },
    enabled: !passed,
    retry: 1,
  });
  const spec = passed ?? query.data?.spec ?? null;

  if (!spec && query.isLoading) return <Loading message="Loading lesson…" />;
  if (!spec) return <div className="page"><div className="container"><ErrorMessage message="Lesson not found" /></div></div>;

  return (
    <div className="pr-page">
      <div className="pr-toolbar no-print">
        <button className="btn btn-secondary" onClick={() => navigate(-1)}>← Back</button>
        {passed && <span className="pr-toolbar-note">Showing the editor's current (unsaved) version.</span>}
        <button className="btn btn-primary" onClick={() => window.print()}>🖨 Print</button>
      </div>
      <PrintableLesson spec={spec} />
    </div>
  );
}
