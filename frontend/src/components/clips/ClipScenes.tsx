/**
 * 🎬 One scene of a clip, by layout (docs/CLIPS.md "Player"). Every Chinese text is tappable
 * into the language explorer (word by word with the device segmenter); pinyin shows when the 拼
 * caption is on (the spec's pinyin, else device pinyin), English when EN is on. Motion is CSS
 * (clips.css), restarted per scene by its key and paused with the clip.
 */
import type { ReactNode } from 'react';
import {
  storyCast,
  storyLinesShown,
  type ClipPlayState,
  type ClipScene,
  type ClipSpec,
} from '@shared/clips';
import { KaraokeLine, type SpeechClock } from './Karaoke';
import { ListenView, OrderView, QuizView, RevealView, SpeakView, type InteractActions } from './ClipInteractive';
import { ExplorableText } from '../explorer/ExplorableText';
import { useSegmentedWords } from '../../services/chineseSegmenter';
import { devicePinyinLine } from '../../utils/autoPinyin';

export interface SceneCtx {
  pinyin: boolean;
  english: boolean;
  /** A Chinese word was tapped (the clip pauses until the explorer closes). */
  onExplore: () => void;
  onExplorerClosed: () => void;
}

const HAN = /\p{Script=Han}/u;

/** Chinese text, tappable by word. */
export function Zh({ text, ctx, className }: { text: string; ctx: SceneCtx; className?: string }) {
  const words = useSegmentedWords(text, HAN.test(text));
  if (!HAN.test(text)) return <span className={className}>{text}</span>;
  return <ExplorableText text={text} segments={words} source="clips" className={className} onTap={ctx.onExplore} onClosed={ctx.onExplorerClosed} />;
}

/** Text that may mix English and Chinese (rule_en, explain, text_en): the Chinese runs tappable. */
export function Mixed({ text, ctx }: { text: string; ctx: SceneCtx }) {
  const parts = text.split(/(\p{Script=Han}[\p{Script=Han}，、。？！]*)/u).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => (HAN.test(p) ? <Zh key={i} text={p} ctx={ctx} className="clip-zh" /> : <span key={i}>{p}</span>))}
    </>
  );
}

function Py({ text, pinyin, ctx, className = 'clip-pinyin' }: { text: string; pinyin?: string; ctx: SceneCtx; className?: string }) {
  if (!ctx.pinyin || !HAN.test(text)) return null;
  const line = pinyin?.trim() || devicePinyinLine(text);
  return line ? <div className={className}>{line}</div> : null;
}

function En({ text, ctx, className = 'clip-en' }: { text?: string; ctx: SceneCtx; className?: string }) {
  if (!ctx.english || !text) return null;
  return <div className={className}>{text}</div>;
}

export function SceneView({ spec, clipId, scene, index, play, ctx, spokenLine, clock, muted, actions }: {
  spec: ClipSpec;
  clipId: string;
  scene: ClipScene;
  index: number;
  play: ClipPlayState;
  ctx: SceneCtx;
  /** The story line being read aloud (-1 = none). */
  spokenLine: number;
  /** The line being read right now (karaoke). */
  clock: SpeechClock | null;
  muted: boolean;
  actions: InteractActions;
}) {
  const interact = { spec, clipId, index, play, ctx, muted, clock, actions };
  const hook = index === 0 && spec.hook ? <div className="clip-hook" data-testid="clip-hook">{spec.hook}</div> : null;
  const emoji = scene.emoji ? <div className="clip-emoji" aria-hidden="true">{scene.emoji}</div> : null;
  let body: ReactNode = null;
  switch (scene.layout) {
    case 'title': {
      const t = scene.title;
      body = (
        <>
          {emoji}
          {t.headline_zh && (
            <div className="clip-title-zh clip-kinetic">
              <Zh text={t.headline_zh} ctx={ctx} />
            </div>
          )}
          {t.headline_zh && <Py text={t.headline_zh} ctx={ctx} />}
          {t.headline_en && <div className="clip-title-en">{t.headline_en}</div>}
          {t.sub && <div className="clip-title-sub">{t.sub}</div>}
        </>
      );
      break;
    }
    case 'big_word': {
      const w = scene.big_word;
      body = (
        <>
          {emoji}
          {ctx.pinyin && <div className="clip-big-pinyin">{w.pinyin}</div>}
          <div className="clip-big-hanzi">
            <Zh text={w.hanzi} ctx={ctx} />
          </div>
          <En text={w.english} ctx={ctx} className="clip-big-en" />
          {w.breakdown?.length ? (
            <div className="clip-breakdown">
              {w.breakdown.map((b, i) => (
                <span className="clip-chip" key={i}>
                  <b><Zh text={b.char} ctx={ctx} /></b>
                  {ctx.pinyin && <small>{devicePinyinLine(b.char)}</small>}
                  <small>{b.meaning}</small>
                </span>
              ))}
            </div>
          ) : null}
        </>
      );
      break;
    }
    case 'sentence': {
      const s = scene.sentence;
      const at = s.highlight ? s.hanzi.indexOf(s.highlight) : -1;
      body = (
        <>
          {emoji}
          <div className="clip-card">
            <div className="clip-sentence-zh">
              {clock && clock.text === s.hanzi ? (
                <KaraokeLine text={s.hanzi} lang="zh" clock={clock} pinyin={false} onExplore={ctx.onExplore} onExplorerClosed={ctx.onExplorerClosed} />
              ) : at >= 0 ? (
                <>
                  {at > 0 && <Zh text={s.hanzi.slice(0, at)} ctx={ctx} />}
                  <span className="clip-mark"><Zh text={s.highlight!} ctx={ctx} /></span>
                  {at + s.highlight!.length < s.hanzi.length && <Zh text={s.hanzi.slice(at + s.highlight!.length)} ctx={ctx} />}
                </>
              ) : (
                <Zh text={s.hanzi} ctx={ctx} />
              )}
            </div>
            <Py text={s.hanzi} pinyin={s.pinyin} ctx={ctx} />
            <En text={s.english} ctx={ctx} />
          </div>
        </>
      );
      break;
    }
    case 'compare': {
      const c = scene.compare;
      const side = (which: 'left' | 'right') => {
        const x = c[which];
        return (
          <div className={`clip-side clip-card ${which}`} data-testid={`clip-compare-${which}`}>
            <span className="clip-side-tag">{which === 'left' ? 'A' : 'B'}</span>
            <span className="clip-side-hanzi"><Zh text={x.hanzi} ctx={ctx} /></span>
            {ctx.pinyin && <span className="clip-pinyin">{x.pinyin}</span>}
            <En text={x.english} ctx={ctx} />
            {x.example && (
              <div className="clip-ex">
                <Zh text={x.example} ctx={ctx} />
                <Py text={x.example} ctx={ctx} />
              </div>
            )}
          </div>
        );
      };
      body = (
        <>
          {emoji}
          <div className="clip-compare">
            {side('left')}
            <span className="clip-vs" aria-label="versus">VS</span>
            {side('right')}
          </div>
          {c.rule_en && <div className="clip-rule">💡 <Mixed text={c.rule_en} ctx={ctx} /></div>}
        </>
      );
      break;
    }
    case 'quiz':
      body = <QuizView {...interact} scene={scene} emoji={emoji} />;
      break;
    case 'listen':
      body = <ListenView {...interact} scene={scene} emoji={emoji} />;
      break;
    case 'order':
      body = <OrderView {...interact} scene={scene} emoji={emoji} />;
      break;
    case 'reveal':
      body = <RevealView {...interact} scene={scene} emoji={emoji} />;
      break;
    case 'speak':
      body = <SpeakView {...interact} scene={scene} emoji={emoji} />;
      break;
    case 'story': {
      const lines = scene.story.lines;
      const cast = storyCast(lines);
      const shown = storyLinesShown(lines.length, scene.duration_ms, play.elapsed_ms, spokenLine);
      body = (
        <div className="clip-story">
          {emoji}
          {lines.slice(0, shown).map((l, i) => (
            <div className={`clip-bubble-row ${cast.sides[i]}${spokenLine === i ? ' speaking' : ''}`} key={i} data-testid="clip-bubble">
              {l.speaker && cast.sides[i] !== 'center' && <span className="clip-speaker">{l.speaker}</span>}
              <div className="clip-bubble">
                <div className="clip-zh-line">
                  {spokenLine === i && clock && clock.text === l.hanzi ? (
                    <KaraokeLine text={l.hanzi} lang="zh" clock={clock} pinyin={false} onExplore={ctx.onExplore} onExplorerClosed={ctx.onExplorerClosed} />
                  ) : (
                    <Zh text={l.hanzi} ctx={ctx} />
                  )}
                </div>
                <Py text={l.hanzi} pinyin={l.pinyin} ctx={ctx} />
                <En text={l.english} ctx={ctx} />
              </div>
            </div>
          ))}
        </div>
      );
      break;
    }
    case 'list': {
      const l = scene.list;
      body = (
        <>
          {emoji}
          {l.title && (
            <div className="clip-list-title">
              <Mixed text={l.title} ctx={ctx} />
              <Py text={l.title} ctx={ctx} />
            </div>
          )}
          <ol className="clip-list">
            {l.items.map((it, i) => (
              <li key={i}>
                <span className="n">{i + 1}</span>
                <span className="d">
                  <span className="h"><Zh text={it.hanzi} ctx={ctx} /></span>
                  {ctx.pinyin && <span className="clip-pinyin">{it.pinyin}</span>}
                  <En text={it.english} ctx={ctx} />
                </span>
              </li>
            ))}
          </ol>
        </>
      );
      break;
    }
    case 'fact': {
      const f = scene.fact;
      body = (
        <>
          <div className="clip-fact-label">{emoji ? null : '💡 '}Did you know?</div>
          {emoji}
          {f.hanzi && (
            <>
              <div className="clip-fact-hanzi"><Zh text={f.hanzi} ctx={ctx} /></div>
              <Py text={f.hanzi} pinyin={f.pinyin} ctx={ctx} />
            </>
          )}
          <div className="clip-fact-text"><Mixed text={f.text_en} ctx={ctx} /></div>
        </>
      );
      break;
    }
  }
  return (
    <>
      {hook}
      {body}
    </>
  );
}
