/**
 * Small form primitives for the lesson editor: labelled inputs, a hanzi
 * input with play + auto-pinyin, and a sentence (hanzi / pinyin / english)
 * block. Inputs are 16px+ so phones don't zoom.
 */

import { ReactNode } from 'react';
import { pinyin } from 'pinyin-pro';
import type { LessonSentence } from '@shared/lesson';

export type Speak = (text: string) => void;

export function toPinyin(hanzi: string): string {
  return pinyin(hanzi, { toneType: 'symbol', type: 'string' });
}

export function Field({ label, hint, children, inline }: { label: string; hint?: string; children: ReactNode; inline?: boolean }) {
  return (
    <label className={`ed-field ${inline ? 'inline' : ''}`}>
      <span className="ed-label">
        {label}
        {hint && <span className="ed-hint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function TextInput(props: {
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  lang?: string;
}) {
  return (
    <input
      className="ed-input"
      type="text"
      value={props.value ?? ''}
      onChange={e => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      maxLength={props.maxLength}
      lang={props.lang}
    />
  );
}

export function TextArea(props: { value: string | undefined; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <textarea
      className="ed-input"
      value={props.value ?? ''}
      onChange={e => props.onChange(e.target.value)}
      placeholder={props.placeholder}
      rows={props.rows ?? 3}
    />
  );
}

/** Hanzi input with a play button and, optionally, a "fill pinyin" button
 * that writes tone-marked pinyin into a sibling field. */
export function HanziInput(props: {
  value: string | undefined;
  onChange: (v: string) => void;
  onPinyin?: (py: string) => void;
  speak: Speak;
  placeholder?: string;
}) {
  const { value, onChange, onPinyin, speak, placeholder } = props;
  return (
    <div className="ed-hanzi-row">
      <input
        className="ed-input"
        type="text"
        lang="zh-CN"
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? '中文'}
      />
      <button type="button" className="ed-mini-btn" onClick={() => speak(value ?? '')} disabled={!value?.trim()} aria-label="Play" title="Play">
        🔊
      </button>
      {onPinyin && (
        <button
          type="button"
          className="ed-mini-btn text"
          onClick={() => onPinyin(toPinyin(value ?? ''))}
          disabled={!value?.trim()}
          title="Fill pinyin from the hanzi"
        >
          拼音
        </button>
      )}
    </div>
  );
}

/** A hanzi / pinyin / english block. */
export function SentenceEditor(props: {
  value: LessonSentence;
  onChange: (v: LessonSentence) => void;
  speak: Speak;
  englishRequired?: boolean;
  englishLabel?: string;
  compact?: boolean;
  trailing?: ReactNode;
}) {
  const { value, onChange, speak, englishRequired, englishLabel, compact, trailing } = props;
  return (
    <div className={`ed-sentence ${compact ? 'compact' : ''}`}>
      <HanziInput
        value={value.hanzi}
        onChange={hanzi => onChange({ ...value, hanzi })}
        onPinyin={py => onChange({ ...value, pinyin: py })}
        speak={speak}
      />
      <input
        className="ed-input"
        type="text"
        value={value.pinyin ?? ''}
        onChange={e => onChange({ ...value, pinyin: e.target.value || undefined })}
        placeholder="pinyin (nǐ hǎo)"
      />
      <input
        className="ed-input"
        type="text"
        value={value.english ?? ''}
        onChange={e => onChange({ ...value, english: e.target.value || undefined })}
        placeholder={englishLabel ?? (englishRequired ? 'English (required)' : 'English')}
      />
      {trailing}
    </div>
  );
}

/** Ordered list controls shared by sentences, options, pairs, sections. */
export function RowControls(props: {
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: () => void;
  onDuplicate?: () => void;
  removeLabel?: string;
}) {
  const { index, count, onMove, onRemove, onDuplicate, removeLabel } = props;
  return (
    <div className="ed-row-controls">
      <button type="button" className="ed-mini-btn" onClick={() => onMove(index, index - 1)} disabled={index === 0} aria-label="Move up" title="Move up">▲</button>
      <button type="button" className="ed-mini-btn" onClick={() => onMove(index, index + 1)} disabled={index >= count - 1} aria-label="Move down" title="Move down">▼</button>
      {onDuplicate && (
        <button type="button" className="ed-mini-btn" onClick={onDuplicate} aria-label="Duplicate" title="Duplicate">⧉</button>
      )}
      <button type="button" className="ed-mini-btn danger" onClick={onRemove} aria-label={removeLabel ?? 'Remove'} title={removeLabel ?? 'Remove'}>✕</button>
    </div>
  );
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
