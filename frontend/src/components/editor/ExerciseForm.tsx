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
  SentenceMakingExerciseSpec,
  WriteTypedExerciseSpec,
  WriteHandwritingExerciseSpec,
  DictationExerciseSpec,
  OralExpressionExerciseSpec,
  ConversationExerciseSpec,
  LessonWord,
  WritingCue,
  WritingInput,
} from '@shared/lesson';
import { EXERCISE_TYPE_LIST, defaultExercise as sharedDefaultExercise } from '@shared/lesson';
import { useCachedImageUrl } from '../../hooks/useCachedImageUrl';
import { Field, TextInput, TextArea, HanziInput, SentenceEditor, RowControls, moveItem, toPinyin, Speak } from './fields';

export interface ExerciseTypeInfo {
  type: LessonExercise['type'];
  icon: string;
  name: string;
  description: string;
}

export const EXERCISE_TYPES: ExerciseTypeInfo[] = EXERCISE_TYPE_LIST.map(info => ({
  type: info.type,
  icon: info.icon,
  name: info.name,
  description: info.summary,
}));

export function defaultExercise(type: LessonExercise['type']): LessonExercise {
  return sharedDefaultExercise(type);
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

// ---------- Practice types ----------

function InputModeToggle({ value, onChange }: { value: WritingInput | undefined; onChange: (v: WritingInput) => void }) {
  const mode = value ?? 'type';
  return (
    <div className="ed-seg" role="radiogroup" aria-label="How the learner writes">
      <button type="button" role="radio" aria-checked={mode === 'type'} className={mode === 'type' ? 'on' : ''} onClick={() => onChange('type')}>⌨️ Typed</button>
      <button type="button" role="radio" aria-checked={mode === 'handwrite'} className={mode === 'handwrite' ? 'on' : ''} onClick={() => onChange('handwrite')}>✍️ Handwritten</button>
    </div>
  );
}

function WordList(props: { items: LessonWord[]; onChange: (items: LessonWord[]) => void; speak: Speak; addLabel: string; max: number; min?: number }) {
  const { items, onChange, speak, addLabel, max, min = 0 } = props;
  const set = (i: number, patch: Partial<LessonWord>) => onChange(items.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  return (
    <div className="ed-pairs">
      {items.map((w, i) => (
        <div key={i} className="ed-pair-row">
          <HanziInput value={w.hanzi} onChange={v => set(i, { hanzi: v })} onPinyin={py => set(i, { pinyin: py })} speak={speak} placeholder="词语" />
          <input className="ed-input" value={w.pinyin ?? ''} onChange={e => set(i, { pinyin: e.target.value || undefined })} placeholder="pinyin" />
          <input className="ed-input" value={w.english ?? ''} onChange={e => set(i, { english: e.target.value || undefined })} placeholder="meaning" />
          <RowControls
            index={i}
            count={items.length}
            onMove={(from, to) => onChange(moveItem(items, from, to))}
            onRemove={() => items.length > min && onChange(items.filter((_, j) => j !== i))}
          />
        </div>
      ))}
      {items.length < max && (
        <button type="button" className="ed-add-btn" onClick={() => onChange([...items, { hanzi: '' }])}>+ {addLabel}</button>
      )}
    </div>
  );
}

function OptionalSentence(props: { value: LessonSentence | undefined; onChange: (v: LessonSentence | undefined) => void; speak: Speak; addLabel: string }) {
  const { value, onChange, speak, addLabel } = props;
  return value ? (
    <div className="ed-list-row">
      <SentenceEditor value={value} onChange={onChange} speak={speak} compact />
      <button type="button" className="ed-mini-btn danger" onClick={() => onChange(undefined)} aria-label="Remove">✕</button>
    </div>
  ) : (
    <button type="button" className="ed-add-btn" onClick={() => onChange({ hanzi: '' })}>+ {addLabel}</button>
  );
}

function AlternativesField({ value, onChange }: { value: string[] | undefined; onChange: (v: string[] | undefined) => void }) {
  const [text, setText] = useState((value ?? []).join('\n'));
  return (
    <Field label="Also accept" hint="optional, one per line">
      <textarea
        className="ed-input"
        lang="zh-CN"
        rows={2}
        value={text}
        onChange={e => {
          setText(e.target.value);
          const list = e.target.value.split('\n').map(l => l.trim()).filter(Boolean);
          onChange(list.length ? list : undefined);
        }}
      />
    </Field>
  );
}

const CUE_LABELS: Record<WritingCue, string> = { english: 'English', pinyin: 'Pinyin', audio: '🔊 Audio' };

function CuesField({ value, onChange }: { value: WritingCue[] | undefined; onChange: (v: WritingCue[] | undefined) => void }) {
  const cues = value ?? ['english', 'pinyin'];
  const toggle = (c: WritingCue) => {
    const next = cues.includes(c) ? cues.filter(x => x !== c) : [...cues, c];
    onChange(next.length === 0 ? cues : next);
  };
  return (
    <Field label="Show as the cue">
      <div className="ed-seg multi">
        {(Object.keys(CUE_LABELS) as WritingCue[]).map(c => (
          <button key={c} type="button" aria-pressed={cues.includes(c)} className={cues.includes(c) ? 'on' : ''} onClick={() => toggle(c)}>{CUE_LABELS[c]}</button>
        ))}
      </div>
    </Field>
  );
}

function SentenceMakingForm({ exercise, onChange, speak }: FormProps<SentenceMakingExerciseSpec>) {
  return (
    <>
      <Field label="Target words" hint="1–4, the sentence must use all of them">
        <WordList items={exercise.words} onChange={words => onChange({ ...exercise, words })} speak={speak} addLabel="Add word" max={4} min={1} />
      </Field>
      <Field label="Task / situation" hint="optional">
        <TextInput value={exercise.task} onChange={v => onChange({ ...exercise, task: clean(v) })} placeholder="Explain why you were late today." />
      </Field>
      <Field label="The learner writes by">
        <InputModeToggle value={exercise.input} onChange={input => onChange({ ...exercise, input })} />
      </Field>
      <Field label="Example answer" hint="optional, shown afterwards">
        <OptionalSentence value={exercise.example} onChange={example => onChange({ ...exercise, example })} speak={speak} addLabel="Add example" />
      </Field>
    </>
  );
}

function WriteForm({ exercise, onChange, speak }: FormProps<WriteTypedExerciseSpec | WriteHandwritingExerciseSpec>) {
  const handwriting = exercise.type === 'write_handwriting';
  const chars = (exercise.answer.hanzi.match(/\p{Script=Han}/gu) ?? []).length;
  return (
    <>
      <Field label="What to write" hint={handwriting ? `${chars}/12 characters — a word or short phrase` : 'hanzi is the answer; English / pinyin are the cues'}>
        <SentenceEditor value={exercise.answer} onChange={answer => onChange({ ...exercise, answer })} speak={speak} />
      </Field>
      <CuesField value={exercise.cues} onChange={cues => onChange({ ...exercise, cues })} />
      <Field label="Instruction" hint="optional">
        <TextInput value={exercise.prompt} onChange={v => onChange({ ...exercise, prompt: clean(v) })} placeholder="Where do you borrow books?" />
      </Field>
      {exercise.type === 'write_typed' && (
        <AlternativesField value={exercise.alternatives} onChange={alternatives => onChange({ ...exercise, alternatives })} />
      )}
    </>
  );
}

function DictationForm({ exercise, onChange, speak }: FormProps<DictationExerciseSpec>) {
  return (
    <>
      <Field label="What is played" hint="the hanzi is the answer">
        <SentenceEditor value={exercise.audio} onChange={audio => onChange({ ...exercise, audio })} speak={speak} />
      </Field>
      <Field label="The learner writes by">
        <InputModeToggle value={exercise.input} onChange={input => onChange({ ...exercise, input })} />
      </Field>
      {exercise.input !== 'handwrite' && (
        <AlternativesField value={exercise.alternatives} onChange={alternatives => onChange({ ...exercise, alternatives })} />
      )}
      <Field label="Note" hint="optional, shown with the answer">
        <TextInput value={exercise.note} onChange={v => onChange({ ...exercise, note: clean(v) })} />
      </Field>
    </>
  );
}

function OralExpressionForm({ exercise, onChange, speak }: FormProps<OralExpressionExerciseSpec>) {
  return (
    <>
      <Field label="What to talk about">
        <TextArea value={exercise.prompt} onChange={v => onChange({ ...exercise, prompt: v })} rows={2} placeholder="Talk about what you did last weekend." />
      </Field>
      <Field label="Question played in Chinese" hint="optional">
        <OptionalSentence value={exercise.question_audio} onChange={question_audio => onChange({ ...exercise, question_audio })} speak={speak} addLabel="Add a spoken question" />
      </Field>
      <Field label="Useful words" hint="optional, up to 8">
        <WordList items={exercise.hints ?? []} onChange={hints => onChange({ ...exercise, hints: hints.length ? hints : undefined })} speak={speak} addLabel="Add word" max={8} />
      </Field>
      <Field label="Model answer" hint="optional, shown after recording">
        <OptionalSentence value={exercise.example} onChange={example => onChange({ ...exercise, example })} speak={speak} addLabel="Add model answer" />
      </Field>
      <Field label="About how long" hint="seconds">
        <input
          className="ed-input"
          type="number"
          min={5}
          max={180}
          value={exercise.target_seconds ?? ''}
          placeholder="30"
          onChange={e => onChange({ ...exercise, target_seconds: e.target.value ? Number(e.target.value) : undefined })}
        />
      </Field>
    </>
  );
}

function ConversationForm({ exercise, onChange, speak }: FormProps<ConversationExerciseSpec>) {
  const { speakers, lines, questions } = exercise;
  const setSpeaker = (i: number, patch: Partial<ConversationExerciseSpec['speakers'][number]>) =>
    onChange({ ...exercise, speakers: speakers.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setLine = (i: number, patch: Partial<ConversationExerciseSpec['lines'][number]>) =>
    onChange({ ...exercise, lines: lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const setQuestion = (i: number, q: ConversationExerciseSpec['questions'][number]) =>
    onChange({ ...exercise, questions: questions.map((x, j) => (j === i ? q : x)) });

  return (
    <>
      <Field label="Situation" hint="shown before listening">
        <TextInput value={exercise.situation} onChange={v => onChange({ ...exercise, situation: v })} placeholder="Checking in at a hotel" />
      </Field>
      <Field label="Speakers" hint="each gets a different voice">
        <div className="ed-list">
          {speakers.map((s, i) => (
            <div key={i} className="ed-hanzi-row">
              <input className="ed-input" value={s.name} onChange={e => setSpeaker(i, { name: e.target.value })} placeholder={i === 0 ? '前台 Receptionist' : '客人 Guest'} />
              <select className="ed-input ed-voice" value={s.voice ?? (i % 2 === 0 ? 'female' : 'male')} onChange={e => setSpeaker(i, { voice: e.target.value as 'female' | 'male' })} aria-label="Voice">
                <option value="female">👩 Female</option>
                <option value="male">👨 Male</option>
              </select>
              {speakers.length > 2 && (
                <button type="button" className="ed-mini-btn danger" aria-label="Remove speaker" onClick={() => onChange({
                  ...exercise,
                  speakers: speakers.filter((_, j) => j !== i),
                  lines: lines.filter(l => l.speaker !== i).map(l => (l.speaker > i ? { ...l, speaker: l.speaker - 1 } : l)),
                })}>✕</button>
              )}
            </div>
          ))}
          {speakers.length < 3 && (
            <button type="button" className="ed-add-btn" onClick={() => onChange({ ...exercise, speakers: [...speakers, { name: '', voice: 'female' }] })}>+ Add speaker</button>
          )}
        </div>
      </Field>
      <Field label="Lines" hint={`${lines.length}/24 — the learner hears these, text hidden`}>
        <div className="ed-list">
          {lines.map((line, i) => (
            <div key={i} className="ed-list-row">
              <select className="ed-input ed-line-speaker" value={line.speaker} onChange={e => setLine(i, { speaker: Number(e.target.value) })} aria-label="Speaker">
                {speakers.map((s, j) => <option key={j} value={j}>{s.name || `Speaker ${j + 1}`}</option>)}
              </select>
              <SentenceEditor
                value={{ hanzi: line.hanzi, pinyin: line.pinyin, english: line.english }}
                onChange={v => setLine(i, { hanzi: v.hanzi, pinyin: v.pinyin, english: v.english })}
                speak={speak}
                compact
              />
              <RowControls
                index={i}
                count={lines.length}
                onMove={(from, to) => onChange({ ...exercise, lines: moveItem(lines, from, to) })}
                onRemove={() => lines.length > 2 && onChange({ ...exercise, lines: lines.filter((_, j) => j !== i) })}
              />
            </div>
          ))}
          {lines.length < 24 && (
            <button type="button" className="ed-add-btn" onClick={() => {
              const last = lines[lines.length - 1];
              const speaker = last ? (last.speaker + 1) % speakers.length : 0;
              onChange({ ...exercise, lines: [...lines, { speaker, hanzi: '' }] });
            }}>+ Add line</button>
          )}
        </div>
      </Field>
      <Field label="Comprehension questions" hint="1–6, one point each">
        <div className="ed-list">
          {questions.map((q, i) => {
            const choice = q.options !== undefined;
            return (
              <div key={i} className="ed-question">
                <div className="ed-hanzi-row">
                  <input className="ed-input" value={q.question} onChange={e => setQuestion(i, { ...q, question: e.target.value })} placeholder="How many nights is the guest staying?" />
                  <RowControls
                    index={i}
                    count={questions.length}
                    onMove={(from, to) => onChange({ ...exercise, questions: moveItem(questions, from, to) })}
                    onRemove={() => questions.length > 1 && onChange({ ...exercise, questions: questions.filter((_, j) => j !== i) })}
                  />
                </div>
                <div className="ed-seg">
                  <button type="button" className={choice ? 'on' : ''} onClick={() => setQuestion(i, { question: q.question, explanation: q.explanation, options: q.options ?? ['', ''], correct: q.correct ?? 0 })}>Multiple choice</button>
                  <button type="button" className={!choice ? 'on' : ''} onClick={() => setQuestion(i, { question: q.question, explanation: q.explanation, answer: q.answer ?? '' })}>Free answer</button>
                </div>
                {choice ? (
                  <div className="ed-list">
                    {(q.options ?? []).map((o, oi) => (
                      <div key={oi} className={`ed-list-row ${q.correct === oi ? 'correct' : ''}`}>
                        <label className="ed-correct-radio" title="Correct answer">
                          <input type="radio" name={`convo-q${i}`} checked={q.correct === oi} onChange={() => setQuestion(i, { ...q, correct: oi })} />
                          <span>✓</span>
                        </label>
                        <input className="ed-input" value={o} onChange={e => setQuestion(i, { ...q, options: q.options!.map((x, k) => (k === oi ? e.target.value : x)) })} placeholder={`Option ${oi + 1}`} />
                        {q.options!.length > 2 && (
                          <button type="button" className="ed-mini-btn danger" aria-label="Remove option" onClick={() => {
                            const options = q.options!.filter((_, k) => k !== oi);
                            const correct = q.correct === oi ? 0 : (q.correct ?? 0) > oi ? (q.correct ?? 0) - 1 : q.correct;
                            setQuestion(i, { ...q, options, correct });
                          }}>✕</button>
                        )}
                      </div>
                    ))}
                    {(q.options ?? []).length < 5 && (
                      <button type="button" className="ed-add-btn" onClick={() => setQuestion(i, { ...q, options: [...(q.options ?? []), ''] })}>+ Add option</button>
                    )}
                  </div>
                ) : (
                  <input className="ed-input" value={q.answer ?? ''} onChange={e => setQuestion(i, { ...q, answer: e.target.value })} placeholder="Model answer (the learner checks theirs against it)" />
                )}
                <input className="ed-input" value={q.explanation ?? ''} onChange={e => setQuestion(i, { ...q, explanation: e.target.value || undefined })} placeholder="Explanation (optional, shown after answering)" />
              </div>
            );
          })}
          {questions.length < 6 && (
            <button type="button" className="ed-add-btn" onClick={() => onChange({ ...exercise, questions: [...questions, { question: '', options: ['', ''], correct: 0 }] })}>+ Add question</button>
          )}
        </div>
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
    case 'sentence_making':
      form = <SentenceMakingForm exercise={exercise} onChange={onChange} speak={speak} />;
      break;
    case 'write_typed':
    case 'write_handwriting':
      form = <WriteForm exercise={exercise} onChange={onChange as (ex: WriteTypedExerciseSpec | WriteHandwritingExerciseSpec) => void} speak={speak} />;
      break;
    case 'dictation':
      form = <DictationForm exercise={exercise} onChange={onChange} speak={speak} />;
      break;
    case 'oral_expression':
      form = <OralExpressionForm exercise={exercise} onChange={onChange} speak={speak} />;
      break;
    case 'conversation':
      form = <ConversationForm exercise={exercise} onChange={onChange} speak={speak} />;
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
    case 'sentence_making':
      return { ...ex, words: ex.words.map(fillSentence), example: ex.example ? fillSentence(ex.example) : undefined };
    case 'write_typed':
    case 'write_handwriting':
      return { ...ex, answer: fillSentence(ex.answer) };
    case 'dictation':
      return { ...ex, audio: fillSentence(ex.audio) };
    case 'oral_expression':
      return {
        ...ex,
        hints: ex.hints?.map(fillSentence),
        question_audio: ex.question_audio ? fillSentence(ex.question_audio) : undefined,
        example: ex.example ? fillSentence(ex.example) : undefined,
      };
    case 'conversation':
      return { ...ex, lines: ex.lines.map(l => (l.pinyin || !l.hanzi.trim() ? l : { ...l, pinyin: toPinyin(l.hanzi) })) };
    default:
      return ex;
  }
}
