/**
 * The note form's "Structures" (shared/lesson/pattern.ts): each structure typed as one line
 * ("除了 + 名词 + （以外），主语 + 还 + 动词" — fixed words, grammar terms become slots, （…） is optional),
 * shown as the learner will see it, with each fixed word's pinyin / gloss and each slot's label,
 * the meaning, examples (coloured automatically), a note and an optional picture.
 */
import { useEffect, useState } from 'react';
import type { LessonPattern, LessonSentence, PatternExample, PatternPiece } from '@shared/lesson';
import {
  examplePartsFor, isPunctuation, isSlotPiece, mergePieceDetails, parsePatternLine, patternEditText, pieceTones,
} from '@shared/lesson/pattern';
import { Field, TextInput, TextArea, SentenceEditor, RowControls, moveItem, toPinyin, type Speak } from './fields';
import { PatternChips } from '../lessons/StructureCards';
import '../lessons/StructureCards.css';

function clean(s: string | undefined): string | undefined {
  return s && s.trim() ? s : undefined;
}

const BLANK_PATTERN: LessonPattern = { pieces: [{ hanzi: '' }, { slot: 'Verb', zh: '动词' }] };

function PatternTextInput({ pattern, onChange }: { pattern: LessonPattern; onChange: (p: LessonPattern) => void }) {
  const [text, setText] = useState(() => patternEditText(pattern.pieces));
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    // Someone else changed the pieces (Claude's proposal, undo): show them.
    if (parsePatternLine(text)?.pieces.length !== pattern.pieces.length) setText(patternEditText(pattern.pieces));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pattern.pieces]);
  const apply = (value: string) => {
    setText(value);
    const parsed = parsePatternLine(value);
    if (!parsed) {
      setProblem('Write it as pieces joined by +, with at least one fixed Chinese word: 除了 + 名词 + 还 + 动词');
      return;
    }
    setProblem(null);
    onChange({ ...pattern, pieces: mergePieceDetails(parsed.pieces, pattern.pieces) });
  };
  return (
    <Field label="Pattern" hint="pieces joined by +; 名词 / 动词 / V… become slots; （…） = optional">
      <input className="ed-input" lang="zh-CN" value={text} onChange={(e) => apply(e.target.value)} placeholder="除了 + 名词 + （以外），主语 + 还 + 动词" data-testid="pattern-text" />
      {problem && <span className="ed-hint ed-hint-warn">{problem}</span>}
    </Field>
  );
}

function PieceDetails({ pieces, onChange }: { pieces: PatternPiece[]; onChange: (pieces: PatternPiece[]) => void }) {
  const set = (i: number, patch: Partial<PatternPiece>) => onChange(pieces.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  return (
    <div className="ed-list">
      {pieces.map((p, i) => {
        if (!isSlotPiece(p) && isPunctuation(p.hanzi ?? '')) return null;
        return isSlotPiece(p) ? (
          <div key={i} className="ed-inline-row">
            <span className="ed-hint">Slot {p.zh ?? ''}</span>
            <TextInput value={p.slot} onChange={(v) => set(i, { slot: v })} placeholder="English label, e.g. Noun" />
          </div>
        ) : (
          <div key={i} className="ed-inline-row">
            <span className="ed-hint" lang="zh-CN">{p.hanzi}</span>
            <TextInput value={p.pinyin} onChange={(v) => set(i, { pinyin: clean(v) })} placeholder={toPinyin(p.hanzi ?? '') || 'pinyin'} />
            <TextInput value={p.english} onChange={(v) => set(i, { english: clean(v) })} placeholder="gloss, e.g. besides" />
          </div>
        );
      })}
    </div>
  );
}

function PatternEditor({ pattern, onChange, speak }: { pattern: LessonPattern; onChange: (p: LessonPattern) => void; speak: Speak }) {
  const tones = pieceTones(pattern.pieces);
  const examples = pattern.examples ?? [];
  const setExamples = (next: LessonSentence[]) => {
    // An example whose Chinese changed loses its hand-made parts (they no longer spell it); the app aligns it.
    onChange({
      ...pattern,
      examples: next.map((e, i): PatternExample => {
        const before = examples[i] as PatternExample | undefined;
        return before && before.hanzi === e.hanzi && before.parts ? { ...e, parts: before.parts } : { ...e };
      }),
    });
  };
  return (
    <div className="ed-pattern">
      <Field label="Name" hint="optional, e.g. 除了…还…">
        <TextInput value={pattern.name} onChange={(v) => onChange({ ...pattern, name: clean(v) })} lang="zh-CN" />
      </Field>
      <PatternTextInput pattern={pattern} onChange={onChange} />
      <div className="structure-note ed-pattern-preview"><PatternChips pieces={pattern.pieces} /></div>
      <PieceDetails pieces={pattern.pieces} onChange={(pieces) => onChange({ ...pattern, pieces })} />
      <Field label="Meaning" hint="one short line">
        <TextInput value={pattern.meaning} onChange={(v) => onChange({ ...pattern, meaning: clean(v) })} placeholder="besides A, also B" />
      </Field>
      <Field label="Examples" hint="1–3; coloured to match the pattern">
        <div className="ed-list">
          {examples.map((e, i) => (
            <div key={i} className="ed-list-row">
              <SentenceEditor value={e} onChange={(v) => setExamples(examples.map((x, k) => (k === i ? v : x)))} speak={speak} compact />
              <div className="structure-note ed-pattern-example" lang="zh-CN">
                {examplePartsFor(pattern, e).map((part, k) => (
                  <span key={k} className={`sc-part sc-tone-${part.piece === undefined ? 'plain' : tones[part.piece]}`}>{part.text}</span>
                ))}
              </div>
              <RowControls index={i} count={examples.length} onMove={(from, to) => to >= 0 && to < examples.length && setExamples(moveItem(examples, from, to))} onRemove={() => setExamples(examples.filter((_, k) => k !== i))} />
            </div>
          ))}
          {examples.length < 4 && (
            <button type="button" className="ed-add-btn" onClick={() => setExamples([...examples, { hanzi: '' }])}>+ Add example</button>
          )}
        </div>
      </Field>
      <Field label="Note" hint="optional — the rule, or ✗ wrong / ✓ right lines">
        <TextArea value={pattern.note} onChange={(v) => onChange({ ...pattern, note: clean(v) })} rows={3} placeholder={'还 goes after the subject.\n✗ 除了咖啡，还我喝茶。\n✓ 除了咖啡，我还喝茶。'} />
      </Field>
      <Field label="Picture" hint="optional — only when a scene shows the meaning; English, no text">
        <TextArea
          value={pattern.image_prompt}
          onChange={(v) => {
            const next: LessonPattern = { ...pattern, image_prompt: clean(v) };
            if (next.image_prompt !== pattern.image_prompt) delete next.image_url;
            onChange(next);
          }}
          rows={2}
          placeholder="A man putting a book on a table…"
        />
      </Field>
    </div>
  );
}

export function PatternsField({ patterns, onChange, speak }: {
  patterns: LessonPattern[] | undefined;
  onChange: (patterns: LessonPattern[] | undefined) => void;
  speak: Speak;
}) {
  const list = patterns ?? [];
  const set = (next: LessonPattern[]) => onChange(next.length ? next : undefined);
  return (
    <Field label="Structures" hint="each one becomes a pattern card">
      <div className="ed-list">
        {list.map((p, i) => (
          <div key={i} className="ed-list-row ed-pattern-row">
            <PatternEditor pattern={p} onChange={(v) => set(list.map((x, k) => (k === i ? v : x)))} speak={speak} />
            <RowControls index={i} count={list.length} onMove={(from, to) => to >= 0 && to < list.length && set(moveItem(list, from, to))} onRemove={() => set(list.filter((_, k) => k !== i))} />
          </div>
        ))}
        {list.length < 8 && (
          <button type="button" className="ed-add-btn" onClick={() => set([...list, { ...BLANK_PATTERN, pieces: [...BLANK_PATTERN.pieces] }])} data-testid="add-pattern">
            + Add structure
          </button>
        )}
      </div>
    </Field>
  );
}
