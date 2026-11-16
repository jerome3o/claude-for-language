/**
 * A mini lesson's grammar structures as designed cards (docs/STUDY_SESSION.md "Structure cards"):
 * one structure per screen — the pattern as coloured pieces (fixed words as solid chips, slots as
 * dashed tinted boxes with their label), its meaning, an optional picture, the examples BIG with
 * every part coloured like the piece it fills, then the usage / ✗ ✓ lines. Progress dots, swipe,
 * ‹ / Next ›, Continue on the last. Nothing auto-plays: ▶ plays an example and lights its parts up
 * in turn. Rules (parsing older lessons, aligning examples, colours) in shared/lesson/pattern.ts;
 * the Lab port is ui/lessons/StructureCards.kt.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  isSlotPiece, pieceTones, patternName, type NoteBlock, type PieceTone, type StructureCard, type StructureNoteView,
} from '@shared/lesson/pattern';
import type { LessonSentence, PatternExamplePart, PatternPiece } from '@shared/lesson/types';
import { ExplorableText } from '../explorer/ExplorableText';
import { segmentNow, useSegmentedWords } from '../../services/chineseSegmenter';
import { useLessonImage } from '../../hooks/useLessonImage';
import { DescribeImagePicture } from '../lesson-exercises';
import { TakeLockActions } from '../voice/TakeLock';
import { track } from '../../services/analytics';
import './StructureCards.css';

type Speak = (text: string) => void;

/** Roughly how long the default lesson voice takes over one character (0.6 speed), for the light-up. */
const MS_PER_CHAR = 260;

function toneClass(tone: PieceTone | undefined): string {
  return tone ? `sc-tone-${tone}` : 'sc-tone-plain';
}

export function NoteBlocks({ blocks }: { blocks: NoteBlock[] }) {
  if (!blocks.length) return null;
  return (
    <div className="sc-blocks">
      {blocks.map((b, i) => {
        if (b.kind === 'heading') return <div key={i} className="sc-block-heading">{b.text}</div>;
        if (b.kind === 'wrong' || b.kind === 'right') {
          return (
            <div key={i} className={`sc-block-mark sc-block-${b.kind}`}>
              <span className="sc-block-mark-icon" aria-label={b.kind === 'wrong' ? 'Wrong' : 'Right'}>{b.kind === 'wrong' ? '✗' : '✓'}</span>
              <ExplorableText text={b.text} source="lesson" />
            </div>
          );
        }
        return <p key={i} className="sc-block-text">{b.text}</p>;
      })}
    </div>
  );
}

export function PatternChips({ pieces }: { pieces: PatternPiece[] }) {

  const tones = pieceTones(pieces);
  return (
    <div className="sc-pattern" data-testid="structure-pattern">
      {pieces.map((p, i) => {
        const delay = { animationDelay: `${i * 70}ms` };
        if (tones[i] === 'punct') return <span key={i} className="sc-punct sc-in" style={delay}>{p.hanzi}</span>;
        if (isSlotPiece(p)) {
          return (
            <span key={i} className={`sc-piece sc-slot ${toneClass(tones[i])} sc-in${p.optional ? ' sc-opt' : ''}`} style={delay} data-testid="structure-slot">
              <span className="sc-slot-label">{p.slot}</span>
              {p.zh && <span className="sc-slot-zh" lang="zh-CN">{p.zh}</span>}
            </span>
          );
        }
        return (
          <span key={i} className={`sc-piece sc-fixed sc-in${p.optional ? ' sc-opt' : ''}`} style={delay} data-testid="structure-fixed">
            <span className="sc-fixed-zh" lang="zh-CN">{p.hanzi}</span>
            {(p.pinyin || p.english) && <span className="sc-fixed-gloss">{[p.pinyin, p.english].filter(Boolean).join(' · ')}</span>}
          </span>
        );
      })}
    </div>
  );
}

function ExampleRow({ example, tones, speak, onPlay }: {
  example: LessonSentence & { parts: PatternExamplePart[] };
  tones: PieceTone[];
  speak: Speak;
  onPlay: () => void;
}) {
  const words = useSegmentedWords(example.hanzi);
  const [lit, setLit] = useState<number | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const play = () => {
    speak(example.hanzi);
    onPlay();
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    let at = 250;
    example.parts.forEach((part, i) => {
      timers.current.push(window.setTimeout(() => setLit(i), at));
      at += Math.max(1, [...part.text].length) * MS_PER_CHAR;
    });
    timers.current.push(window.setTimeout(() => setLit(null), at + 200));
  };

  return (
    <div className="sc-example" data-testid="structure-example">
      <button type="button" className="sc-play" onClick={play} aria-label={`Play ${example.hanzi}`} data-testid="structure-play">▶</button>
      <div className="sc-example-body">
        <div className="sc-example-zh" lang="zh-CN">
          {example.parts.map((part, i) => {
            const tone = part.piece === undefined ? undefined : tones[part.piece];
            return (
              <span key={i} className={`sc-part ${toneClass(tone)}${lit === i ? ' sc-lit' : ''}`} data-tone={tone ?? 'plain'}>
                <ExplorableText text={part.text} segments={words ? segmentNow(part.text) : null} source="lesson" />
              </span>
            );
          })}
        </div>
        {example.pinyin && <div className="sc-example-pinyin">{example.pinyin}</div>}
        {example.english && <div className="sc-example-english">{example.english}</div>}
      </div>
    </div>
  );
}

function PatternPicture({ imageKey, prompt }: { imageKey?: string | null; prompt: string }) {
  const image = useLessonImage(imageKey, prompt);
  return <div className="sc-picture"><DescribeImagePicture image={image} imagePrompt={prompt} /></div>;
}

function CardView({ card, index, count, showHead, speak, onPlay }: {
  card: StructureCard;
  index: number;
  count: number;
  /** Off for a lone structure under a title that already names it. */
  showHead: boolean;
  speak: Speak;
  onPlay: () => void;
}) {
  const tones = useMemo(() => pieceTones(card.pattern.pieces), [card]);
  const name = patternName(card.pattern);
  const marker = card.pattern.name && card.pattern.name.length === 1 ? card.pattern.name : null;
  return (
    <article className="sc-card" data-testid="structure-card">
      {showHead && (name || marker || count > 1) && <header className="sc-head">
        {marker && <span className="sc-marker">{marker}</span>}
        {name && <span className="sc-name" lang="zh-CN">{name}</span>}
        {count > 1 && <span className="sc-count">{index + 1} / {count}</span>}
      </header>}
      <PatternChips pieces={card.pattern.pieces} />
      {card.pattern.meaning && <p className="sc-meaning">{card.pattern.meaning}</p>}
      {card.pattern.image_prompt && <PatternPicture imageKey={card.pattern.image_url} prompt={card.pattern.image_prompt} />}
      {card.examples.length > 0 && (
        <div className="sc-examples">
          {card.examples.map((e, i) => <ExampleRow key={i} example={e} tones={tones} speak={speak} onPlay={onPlay} />)}
        </div>
      )}
      <NoteBlocks blocks={card.blocks} />
    </article>
  );
}

export function StructureCards({ title, view, speak, onNext }: {
  title?: string;
  view: StructureNoteView;
  speak: Speak;
  onNext: () => void;
}) {
  const count = view.cards.length;
  const [index, setIndex] = useState(0);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const last = index >= count - 1;

  useEffect(() => {
    track('lesson.structure_card', { action: 'open', source: view.source, index: 0, count });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (to: number, how: 'next' | 'back' | 'dot' | 'swipe') => {
    if (to < 0 || to >= count || to === index) return;
    setIndex(to);
    track('lesson.structure_card', { action: how, source: view.source, index: to, count });
  };

  return (
    <div className="exercise structure-note" data-testid="structure-note" data-source={view.source}>
      {title && <div className="phase-label">{title}</div>}
      {index === 0 && <NoteBlocks blocks={view.intro} />}
      <div
        className="sc-deck"
        onPointerDown={(e) => { touch.current = { x: e.clientX, y: e.clientY }; }}
        onPointerUp={(e) => {
          const t = touch.current;
          touch.current = null;
          if (!t) return;
          const dx = e.clientX - t.x;
          if (Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(e.clientY - t.y)) go(index + (dx < 0 ? 1 : -1), 'swipe');
        }}
      >
        <CardView
          key={index}
          card={view.cards[index]}
          index={index}
          count={count}
          showHead={count > 1 || !title}
          speak={speak}
          onPlay={() => track('lesson.structure_card', { action: 'play', source: view.source, index, count })}
        />
      </div>
      {count > 1 && (
        <div className="sc-dots" role="tablist" aria-label="Structures">
          {view.cards.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Structure ${i + 1} of ${count}`}
              className={`sc-dot${i === index ? ' active' : ''}`}
              onClick={() => go(i, 'dot')}
            />
          ))}
        </div>
      )}
      {last && view.extras.length > 0 && (
        <div className="sc-extras">
          <div className="sc-block-heading">More examples</div>
          {view.extras.map((s, i) => (
            <div className="lesson-note-sentence" key={i} onClick={() => speak(s.hanzi)}>
              <div className="lesson-note-hanzi"><ExplorableText text={s.hanzi} source="lesson" /> 🔊</div>
              {s.pinyin && <div className="translate-ref-pinyin">{s.pinyin}</div>}
              {s.english && <div className="contrast-english">{s.english}</div>}
            </div>
          ))}
        </div>
      )}
      <TakeLockActions>
        {index > 0 && (
          <button type="button" className="practice-btn sc-back" onClick={() => go(index - 1, 'back')} data-testid="structure-back">‹ Back</button>
        )}
        {last ? (
          <button type="button" className="practice-btn primary" onClick={() => { track('lesson.structure_card', { action: 'done', source: view.source, index, count }); onNext(); }}>
            Continue
          </button>
        ) : (
          <button type="button" className="practice-btn primary" onClick={() => go(index + 1, 'next')} data-testid="structure-next">
            Next structure ›
          </button>
        )}
      </TakeLockActions>
    </div>
  );
}
