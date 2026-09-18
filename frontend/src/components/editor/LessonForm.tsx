/**
 * The structured lesson form: header fields, collapsible sections, exercise
 * cards with a type picker, reorder / duplicate / delete, and the
 * validator's problems shown inline. Raw JSON lives elsewhere (Advanced).
 */

import { useState } from 'react';
import type { CustomLessonSpec, LessonExercise, LessonSection } from '@shared/lesson';
import { exercisePrimaryText } from '@shared/lesson';
import { Field, TextInput, TextArea, RowControls, moveItem, Speak } from './fields';
import { ExerciseForm, EXERCISE_TYPES, defaultExercise, fillMissingPinyin } from './ExerciseForm';
import { EXERCISE_ICONS, EXERCISE_TYPE_NAMES } from './DiffCard';

export interface LessonFormProps {
  spec: CustomLessonSpec;
  onChange: (spec: CustomLessonSpec) => void;
  errors: string[];
  speak: Speak;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Split the validator's problems by where they point. */
function errorsFor(errors: string[], si: number, ei?: number): string[] {
  const prefix = ei === undefined ? `sections[${si}]` : `sections[${si}].exercises[${ei}]`;
  return errors
    .filter(e => e.startsWith(prefix) && (ei !== undefined || !e.startsWith(`${prefix}.exercises[`)))
    .map(e => e.slice(prefix.length).replace(/^[.:]\s*/, ''));
}

function TypePicker({ onPick, onClose }: { onPick: (t: LessonExercise['type']) => void; onClose: () => void }) {
  return (
    <div className="ed-type-picker" role="dialog" aria-label="Add exercise">
      <div className="ed-type-picker-head">
        <span>Add an exercise</span>
        <button type="button" className="ed-mini-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      {EXERCISE_TYPES.map(t => (
        <button key={t.type} type="button" className="ed-type-option" onClick={() => onPick(t.type)}>
          <span className="ed-type-icon">{t.icon}</span>
          <span className="ed-type-text">
            <span className="ed-type-name">{t.name}</span>
            <span className="ed-type-desc">{t.description}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function ExerciseCard(props: {
  exercise: LessonExercise;
  index: number;
  count: number;
  errors: string[];
  speak: Speak;
  onChange: (ex: LessonExercise) => void;
  onMove: (from: number, to: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  defaultOpen: boolean;
}) {
  const { exercise, index, count, errors, speak, onChange, onMove, onDuplicate, onRemove, defaultOpen } = props;
  const [open, setOpen] = useState(defaultOpen);
  const summary = exercisePrimaryText(exercise);
  return (
    <div className={`ed-exercise ${errors.length ? 'has-errors' : ''}`}>
      <div className="ed-exercise-head">
        <button type="button" className="ed-exercise-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <span className="ed-exercise-num">{index + 1}</span>
          <span className="ed-exercise-icon">{EXERCISE_ICONS[exercise.type]}</span>
          <span className="ed-exercise-titles">
            <span className="ed-exercise-type">{EXERCISE_TYPE_NAMES[exercise.type]}</span>
            <span className="ed-exercise-summary">{summary || <em>empty</em>}</span>
          </span>
          {errors.length > 0 && <span className="ed-exercise-err" title={errors.join('\n')}>!</span>}
          <span className="ed-exercise-chevron">{open ? '▾' : '▸'}</span>
        </button>
        <RowControls index={index} count={count} onMove={onMove} onDuplicate={onDuplicate} onRemove={onRemove} removeLabel="Delete exercise" />
      </div>
      {open && (
        <div className="ed-exercise-body">
          <ExerciseForm exercise={exercise} onChange={onChange} speak={speak} errors={errors} />
          <div className="ed-exercise-foot">
            <button type="button" className="ed-mini-btn text" onClick={() => onChange(fillMissingPinyin(exercise))}>
              Auto-fill missing pinyin
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionEditor(props: {
  section: LessonSection;
  index: number;
  count: number;
  errors: string[];
  speak: Speak;
  onChange: (s: LessonSection) => void;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
  /** Index of the exercise that was just added (opens expanded). */
  freshIndex: number | null;
}) {
  const { section, index, count, errors, speak, onChange, onMove, onRemove, freshIndex } = props;
  const [collapsed, setCollapsed] = useState(false);
  const [picking, setPicking] = useState(false);
  const sectionErrors = errorsFor(errors, index);
  const exercises = section.exercises;

  const setExercises = (next: LessonExercise[]) => onChange({ ...section, exercises: next });

  return (
    <section className="ed-section">
      <div className="ed-section-head">
        <button type="button" className="ed-mini-btn" onClick={() => setCollapsed(c => !c)} aria-label={collapsed ? 'Expand section' : 'Collapse section'}>
          {collapsed ? '▸' : '▾'}
        </button>
        <input
          className="ed-input ed-section-title"
          value={section.title ?? ''}
          onChange={e => onChange({ ...section, title: e.target.value || undefined })}
          placeholder={`Section ${index + 1} title (optional)`}
        />
        <span className="ed-section-count">{exercises.length}</span>
        <RowControls index={index} count={count} onMove={onMove} onRemove={onRemove} removeLabel="Delete section" />
      </div>
      {sectionErrors.length > 0 && (
        <ul className="ed-errors">{sectionErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
      )}
      {!collapsed && (
        <div className="ed-section-body">
          {exercises.map((ex, ei) => (
            <ExerciseCard
              key={`${ei}-${ex.type}`}
              exercise={ex}
              index={ei}
              count={exercises.length}
              errors={errorsFor(errors, index, ei)}
              speak={speak}
              onChange={next => setExercises(exercises.map((x, j) => (j === ei ? next : x)))}
              onMove={(from, to) => setExercises(moveItem(exercises, from, to))}
              onDuplicate={() => {
                const next = exercises.slice();
                next.splice(ei + 1, 0, clone(ex));
                setExercises(next);
              }}
              onRemove={() => {
                if (exercises.length > 1 || confirm('Delete the only exercise in this section?')) {
                  setExercises(exercises.filter((_, j) => j !== ei));
                }
              }}
              defaultOpen={freshIndex === ei || !exercisePrimaryText(ex)}
            />
          ))}
          {picking ? (
            <TypePicker
              onPick={type => {
                setExercises([...exercises, defaultExercise(type)]);
                setPicking(false);
              }}
              onClose={() => setPicking(false)}
            />
          ) : (
            <button type="button" className="ed-add-btn big" onClick={() => setPicking(true)}>
              + Add exercise
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function LessonForm({ spec, onChange, errors, speak }: LessonFormProps) {
  const [fresh, setFresh] = useState<{ section: number; index: number } | null>(null);
  const globalErrors = errors.filter(e => !e.startsWith('sections['));

  const setSections = (sections: LessonSection[]) => onChange({ ...spec, sections });

  return (
    <div className="ed-form">
      <div className="ed-head-fields">
        <Field label="Icon" inline>
          <input
            className="ed-input ed-icon-input"
            value={spec.icon ?? ''}
            onChange={e => onChange({ ...spec, icon: e.target.value || undefined })}
            placeholder="🎓"
            maxLength={8}
            aria-label="Icon (emoji)"
          />
        </Field>
        <Field label="Title">
          <TextInput value={spec.title} onChange={v => onChange({ ...spec, title: v })} placeholder="Ordering at a café" maxLength={200} />
        </Field>
      </div>
      <Field label="Description" hint="one sentence, optional">
        <TextArea value={spec.description} onChange={v => onChange({ ...spec, description: v || undefined })} rows={2} placeholder="What the lesson covers" />
      </Field>

      {globalErrors.length > 0 && (
        <ul className="ed-errors top">{globalErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
      )}

      {spec.sections.map((section, si) => (
        <SectionEditor
          key={si}
          section={section}
          index={si}
          count={spec.sections.length}
          errors={errors}
          speak={speak}
          onChange={next => {
            // A grown exercise list means one was just added — open it.
            if (next.exercises.length > section.exercises.length) setFresh({ section: si, index: next.exercises.length - 1 });
            setSections(spec.sections.map((s, j) => (j === si ? next : s)));
          }}
          onMove={(from, to) => setSections(moveItem(spec.sections, from, to))}
          onRemove={() => {
            if (spec.sections.length === 1) {
              alert('A lesson needs at least one section.');
              return;
            }
            if (section.exercises.length === 0 || confirm(`Delete section ${si + 1} and its ${section.exercises.length} exercise(s)?`)) {
              setSections(spec.sections.filter((_, j) => j !== si));
            }
          }}
          freshIndex={fresh && fresh.section === si ? fresh.index : null}
        />
      ))}

      <button type="button" className="ed-add-btn big" onClick={() => setSections([...spec.sections, { exercises: [] }])}>
        + Add section
      </button>
    </div>
  );
}
