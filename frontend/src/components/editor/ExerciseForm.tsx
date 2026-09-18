/**
 * One form per exercise type. Each edits a LessonExercise immutably and
 * shows the validator's problems for that exercise inline.
 */

import { useState } from 'react';
import type {
  LessonExercise,
  LessonSentence,
  NoteExercise,
  ScrambleExerciseSpec,
  ChoiceExerciseSpec,
  TranslateExerciseSpec,
  MatchExerciseSpec,
  DescribeImageExerciseSpec,
  SpeakExerciseSpec,
  ListenChoiceExerciseSpec,
  ListenTranslateExerciseSpec,
} from '@shared/lesson';
import { useCachedImageUrl } from '../../hooks/useCachedImageUrl';
import { Field, TextInput, TextArea, HanziInput, SentenceEditor, RowControls, moveItem, toPinyin, Speak } from './fields';

export interface ExerciseTypeInfo {
  type: LessonExercise['type'];
  icon: string;
  name: string;
  description: string;
}

export const EXERCISE_TYPES: ExerciseTypeInfo[] = [
  { type: 'note', icon: '📖', name: 'Note', description: 'Teaching text with example sentences (has audio). Not scored.' },
  { type: 'scramble', icon: '🧩', name: 'Word order', description: 'Arrange tiles into the correct sentence.' },
  { type: 'choice', icon: '🔘', name: 'Multiple choice', description: 'Pick the sentence or word that fits (2–5 options).' },
  { type: 'translate', icon: '✍️', name: 'Translate', description: 'English → Chinese, self-checked against a reference.' },
  { type: 'match', icon: '🔗', name: 'Match pairs', description: 'Connect Chinese words with their meanings (2–8 pairs).' },
  { type: 'describe_image', icon: '🖼', name: 'Describe picture', description: 'An illustration is generated; the learner describes it aloud.' },
  { type: 'speak', icon: '🎤', name: 'Speak', description: 'Say your own sentence out loud, self-assessed.' },
  { type: 'listen_choice', icon: '👂', name: 'Listen & pick', description: 'Audio plays with text hidden; pick what you heard (tones, minimal pairs).' },
  { type: 'listen_translate', icon: '👂', name: 'Listen & translate', description: 'Audio plays hidden; translate what you heard.' },
];

export function defaultExercise(type: LessonExercise['type']): LessonExercise {
  switch (type) {
    case 'note':
      return { type, title: '', body: '', sentences: [{ hanzi: '' }] };
    case 'scramble':
      return { type, english: '', tiles: [], correct_order: [] };
    case 'choice':
      return { type, question: '', options: [{ hanzi: '' }, { hanzi: '' }], correct: 0 };
    case 'translate':
      return { type, english: '', reference_hanzi: '' };
    case 'match':
      return { type, pairs: [{ hanzi: '', english: '' }, { hanzi: '', english: '' }] };
    case 'describe_image':
      return { type, image_prompt: '', reference_hanzi: '' };
    case 'speak':
      return { type, prompt: '' };
    case 'listen_choice':
      return { type, audio: { hanzi: '' }, options: [{ hanzi: '' }, { hanzi: '' }], correct: 0 };
    case 'listen_translate':
      return { type, audio: { hanzi: '', english: '' } };
  }
}

interface FormProps<T> {
  exercise: T;
  onChange: (ex: T) => void;
  speak: Speak;
}

function clean(s: string | undefined): string | undefined {
  return s && s.trim() ? s : undefined;
}

// ---------- Sentence lists ----------

function SentenceList(props: {
  items: LessonSentence[];
  onChange: (items: LessonSentence[]) => void;
  speak: Speak;
  addLabel: string;
  max?: number;
  min?: number;
  englishRequired?: boolean;
  /** Renders a "correct" radio per row. */
  correct?: number;
  onCorrect?: (i: number) => void;
}) {
  const { items, onChange, speak, addLabel, max, min = 0, englishRequired, correct, onCorrect } = props;
  const remove = (i: number) => {
    const next = items.filter((_, j) => j !== i);
    onChange(next);
    if (onCorrect !== undefined && correct !== undefined) {
      if (correct === i) onCorrect(0);
      else if (correct > i) onCorrect(correct - 1);
    }
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    onChange(moveItem(items, from, to));
    if (onCorrect !== undefined && correct !== undefined) {
      if (correct === from) onCorrect(to);
      else if (correct === to) onCorrect(from);
    }
  };
  return (
    <div className="ed-list">
      {items.map((s, i) => (
        <div key={i} className={`ed-list-row ${onCorrect && correct === i ? 'correct' : ''}`}>
          {onCorrect && (
            <label className="ed-correct-radio" title="Correct answer">
              <input type="radio" name={`correct-${addLabel}`} checked={correct === i} onChange={() => onCorrect(i)} />
              <span>✓</span>
            </label>
          )}
          <SentenceEditor
            value={s}
            onChange={v => onChange(items.map((x, j) => (j === i ? v : x)))}
            speak={speak}
            englishRequired={englishRequired}
            compact
          />
          <RowControls index={i} count={items.length} onMove={move} onRemove={() => items.length > min && remove(i)} />
        </div>
      ))}
      {(max === undefined || items.length < max) && (
        <button type="button" className="ed-add-btn" onClick={() => onChange([...items, { hanzi: '' }])}>
          + {addLabel}
        </button>
      )}
    </div>
  );
}

// ---------- Per-type forms ----------

function NoteForm({ exercise, onChange, speak }: FormProps<NoteExercise>) {
  return (
    <>
      <Field label="Title" hint="optional">
        <TextInput value={exercise.title} onChange={v => onChange({ ...exercise, title: clean(v) })} placeholder="e.g. The 把 pattern" />
      </Field>
      <Field label="Teaching text" hint="blank line = new paragraph">
        <TextArea value={exercise.body} onChange={v => onChange({ ...exercise, body: clean(v) })} rows={4} placeholder="Explain the point in a few sentences…" />
      </Field>
      <Field label="Example sentences">
        <SentenceList items={exercise.sentences ?? []} onChange={sentences => onChange({ ...exercise, sentences })} speak={speak} addLabel="Add sentence" />
      </Field>
    </>
  );
}

function ScrambleForm({ exercise, onChange, speak }: FormProps<ScrambleExerciseSpec>) {
  const [orderText, setOrderText] = useState(exercise.correct_order.join(' '));
  const [altText, setAltText] = useState((exercise.alt_orders ?? []).map(a => a.join(' ')).join('\n'));
  const tilesMatch = sameMultiset(exercise.tiles, exercise.correct_order);

  function applyOrder(text: string) {
    setOrderText(text);
    const order = text.split(/[\s|/]+/).map(t => t.trim()).filter(Boolean);
    // Tiles follow the correct order unless the author has hand-edited them
    // into a different multiset (then only "Reset tiles" touches them).
    const tiles = tilesMatch || exercise.tiles.length === 0 ? order : exercise.tiles;
    onChange({ ...exercise, correct_order: order, tiles });
  }
  function applyAlt(text: string) {
    setAltText(text);
    const alt = text.split('\n').map(l => l.split(/[\s|/]+/).map(t => t.trim()).filter(Boolean)).filter(a => a.length > 0);
    onChange({ ...exercise, alt_orders: alt.length ? alt : undefined });
  }

  return (
    <>
      <Field label="English meaning">
        <TextInput value={exercise.english} onChange={v => onChange({ ...exercise, english: v })} placeholder="I want a cup of coffee" />
      </Field>
      <Field label="Correct order" hint="separate tiles with spaces">
        <div className="ed-hanzi-row">
          <input className="ed-input" lang="zh-CN" value={orderText} onChange={e => applyOrder(e.target.value)} placeholder="我 要 一杯 咖啡" />
          <button type="button" className="ed-mini-btn" onClick={() => speak(exercise.correct_order.join(''))} disabled={exercise.correct_order.length === 0} aria-label="Play">🔊</button>
        </div>
      </Field>
      <div className="ed-tiles">
        {exercise.tiles.map((t, i) => <span key={i} className="ed-tile">{t}</span>)}
        {exercise.tiles.length === 0 && <span className="ed-hint">No tiles yet — type the correct order above.</span>}
        {!tilesMatch && exercise.tiles.length > 0 && (
          <button type="button" className="ed-mini-btn text" onClick={() => onChange({ ...exercise, tiles: exercise.correct_order })}>
            Reset tiles from correct order
          </button>
        )}
      </div>
      <Field label="Other accepted orders" hint="optional, one per line">
        <TextArea value={altText} onChange={applyAlt} rows={2} placeholder="我 要 咖啡 一杯" />
      </Field>
    </>
  );
}

function sameMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const t of a) counts.set(t, (counts.get(t) ?? 0) + 1);
  for (const t of b) {
    const n = counts.get(t);
    if (!n) return false;
    counts.set(t, n - 1);
  }
  return true;
}

function ChoiceForm({ exercise, onChange, speak }: FormProps<ChoiceExerciseSpec>) {
  return (
    <>
      <Field label="Question or situation">
        <TextInput value={exercise.question} onChange={v => onChange({ ...exercise, question: v })} placeholder="Your friend looks tired. What do you say?" />
      </Field>
      <Field label="Options" hint="tick the correct one">
        <SentenceList
          items={exercise.options}
          onChange={options => onChange({ ...exercise, options })}
          speak={speak}
          addLabel="Add option"
          max={5}
          min={2}
          correct={exercise.correct}
          onCorrect={correct => onChange({ ...exercise, correct })}
        />
      </Field>
      <Field label="Explanation" hint="shown after answering">
        <TextInput value={exercise.explanation} onChange={v => onChange({ ...exercise, explanation: clean(v) })} />
      </Field>
    </>
  );
}

function TranslateForm({ exercise, onChange, speak }: FormProps<TranslateExerciseSpec>) {
  return (
    <>
      <Field label="English to translate">
        <TextInput value={exercise.english} onChange={v => onChange({ ...exercise, english: v })} placeholder="Two coffees, please" />
      </Field>
      <Field label="Reference answer (Chinese)">
        <HanziInput value={exercise.reference_hanzi} onChange={v => onChange({ ...exercise, reference_hanzi: v })} onPinyin={py => onChange({ ...exercise, reference_pinyin: py })} speak={speak} />
      </Field>
      <Field label="Reference pinyin">
        <TextInput value={exercise.reference_pinyin} onChange={v => onChange({ ...exercise, reference_pinyin: clean(v) })} placeholder="qǐng gěi wǒ liǎng bēi kāfēi" />
      </Field>
      <Field label="Note" hint="optional guidance shown with the answer">
        <TextInput value={exercise.note} onChange={v => onChange({ ...exercise, note: clean(v) })} placeholder="Different wording is fine" />
      </Field>
    </>
  );
}

function MatchForm({ exercise, onChange, speak }: FormProps<MatchExerciseSpec>) {
  const pairs = exercise.pairs;
  const set = (i: number, patch: Partial<MatchExerciseSpec['pairs'][number]>) =>
    onChange({ ...exercise, pairs: pairs.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  return (
    <Field label="Pairs" hint="2–8, no duplicates">
      <div className="ed-pairs">
        {pairs.map((p, i) => (
          <div key={i} className="ed-pair-row">
            <HanziInput value={p.hanzi} onChange={v => set(i, { hanzi: v })} onPinyin={py => set(i, { pinyin: py })} speak={speak} placeholder="汉字" />
            <input className="ed-input" value={p.pinyin ?? ''} onChange={e => set(i, { pinyin: e.target.value || undefined })} placeholder="pinyin" />
            <input className="ed-input" value={p.english} onChange={e => set(i, { english: e.target.value })} placeholder="meaning" />
            <RowControls
              index={i}
              count={pairs.length}
              onMove={(from, to) => onChange({ ...exercise, pairs: moveItem(pairs, from, to) })}
              onRemove={() => pairs.length > 2 && onChange({ ...exercise, pairs: pairs.filter((_, j) => j !== i) })}
            />
          </div>
        ))}
        {pairs.length < 8 && (
          <button type="button" className="ed-add-btn" onClick={() => onChange({ ...exercise, pairs: [...pairs, { hanzi: '', english: '' }] })}>
            + Add pair
          </button>
        )}
      </div>
    </Field>
  );
}

function DescribeImageForm({ exercise, onChange, speak }: FormProps<DescribeImageExerciseSpec>) {
  const imageUrl = useCachedImageUrl(exercise.image_url ?? null);
  return (
    <>
      {imageUrl && (
        <div className="ed-image-preview">
          <img src={imageUrl} alt="Generated illustration" />
          <span className="ed-hint">Changing the scene description generates a new picture on save.</span>
        </div>
      )}
      <Field label="Scene for the illustration" hint="English, detailed, no text in the image">
        <TextArea value={exercise.image_prompt} onChange={v => onChange({ ...exercise, image_prompt: v })} rows={3} placeholder="A woman ordering coffee at a busy café counter, morning light…" />
      </Field>
      <Field label="Task" hint="optional">
        <TextInput value={exercise.task} onChange={v => onChange({ ...exercise, task: clean(v) })} placeholder="Describe what the woman is doing." />
      </Field>
      <Field label="Reference description (Chinese)">
        <HanziInput value={exercise.reference_hanzi} onChange={v => onChange({ ...exercise, reference_hanzi: v })} onPinyin={py => onChange({ ...exercise, reference_pinyin: py })} speak={speak} />
      </Field>
      <Field label="Reference pinyin">
        <TextInput value={exercise.reference_pinyin} onChange={v => onChange({ ...exercise, reference_pinyin: clean(v) })} />
      </Field>
      <Field label="Reference English">
        <TextInput value={exercise.reference_english} onChange={v => onChange({ ...exercise, reference_english: clean(v) })} />
      </Field>
    </>
  );
}

function SpeakForm({ exercise, onChange, speak }: FormProps<SpeakExerciseSpec>) {
  const example = exercise.example;
  return (
    <>
      <Field label="What to say">
        <TextInput value={exercise.prompt} onChange={v => onChange({ ...exercise, prompt: v })} placeholder="Order two coffees, one iced." />
      </Field>
      <Field label="Example answer" hint="optional, shown afterwards">
        {example ? (
          <div className="ed-list-row">
            <SentenceEditor value={example} onChange={v => onChange({ ...exercise, example: v })} speak={speak} compact />
            <button type="button" className="ed-mini-btn danger" onClick={() => onChange({ ...exercise, example: undefined })} aria-label="Remove example">✕</button>
          </div>
        ) : (
          <button type="button" className="ed-add-btn" onClick={() => onChange({ ...exercise, example: { hanzi: '' } })}>+ Add example</button>
        )}
      </Field>
    </>
  );
}

function ListenChoiceForm({ exercise, onChange, speak }: FormProps<ListenChoiceExerciseSpec>) {
  return (
    <>
      <Field label="What is played" hint="hidden until answered">
        <SentenceEditor value={exercise.audio} onChange={audio => onChange({ ...exercise, audio })} speak={speak} />
      </Field>
      <Field label="Question" hint="optional">
        <TextInput value={exercise.question} onChange={v => onChange({ ...exercise, question: clean(v) })} placeholder="Which word did you hear?" />
      </Field>
      <Field label="Options" hint="tick the correct one">
        <SentenceList
          items={exercise.options}
          onChange={options => onChange({ ...exercise, options })}
          speak={speak}
          addLabel="Add option "
          max={5}
          min={2}
          correct={exercise.correct}
          onCorrect={correct => onChange({ ...exercise, correct })}
        />
      </Field>
      <Field label="Explanation" hint="shown after answering">
        <TextInput value={exercise.explanation} onChange={v => onChange({ ...exercise, explanation: clean(v) })} />
      </Field>
    </>
  );
}

function ListenTranslateForm({ exercise, onChange, speak }: FormProps<ListenTranslateExerciseSpec>) {
  return (
    <>
      <Field label="What is played" hint="English is the answer (required)">
        <SentenceEditor value={exercise.audio} onChange={audio => onChange({ ...exercise, audio })} speak={speak} englishRequired />
      </Field>
      <Field label="Note" hint="optional guidance shown with the answer">
        <TextInput value={exercise.note} onChange={v => onChange({ ...exercise, note: clean(v) })} />
      </Field>
    </>
  );
}

export function ExerciseForm(props: { exercise: LessonExercise; onChange: (ex: LessonExercise) => void; speak: Speak; errors: string[] }) {
  const { exercise, onChange, speak, errors } = props;
  let form: JSX.Element;
  switch (exercise.type) {
    case 'note':
      form = <NoteForm exercise={exercise} onChange={onChange} speak={speak} />;
      break;
    case 'scramble':
      form = <ScrambleForm exercise={exercise} onChange={onChange} speak={speak} />;
      break;
    case 'choice':
      form = <ChoiceForm exercise={exercise} onChange={onChange} speak={speak} />;
      break;
    case 'translate':
      form = <TranslateForm exercise={exercise} onChange={onChange} speak={speak} />;
      break;
    case 'match':
      form = <MatchForm exercise={exercise} onChange={onChange} speak={speak} />;
      break;
    case 'describe_image':
      form = <DescribeImageForm exercise={exercise} onChange={onChange} speak={speak} />;
      break;
    case 'speak':
      form = <SpeakForm exercise={exercise} onChange={onChange} speak={speak} />;
      break;
    case 'listen_choice':
      form = <ListenChoiceForm exercise={exercise} onChange={onChange} speak={speak} />;
      break;
    case 'listen_translate':
      form = <ListenTranslateForm exercise={exercise} onChange={onChange} speak={speak} />;
      break;
  }
  return (
    <div className="ed-exercise-form">
      {form}
      {errors.length > 0 && (
        <ul className="ed-errors">
          {errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
    </div>
  );
}

/** Pinyin for every hanzi field of an exercise that has none yet. */
export function fillMissingPinyin(ex: LessonExercise): LessonExercise {
  const fillSentence = (s: LessonSentence): LessonSentence => (s.pinyin || !s.hanzi.trim() ? s : { ...s, pinyin: toPinyin(s.hanzi) });
  switch (ex.type) {
    case 'note':
      return { ...ex, sentences: ex.sentences?.map(fillSentence) };
    case 'choice':
      return { ...ex, options: ex.options.map(fillSentence) };
    case 'translate':
      return ex.reference_pinyin || !ex.reference_hanzi.trim() ? ex : { ...ex, reference_pinyin: toPinyin(ex.reference_hanzi) };
    case 'match':
      return { ...ex, pairs: ex.pairs.map(p => (p.pinyin || !p.hanzi.trim() ? p : { ...p, pinyin: toPinyin(p.hanzi) })) };
    case 'describe_image':
      return ex.reference_pinyin || !ex.reference_hanzi.trim() ? ex : { ...ex, reference_pinyin: toPinyin(ex.reference_hanzi) };
    case 'speak':
      return ex.example ? { ...ex, example: fillSentence(ex.example) } : ex;
    case 'listen_choice':
      return { ...ex, audio: fillSentence(ex.audio), options: ex.options.map(fillSentence) };
    case 'listen_translate':
      return { ...ex, audio: fillSentence(ex.audio) };
    default:
      return ex;
  }
}
