/**
 * 🎬 The interactive scenes of a clip (docs/CLIPS.md "Interactive scenes"): quiz, listen, order,
 * reveal, speak. The clip clock stops on them (shared/clips/playback.ts) and an obvious prompt
 * says what to do — "👆 Tap an answer", "🎧 Listen, then tap what it means", "👆 Tap the words in
 * order", "🤔 Say it in your head — then tap to flip", "🎤 Your turn — say it" — with big targets,
 * instant feedback (✓ / ✗, a sound, a buzz) and the answer; Skip after a while, "Next ›" once
 * answered. Swiping to another clip always works (nothing here takes a vertical drag).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  clipOrderShuffle,
  clipQuizRight,
  clipSkipShown,
  clipOrderSentence,
  type ClipPlayState,
  type ClipScene,
  type ClipSpec,
} from '@shared/clips';
import {
  COACH_PRACTISE_CHECKING,
  COACH_PRACTISE_EMPTY,
  COACH_PRACTISE_LISTENING,
  COACH_PRACTISE_STOP,
  practiseBlockNote,
  practiseMicEnabled,
  practiseSentence,
  type PractisedSentence,
} from '@shared/coach';
import { useVoiceDictation } from '../../hooks/useVoiceDictation';
import { YouSaidRow } from '../study/YouSaid';
import { devicePinyinLine } from '../../utils/autoPinyin';
import { Mixed, Zh, type SceneCtx } from './ClipScenes';
import { KaraokeLine, type SpeechClock } from './Karaoke';

const HAN = /\p{Script=Han}/u;

export interface InteractActions {
  onOption: (option: number) => void;
  onOrder: (order: number[]) => void;
  onFlip: () => void;
  onSpeak: (p: PractisedSentence) => void;
  onSkip: () => void;
  onContinue: () => void;
  /** Hear the scene's line again (listen / speak). */
  onReplay: () => void;
}

export interface InteractProps {
  spec: ClipSpec;
  clipId: string;
  scene: ClipScene;
  index: number;
  play: ClipPlayState;
  ctx: SceneCtx;
  muted: boolean;
  clock: SpeechClock | null;
  actions: InteractActions;
  emoji: ReactNode;
}

/** The prompt while the scene waits; Skip after a while; "Next ›" once answered. */
function InteractBar({ play, hint, actions, testId }: { play: ClipPlayState; hint: string; actions: InteractActions; testId: string }) {
  const waiting = play.interact?.result === null;
  return (
    <div className="clip-interact-bar" data-no-gesture>
      {waiting ? (
        <div className="clip-interact-hint" role="status" data-testid={`${testId}-hint`}>{hint}</div>
      ) : (
        <button type="button" className="clip-btn clip-next-scene" onClick={actions.onContinue} data-testid="clip-continue">Next ›</button>
      )}
      {waiting && clipSkipShown(play) && (
        <button type="button" className="clip-btn clip-skip" onClick={actions.onSkip} data-testid="clip-skip">Skip ›</button>
      )}
    </div>
  );
}

function verdictText(result: string | null | undefined): string {
  switch (result) {
    case 'right':
      return '✓ Right!';
    case 'close':
      return '≈ Nearly — listen again';
    case 'wrong':
      return '✗ Not quite';
    case 'skipped':
      return '→ Here’s the answer';
    default:
      return '';
  }
}

function Options({ options, answer, play, ctx, onOption, han }: { options: string[]; answer: number; play: ClipPlayState; ctx: SceneCtx; onOption: (i: number) => void; han: boolean }) {
  const state = play.interact;
  const answered = !!state && state.result !== null;
  return (
    <div className={`clip-options${answered ? '' : ' waiting'}${han ? '' : ' en'}`} role="group" aria-label="Choose an answer" data-no-gesture>
      {options.map((o, i) => {
        const isAnswer = i === answer;
        const picked = state?.picked === i;
        const cls = answered && isAnswer ? ' right' : picked && !isAnswer ? ' wrong' : '';
        return (
          <button
            type="button"
            key={i}
            className={`clip-option${cls}`}
            disabled={answered}
            onClick={(e) => {
              e.stopPropagation();
              onOption(i);
            }}
            data-testid="clip-quiz-option"
          >
            {answered && isAnswer && <span className="clip-mark-icon" aria-hidden="true">✓</span>}
            {picked && !isAnswer && <span className="clip-mark-icon" aria-hidden="true">✗</span>}
            <span>{o}</span>
            {ctx.pinyin && HAN.test(o) && <span className="clip-option-py">{devicePinyinLine(o)}</span>}
            {answered && isAnswer && <span className="clip-option-py">answer</span>}
          </button>
        );
      })}
    </div>
  );
}

export function QuizView({ spec, scene, play, ctx, actions, emoji }: InteractProps & { scene: Extract<ClipScene, { layout: 'quiz' }> }) {
  const q = scene.quiz;
  const answered = !!play.interact && play.interact.result !== null;
  const right = clipQuizRight(spec, play);
  const answer = q.options[q.answer_index];
  const prompt = q.prompt_zh ? q.prompt_zh.split(/_{2,}|＿+/) : null;
  return (
    <>
      {emoji}
      {prompt && (
        <div className="clip-quiz-prompt" data-testid="clip-quiz-prompt">
          {prompt.map((part, i) => (
            <span key={i}>
              {part && <Zh text={part} ctx={ctx} />}
              {i < prompt.length - 1 && <span className={`clip-blank${answered ? ' filled' : ''}`}>{answered ? answer : '?'}</span>}
            </span>
          ))}
          {ctx.pinyin && <div className="clip-pinyin">{devicePinyinLine(answered ? q.prompt_zh!.replace(/_{2,}|＿+/, answer) : q.prompt_zh!.replace(/_{2,}|＿+/, ' ___ '))}</div>}
        </div>
      )}
      {q.prompt_en && (ctx.english || !q.prompt_zh) && <div className="clip-en">{q.prompt_en}</div>}
      <Options options={q.options} answer={q.answer_index} play={play} ctx={ctx} onOption={actions.onOption} han={q.options.some((o) => HAN.test(o))} />
      {answered && (
        <div className={`clip-verdict ${right === true ? 'is-right' : 'is-wrong'}`} role="status" data-testid="clip-quiz-verdict">
          {right === true ? '✓ Right!' : right === false ? '✗ Not quite' : verdictText(play.interact?.result)}
        </div>
      )}
      {answered && q.explain && <div className="clip-explain"><Mixed text={q.explain} ctx={ctx} /></div>}
      <InteractBar play={play} hint="👆 Tap an answer" actions={actions} testId="clip-quiz" />
    </>
  );
}

export function ListenView({ spec, scene, play, ctx, actions, muted, clock, emoji }: InteractProps & { scene: Extract<ClipScene, { layout: 'listen' }> }) {
  const l = scene.listen;
  const answered = !!play.interact && play.interact.result !== null;
  const right = clipQuizRight(spec, play);
  const [peek, setPeek] = useState(false);
  const shown = answered || peek;
  return (
    <>
      {emoji ?? <div className="clip-emoji" aria-hidden="true">🎧</div>}
      <button type="button" className={`clip-listen-play${clock?.line === 0 ? ' playing' : ''}`} onClick={actions.onReplay} disabled={muted} data-no-gesture data-testid="clip-listen-play" aria-label="Play it again">
        <span aria-hidden="true">{clock?.line === 0 ? '🔊' : '▶'}</span> {muted ? 'Sound is off' : 'Play again'}
      </button>
      {muted && !shown && (
        <div className="clip-listen-muted" data-no-gesture>
          <span>🔇 Turn the sound on to hear it — or</span>
          <button type="button" className="clip-btn" onClick={() => setPeek(true)} data-testid="clip-listen-peek">Show the Chinese</button>
        </div>
      )}
      {shown ? (
        <div className="clip-card clip-listen-text" data-testid="clip-listen-text">
          <div className="clip-sentence-zh"><KaraokeLine text={l.hanzi} lang="zh" clock={clock} pinyin={ctx.pinyin} onExplore={ctx.onExplore} onExplorerClosed={ctx.onExplorerClosed} /></div>
          {ctx.pinyin && <div className="clip-pinyin">{l.pinyin}</div>}
          {answered && <div className="clip-en">{l.english}</div>}
        </div>
      ) : (
        <div className="clip-listen-hidden" aria-label="The sentence is hidden — listen" data-testid="clip-listen-hidden">
          {[...l.hanzi].slice(0, 14).map((_, i) => <span key={i} className={clock?.line === 0 ? 'wave' : ''} style={{ animationDelay: `${i * 60}ms` }} />)}
        </div>
      )}
      {l.prompt_en && <div className="clip-quiz-prompt clip-listen-prompt">{l.prompt_en}</div>}
      <Options options={l.options} answer={l.answer_index} play={play} ctx={ctx} onOption={actions.onOption} han={l.options.some((o) => HAN.test(o))} />
      {answered && (
        <div className={`clip-verdict ${right === true ? 'is-right' : 'is-wrong'}`} role="status" data-testid="clip-quiz-verdict">
          {right === true ? '✓ Right!' : right === false ? '✗ Not quite' : verdictText(play.interact?.result)}
        </div>
      )}
      {answered && l.explain && <div className="clip-explain"><Mixed text={l.explain} ctx={ctx} /></div>}
      <InteractBar play={play} hint="🎧 Listen, then tap what it means" actions={actions} testId="clip-listen" />
    </>
  );
}

export function OrderView({ clipId, scene, index, play, ctx, actions, clock, emoji }: InteractProps & { scene: Extract<ClipScene, { layout: 'order' }> }) {
  const o = scene.order;
  const offered = useMemo(() => clipOrderShuffle(o.tiles, `${clipId}:${index}`), [o.tiles, clipId, index]);
  const [picked, setPicked] = useState<number[]>([]);
  const answered = !!play.interact && play.interact.result !== null;
  const result = play.interact?.result ?? null;
  const sentence = clipOrderSentence(o.tiles);
  const sent = useRef(false);

  useEffect(() => {
    if (picked.length === o.tiles.length && !answered && !sent.current) {
      sent.current = true;
      actions.onOrder(picked);
    }
  }, [picked, o.tiles.length, answered, actions]);

  const place = (tile: number) => {
    if (answered) return;
    setPicked((p) => (p.includes(tile) ? p : [...p, tile]));
  };
  const unplace = (tile: number) => {
    if (answered) return;
    setPicked((p) => p.filter((t) => t !== tile));
  };

  return (
    <>
      {emoji}
      {o.prompt_en && <div className="clip-quiz-prompt clip-order-prompt">{o.prompt_en}</div>}
      <div className={`clip-order-slots${answered ? ` is-${result}` : ''}`} aria-label="Your sentence" data-testid="clip-order-answer" data-no-gesture>
        {answered && result !== 'right' ? (
          <span className="clip-order-correct"><KaraokeLine text={sentence} lang="zh" clock={clock} pinyin={ctx.pinyin} onExplore={ctx.onExplore} onExplorerClosed={ctx.onExplorerClosed} /></span>
        ) : picked.length === 0 ? (
          <span className="clip-order-empty">Tap the words below…</span>
        ) : answered ? (
          <span className="clip-order-correct"><KaraokeLine text={sentence} lang="zh" clock={clock} pinyin={ctx.pinyin} onExplore={ctx.onExplore} onExplorerClosed={ctx.onExplorerClosed} /></span>
        ) : (
          picked.map((t) => (
            <button type="button" key={t} className="clip-tile placed" onClick={() => unplace(t)} data-testid="clip-order-placed">
              {o.tiles[t]}
            </button>
          ))
        )}
      </div>
      {answered && result !== 'right' && picked.length > 0 && (
        <div className="clip-order-yours" aria-label="What you built">
          <s>{picked.map((t) => o.tiles[t]).join('')}</s>
        </div>
      )}
      {!answered && (
        <div className="clip-order-tiles" role="group" aria-label="Words to put in order" data-no-gesture>
          {offered.map((t) => (
            <button
              type="button"
              key={t}
              className={`clip-tile${picked.includes(t) ? ' used' : ''}`}
              disabled={picked.includes(t)}
              onClick={() => place(t)}
              data-testid="clip-order-tile"
            >
              <span>{o.tiles[t]}</span>
              {ctx.pinyin && HAN.test(o.tiles[t]) && <small>{devicePinyinLine(o.tiles[t])}</small>}
            </button>
          ))}
        </div>
      )}
      {answered && (
        <>
          <div className={`clip-verdict ${result === 'right' ? 'is-right' : 'is-wrong'}`} role="status" data-testid="clip-quiz-verdict">{verdictText(result)}</div>
          {ctx.pinyin && <div className="clip-pinyin">{o.pinyin}</div>}
          <div className="clip-en">{o.english}</div>
        </>
      )}
      <InteractBar play={play} hint="👆 Tap the words in order" actions={actions} testId="clip-order" />
    </>
  );
}

export function RevealView({ scene, play, ctx, actions, clock, emoji }: InteractProps & { scene: Extract<ClipScene, { layout: 'reveal' }> }) {
  const r = scene.reveal;
  const flipped = !!play.interact && play.interact.result !== null;
  return (
    <>
      {emoji}
      <button
        type="button"
        className={`clip-flip${flipped ? ' flipped' : ''}`}
        onClick={() => !flipped && actions.onFlip()}
        aria-label={flipped ? r.hanzi : `${r.prompt_en} — tap to see the Chinese`}
        data-no-gesture
        data-testid="clip-reveal-card"
      >
        <span className="clip-flip-inner">
          <span className="clip-flip-face front">
            <span className="clip-flip-tag">English</span>
            <span className="clip-flip-en">{r.prompt_en}</span>
            <span className="clip-flip-cta">Tap to flip ↻</span>
          </span>
          <span className="clip-flip-face back">
            <span className="clip-flip-tag">中文</span>
            <span className="clip-flip-zh">{flipped && <KaraokeLine text={r.hanzi} lang="zh" clock={clock} pinyin={false} onExplore={ctx.onExplore} onExplorerClosed={ctx.onExplorerClosed} testId="clip-reveal-zh" />}</span>
            <span className="clip-pinyin">{r.pinyin}</span>
          </span>
        </span>
      </button>
      {flipped && r.note && <div className="clip-explain"><Mixed text={r.note} ctx={ctx} /></div>}
      <InteractBar play={play} hint="🤔 Say it in Chinese in your head — then tap to flip" actions={actions} testId="clip-reveal" />
    </>
  );
}

export function SpeakView({ scene, play, ctx, actions, muted, clock, emoji }: InteractProps & { scene: Extract<ClipScene, { layout: 'speak' }> }) {
  const s = scene.speak;
  const answered = !!play.interact && play.interact.result !== null;
  const [result, setResult] = useState<PractisedSentence | null>(null);
  const target = useRef(s.hanzi);
  target.current = s.hanzi;
  const onSpeak = useRef(actions.onSpeak);
  onSpeak.current = actions.onSpeak;
  const dictation = useVoiceDictation({
    surface: 'clip_speak',
    value: '',
    onChange: () => {},
    autoSubmit: true,
    onSubmit: (answer) => {
      const p = practiseSentence(answer.text, target.current);
      setResult(p);
      onSpeak.current(p);
    },
  });
  const { state } = dictation;
  const listening = state.phase === 'listening';
  const finishing = state.phase === 'finishing';
  const failed = state.phase === 'failed';
  const blocked = practiseBlockNote(state.blocked);
  const micOk = practiseMicEnabled(state.blocked);
  // The clip leaving the scene stops a take.
  const stop = useRef(dictation.stop);
  stop.current = dictation.stop;
  useEffect(() => () => stop.current(), []);

  return (
    <>
      {emoji ?? <div className="clip-emoji" aria-hidden="true">🎤</div>}
      {s.prompt_en && <div className="clip-quiz-prompt clip-speak-prompt">{s.prompt_en}</div>}
      <div className="clip-card clip-speak-card">
        <div className="clip-sentence-zh"><KaraokeLine text={s.hanzi} lang="zh" clock={clock} pinyin={ctx.pinyin} onExplore={ctx.onExplore} onExplorerClosed={ctx.onExplorerClosed} /></div>
        {ctx.pinyin && <div className="clip-pinyin">{s.pinyin}</div>}
        {ctx.english && <div className="clip-en">{s.english}</div>}
      </div>
      <div className="clip-speak-row" data-no-gesture>
        <button type="button" className="clip-btn" onClick={actions.onReplay} disabled={muted} aria-label="Hear it again" data-testid="clip-speak-listen">▶</button>
        {!answered && (
          <button
            type="button"
            className={`clip-btn primary clip-speak-mic${listening ? ' is-listening' : ''}`}
            onClick={() => (listening ? dictation.stop() : finishing ? undefined : (setResult(null), dictation.say()))}
            disabled={!micOk || finishing}
            aria-pressed={listening}
            data-testid="clip-speak-mic"
          >
            {finishing ? COACH_PRACTISE_CHECKING : listening ? `⏹ ${COACH_PRACTISE_STOP}` : failed ? '🔁 Try again' : '🎤 Say it'}
          </button>
        )}
      </div>
      {listening && (
        <div className="clip-speak-live" aria-live="polite" data-testid="clip-speak-live">
          {dictation.finalText || dictation.partialText ? <span lang="zh-CN">{dictation.finalText}{dictation.partialText}</span> : COACH_PRACTISE_LISTENING}
        </div>
      )}
      {result && !listening && (
        <div className="clip-speak-result" data-testid="clip-speak-result">
          <YouSaidRow transcript={result.said} correct={s.hanzi} verdict={result.verdict} testId="clip-speak-said" />
        </div>
      )}
      {failed && !answered && <div className="clip-explain" role="status">{state.failure === 'empty' ? COACH_PRACTISE_EMPTY : 'Couldn’t hear that — tap 🎤 to try again.'}</div>}
      {blocked && !answered && <div className="clip-explain" data-testid="clip-speak-blocked">{blocked}</div>}
      {answered && <div className={`clip-verdict ${play.interact?.result === 'right' ? 'is-right' : 'is-wrong'}`} role="status" data-testid="clip-quiz-verdict">{verdictText(play.interact?.result)}</div>}
      <InteractBar play={blocked && !answered ? { ...play, interact: { ...play.interact!, waited_ms: Number.MAX_SAFE_INTEGER } } : play} hint="🎤 Your turn — say it" actions={actions} testId="clip-speak" />
    </>
  );
}
