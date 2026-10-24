/**
 * 🎬 Karaoke captions (docs/CLIPS.md "Karaoke captions"; timing in shared/clips/karaoke.ts):
 * while a line is being read, the word being said is exaggerated — bigger, heavier, underlined,
 * a little bounce (none with reduced motion) — the words already said dim, the next ones stay
 * plain. Colour-blind safe: the active word stands out by size, weight and the underline, not
 * colour alone. With 拼 on, the active word carries its pinyin underneath.
 *
 * The timing follows the REAL audio: the line's clip duration and its current position are read
 * from the <audio> element every frame (`SpeechClock`); Chinese is cut into words by the device
 * segmenter (one per character until it has loaded). Without a clock (muted, not this line, not
 * yet loaded) the line shows plain and tappable.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { karaokeActive, karaokeStates, karaokeTimeline } from '@shared/clips';
import { itemForText } from '@shared/explorer';
import { useExplorer } from '../explorer/ExplorerContext';
import { useSegmentedWords } from '../../services/chineseSegmenter';
import { devicePinyinLine } from '../../utils/autoPinyin';

/** The line being read right now: what, and where its audio is. */
export interface SpeechClock {
  scene: number;
  /** The utterance's line (-1 = the scene's voice). */
  line: number;
  text: string;
  lang: 'zh' | 'en';
  positionMs: () => number;
  durationMs: () => number | null;
}

const HAN = /\p{Script=Han}/u;

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function KaraokeLine({
  text,
  lang,
  clock,
  pinyin,
  className = '',
  onExplore,
  onExplorerClosed,
  testId = 'clip-karaoke',
}: {
  text: string;
  lang: 'zh' | 'en';
  /** The clock of the line being read — used only when it is THIS text. */
  clock: SpeechClock | null;
  pinyin: boolean;
  className?: string;
  onExplore?: () => void;
  onExplorerClosed?: () => void;
  testId?: string;
}) {
  const explorer = useExplorer();
  const words = useSegmentedWords(text, lang === 'zh' && HAN.test(text));
  const live = !!clock && clock.text === text;
  const [timing, setTiming] = useState<{ duration: number; position: number } | null>(null);
  const reduced = useMemo(prefersReducedMotion, []);
  const raf = useRef(0);

  useEffect(() => {
    if (!live || !clock) {
      setTiming(null);
      return;
    }
    const frame = () => {
      const d = clock.durationMs();
      if (d && Number.isFinite(d) && d > 0) {
        const p = clock.positionMs();
        setTiming((prev) => (prev && prev.duration === d && Math.abs(prev.position - p) < 15 ? prev : { duration: d, position: p }));
      }
      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf.current);
  }, [live, clock]);

  const segTexts = useMemo(() => words?.map((w) => w.text) ?? null, [words]);
  const timeline = useMemo(
    () => (timing ? karaokeTimeline(text, lang, timing.duration, segTexts) : karaokeTimeline(text, lang, 0, segTexts)),
    [text, lang, timing?.duration, segTexts], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const active = timing ? karaokeActive(timeline, timing.position) : -1;
  const states = karaokeStates(timeline, active);
  // Token indexes grouped: each word with the punctuation that follows it; spaces on their own.
  const groups = useMemo(() => {
    const out: number[][] = [];
    timeline.forEach((t, i) => {
      if (t.kind === 'punct' && out.length && timeline[out[out.length - 1][0]].kind !== 'space') out[out.length - 1].push(i);
      else out.push([i]);
    });
    return out;
  }, [timeline]);

  const tap = (word: string) => (e: React.MouseEvent) => {
    const item = itemForText(word);
    if (!item) return;
    e.stopPropagation();
    onExplore?.();
    explorer.open(item, { source: 'clips', onClosed: onExplorerClosed });
  };

  return (
    <span
      className={`clip-karaoke${timing ? ' is-live' : ''}${reduced ? ' reduced' : ''} ${className}`}
      lang={lang === 'zh' ? 'zh-CN' : 'en'}
      data-testid={testId}
      data-active={active}
    >
      {groups.map((g) => (
        // A word and the punctuation after it never break apart (no line starting with "，").
        <span key={g[0]} className="k-group">
          {g.map((i) => {
            const t = timeline[i];
            if (t.kind !== 'word') return <span key={i} className={`k-punct k-${states[i]}`}>{t.text}</span>;
            const han = HAN.test(t.text);
            const isActive = states[i] === 'active';
            return (
              <span
                key={isActive ? `a${i}` : i}
                className={`k-word k-${states[i]}${han ? ' k-zh' : ''}`}
                data-state={states[i]}
                onClick={han ? tap(t.text) : undefined}
                role={han ? 'button' : undefined}
              >
                {t.text}
                {isActive && pinyin && han && <span className="k-py" aria-hidden="true">{devicePinyinLine(t.text)}</span>}
              </span>
            );
          })}
        </span>
      ))}
    </span>
  );
}
