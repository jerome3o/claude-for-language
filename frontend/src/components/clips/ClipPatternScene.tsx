/**
 * 🎬 The `pattern` layout (a structure intro, shared/lesson/patternIntro.ts): the structure's pieces
 * building up one by one (the structure card's chips), then — with an example — the example big, every
 * part coloured like the piece it fills, the part being read lit up as the voice reads it
 * (`introLitPart`: the karaoke timeline over the parts).
 */
import { useEffect, useRef, useState } from 'react';
import type { ClipPatternScene } from '@shared/clips';
import { pieceTones } from '@shared/lesson/pattern';
import { introLitPart } from '@shared/lesson/patternIntro';
import { PatternChips } from '../lessons/StructureCards';
import { ExplorableText } from '../explorer/ExplorableText';
import { devicePinyinLine } from '../../utils/autoPinyin';
import type { SpeechClock } from './Karaoke';
import type { SceneCtx } from './ClipScenes';
import '../lessons/StructureCards.css';

/** Where the clock of `text` is (position, length), every frame; null when another line is read. */
function useClockPosition(clock: SpeechClock | null, text: string): { position: number; duration: number } | null {
  const live = !!clock && clock.text === text;
  const [at, setAt] = useState<{ position: number; duration: number } | null>(null);
  const raf = useRef(0);
  useEffect(() => {
    if (!live || !clock) {
      setAt(null);
      return;
    }
    const frame = () => {
      const d = clock.durationMs();
      if (d && d > 0) {
        const p = clock.positionMs();
        setAt((prev) => (prev && prev.duration === d && Math.abs(prev.position - p) < 15 ? prev : { position: p, duration: d }));
      }
      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf.current);
  }, [live, clock]);
  return at;
}

export function PatternSceneView({ scene, ctx, clock, building }: {
  scene: ClipPatternScene;
  ctx: SceneCtx;
  clock: SpeechClock | null;
  /** The pieces build up one by one (the first pattern scene); later scenes show them at once. */
  building: boolean;
}) {
  const p = scene.pattern;
  const tones = pieceTones(p.pieces);
  const example = p.example;
  const at = useClockPosition(clock, example?.hanzi ?? '');
  const lit = example?.parts && at ? introLitPart(example.parts, at.position, at.duration) : -1;
  return (
    <div className="structure-note clip-pattern" data-testid="clip-pattern">
      {p.name && <div className="clip-pattern-name">{p.name}</div>}
      <div className={`clip-pattern-pieces${example ? ' small' : ''}`}>
        <PatternChips pieces={p.pieces} stagger={building ? 520 : 0} />
      </div>
      {p.meaning && !example && <div className="clip-pattern-meaning">= {p.meaning}</div>}
      {example && (
        <div className="clip-pattern-example" data-testid="clip-pattern-example">
          <div className="clip-pattern-example-zh" lang="zh-CN">
            {(example.parts ?? [{ text: example.hanzi }]).map((part, i) => {
              const tone = part.piece === undefined ? 'plain' : tones[part.piece];
              return (
                <span key={i} className={`sc-part sc-tone-${tone}${lit === i ? ' sc-lit' : ''}`} data-tone={tone}>
                  <ExplorableText text={part.text} source="clips" onTap={ctx.onExplore} onClosed={ctx.onExplorerClosed} />
                </span>
              );
            })}
          </div>
          {ctx.pinyin && <div className="clip-pinyin">{example.pinyin || devicePinyinLine(example.hanzi)}</div>}
          {ctx.english && example.english && <div className="clip-en">{example.english}</div>}
        </div>
      )}
    </div>
  );
}
