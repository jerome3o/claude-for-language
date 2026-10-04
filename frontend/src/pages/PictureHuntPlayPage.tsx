import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  PICTURE_HUNT_DEFAULT_SECONDS, huntFeedback, hintText, labelAnchor, matchHuntAnswer, objectAt, pickHintTarget,
  type HuntFeedback, type HuntObject, type HuntRegion,
} from '@shared/picture-hunt';
import type { LocalPictureHunt } from '../db/database';
import { getHuntImage, loadHunt, recordHuntPlay } from '../services/pictureHunts';
import { getTTSWithCache } from '../services/ttsCache';
import { createAudioPlayer } from '../utils/audioPlayback';
import { Confetti } from '../components/Confetti';
import { AddChunkModal } from '../components/AddChunkModal';
import { useNetwork } from '../contexts/NetworkContext';
import { track } from '../services/analytics';
import './PictureHuntPage.css';

type Phase = 'playing' | 'reveal';
type EndReason = 'all' | 'time' | 'gave_up';

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function RegionShape({ region, className }: { region: HuntRegion; className: string }) {
  if (region.polygon && region.polygon.length >= 3) {
    return <polygon className={className} points={region.polygon.map(([x, y]) => `${x},${y}`).join(' ')} vectorEffect="non-scaling-stroke" />;
  }
  const { x, y, w, h } = region.box;
  return <rect className={className} x={x} y={y} width={w} height={h} rx={0.008} vectorEffect="non-scaling-stroke" />;
}

function useSpeaker() {
  const playerRef = useRef(createAudioPlayer());
  useEffect(() => {
    const player = playerRef.current;
    return () => player.dispose();
  }, []);
  return useCallback((text: string) => {
    const playId = playerRef.current.claim();
    void getTTSWithCache(text).then((blob) => {
      if (!blob || !playerRef.current.isCurrent(playId)) return;
      playerRef.current.play(blob, { label: 'picture-hunt' });
    });
  }, []);
}

/** The tap-to-inspect sheet: names, sound, and + Add as card. */
function ObjectSheet({ obj, found, onClose, onAdd, speak, online }: {
  obj: HuntObject; found: boolean; onClose: () => void; onAdd: () => void; speak: (t: string) => void; online: boolean;
}) {
  return (
    <div className="ph-sheet-backdrop" onClick={onClose}>
      <div className="ph-sheet" role="dialog" aria-label={obj.hanzi} onClick={(e) => e.stopPropagation()}>
        <div className="ph-sheet-grip" />
        <div className="ph-sheet-head">
          <div>
            <div className="ph-sheet-hanzi">{obj.hanzi}</div>
            <div className="ph-sheet-pinyin">{obj.pinyin}</div>
            <div className="ph-sheet-english">{obj.english}</div>
          </div>
          <button className="ph-speak" onClick={() => speak(obj.hanzi)} aria-label={`Play ${obj.hanzi}`}>▶</button>
        </div>
        <div className={`ph-sheet-status ${found ? 'found' : 'missed'}`}>{found ? '✓ You found this one' : 'Not found this time'}</div>
        {obj.alternatives.length > 0 && <div className="ph-sheet-line"><strong>Also:</strong> {obj.alternatives.join('、')}</div>}
        {obj.sentence_clue && (
          <button className="ph-sheet-sentence" onClick={() => speak(obj.sentence_clue!)}>
            <span className="ph-sheet-sentence-zh">▶ {obj.sentence_clue}</span>
            {obj.sentence_clue_pinyin && <span className="ph-sheet-sentence-py">{obj.sentence_clue_pinyin}</span>}
            {obj.sentence_clue_translation && <span className="ph-sheet-sentence-en">{obj.sentence_clue_translation}</span>}
          </button>
        )}
        {obj.fun_facts && <div className="ph-sheet-facts">{obj.fun_facts}</div>}
        <div className="ph-sheet-actions">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={onAdd} disabled={!online} title={online ? undefined : 'Adding a card needs a connection'}>+ Add as card</button>
        </div>
        {!online && <div className="ph-note">Adding a card needs a connection.</div>}
      </div>
    </div>
  );
}

export function PictureHuntPlayPage() {
  const { id = '' } = useParams();
  const { isOnline } = useNetwork();
  const speak = useSpeaker();
  const [hunt, setHunt] = useState<LocalPictureHunt | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [aspect, setAspect] = useState<number>(4 / 3);

  const [phase, setPhase] = useState<Phase>('playing');
  const [endReason, setEndReason] = useState<EndReason | null>(null);
  const [found, setFound] = useState<string[]>([]);
  const [lastFound, setLastFound] = useState<string | null>(null);
  const [hints, setHints] = useState<Record<string, number>>({});
  const [hintsUsed, setHintsUsed] = useState(0);
  const [hint, setHint] = useState<{ id: string; text: string } | null>(null);
  const [feedback, setFeedback] = useState<HuntFeedback | null>(null);
  const [value, setValue] = useState('');
  const [remaining, setRemaining] = useState(PICTURE_HUNT_DEFAULT_SECONDS);
  const [inspect, setInspect] = useState<HuntObject | null>(null);
  const [adding, setAdding] = useState<HuntObject | null>(null);
  const [zoom, setZoom] = useState(1);
  const [bestBefore, setBestBefore] = useState<number | null>(null);

  const startedAt = useRef(Date.now());
  const playId = useRef(crypto.randomUUID());
  const recorded = useRef(false);
  const composing = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);

  const objects = useMemo(() => hunt?.objects ?? [], [hunt]);
  const total = objects.length;

  useEffect(() => {
    let cancelled = false;
    loadHunt(id)
      .then((h) => {
        if (cancelled) return;
        if (!h || h.status !== 'ready' || !h.objects) {
          setLoadError(navigator.onLine ? 'This hunt isn\'t ready yet.' : 'This hunt isn\'t on this device yet — open it once while online.');
          return;
        }
        setHunt(h);
        setBestBefore(h.best_found);
        if (h.image_width && h.image_height) setAspect(h.image_width / h.image_height);
      })
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : 'Couldn\'t load this hunt'));
    let url: string | null = null;
    void getHuntImage(id).then((blob) => {
      if (!blob || cancelled) return;
      url = URL.createObjectURL(blob);
      setImageUrl(url);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  const endGame = useCallback((reason: EndReason, foundNow: string[]) => {
    setPhase('reveal');
    setEndReason(reason);
    setHint(null);
    if (recorded.current || !hunt) return;
    recorded.current = true;
    track('picture_hunt.play_done', { found: foundNow.length, total, gave_up: reason !== 'all' });
    void recordHuntPlay({
      id: playId.current,
      hunt_id: hunt.id,
      found_ids: foundNow,
      total,
      hints_used: hintsUsed,
      gave_up: reason !== 'all',
      duration_ms: Date.now() - startedAt.current,
      played_at: new Date().toISOString(),
    });
  }, [hunt, total, hintsUsed]);

  // The soft timer: when it runs out, everything is revealed.
  useEffect(() => {
    if (phase !== 'playing' || !hunt) return;
    const t = window.setInterval(() => {
      const left = PICTURE_HUNT_DEFAULT_SECONDS - (Date.now() - startedAt.current) / 1000;
      setRemaining(left);
      if (left <= 0) endGame('time', found);
    }, 500);
    return () => window.clearInterval(t);
  }, [phase, hunt, found, endGame]);

  function accept(objectId: string, fb: HuntFeedback | null) {
    const next = [...found, objectId];
    setFound(next);
    setLastFound(objectId);
    setFeedback(fb);
    setValue('');
    if (hint?.id === objectId) setHint(null);
    if (navigator.vibrate) navigator.vibrate(30);
    if (next.length === total) window.setTimeout(() => endGame('all', next), 600);
  }

  /** Every committed value is checked; a find is taken at once (no Enter needed with an IME). */
  function autoCheck(text: string) {
    if (phase !== 'playing') return;
    const match = matchHuntAnswer(text, objects, found);
    if (match.kind === 'found') accept(match.objectId, huntFeedback(match, objects));
  }

  function submit() {
    if (phase !== 'playing') return;
    const match = matchHuntAnswer(value, objects, found);
    if (match.kind === 'found') {
      accept(match.objectId, huntFeedback(match, objects));
      return;
    }
    setFeedback(huntFeedback(match, objects));
    if (match.kind === 'already') setValue('');
    else inputRef.current?.select();
  }

  function giveHint() {
    const target = pickHintTarget(objects, found, hints);
    if (!target) return;
    const level = (hints[target.id] ?? 0) + 1;
    setHints({ ...hints, [target.id]: level });
    setHintsUsed(hintsUsed + 1);
    setHint({ id: target.id, text: hintText(target, level) });
    inputRef.current?.focus();
  }

  function playAgain() {
    setPhase('playing');
    setEndReason(null);
    setFound([]);
    setLastFound(null);
    setHints({});
    setHintsUsed(0);
    setHint(null);
    setFeedback(null);
    setValue('');
    setInspect(null);
    setBestBefore(hunt?.best_found ?? null);
    startedAt.current = Date.now();
    playId.current = crypto.randomUUID();
    recorded.current = false;
    setRemaining(PICTURE_HUNT_DEFAULT_SECONDS);
    void loadHunt(id).then((h) => h && setHunt(h));
  }

  // ---- pinch to zoom (two pointers); one finger scrolls the zoomed picture natively
  function onPointerDown(e: React.PointerEvent) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom };
    }
  }
  function onPointerMove(e: React.PointerEvent) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Zoomed in, one finger pans the picture (the stage has touch-action: none then).
    if (pointers.current.size === 1 && zoom > 1 && stageRef.current) {
      stageRef.current.scrollLeft -= e.clientX - prev.x;
      stageRef.current.scrollTop -= e.clientY - prev.y;
      return;
    }
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = Array.from(pointers.current.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current.dist > 0) setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinch.current.zoom * (dist / pinch.current.dist))));
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  function onPictureClick(e: React.MouseEvent) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const hit = objectAt(phase === 'reveal' ? objects : objects.filter((o) => found.includes(o.id)), x, y);
    if (hit) setInspect(hit);
  }

  if (loadError) {
    return (
      <div className="ph-play ph-play-message">
        <p>{loadError}</p>
        <Link className="btn btn-primary" to="/picture-hunt">Back to picture hunts</Link>
      </div>
    );
  }
  if (!hunt) return <div className="ph-play ph-play-message"><p>Loading…</p></div>;

  const foundSet = new Set(found);
  const hintedId = phase === 'playing' ? hint?.id : null;
  const best = Math.max(bestBefore ?? 0, phase === 'reveal' ? found.length : 0);
  const newBest = phase === 'reveal' && found.length > (bestBefore ?? 0) && found.length > 0;

  return (
    <div className="ph-play">
      <header className="ph-bar">
        <Link to="/picture-hunt" className="ph-bar-close" aria-label="Close">✕</Link>
        <div className="ph-bar-title">{hunt.title}</div>
        {phase === 'playing' && <div className={`ph-clock ${remaining < 30 ? 'low' : ''}`} aria-label="Time left">⏱ {formatClock(remaining)}</div>}
        <div className="ph-score" aria-label="Score">{found.length} / {total}</div>
      </header>

      {endReason === 'all' && <Confetti />}

      <div className="ph-layout">
        <div className="ph-picture-col">
          <div
            ref={stageRef}
            className={`ph-stage ${zoom > 1 ? 'zoomed' : ''}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <div
              ref={canvasRef}
              className="ph-canvas"
              style={{ width: `${zoom * 100}%`, aspectRatio: String(aspect) }}
              onClick={onPictureClick}
            >
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={hunt.title}
                  draggable={false}
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    if (img.naturalWidth && img.naturalHeight) setAspect(img.naturalWidth / img.naturalHeight);
                  }}
                />
              ) : (
                <div className="ph-image-missing">{isOnline ? 'Loading the picture…' : 'The picture isn\'t on this device yet'}</div>
              )}
              <svg className="ph-overlay" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
                {objects.map((obj) => {
                  const isFound = foundSet.has(obj.id);
                  const cls = isFound
                    ? `ph-shape found${obj.id === lastFound && phase === 'playing' ? ' fresh' : ''}`
                    : obj.id === hintedId
                      ? 'ph-shape hinted'
                      : phase === 'reveal'
                        ? 'ph-shape missed'
                        : null;
                  return cls ? obj.regions.map((r, i) => <RegionShape key={`${obj.id}-${i}`} region={r} className={cls} />) : null;
                })}
              </svg>
              {objects.map((obj) => {
                const isFound = foundSet.has(obj.id);
                if (!isFound && phase !== 'reveal') return null;
                const anchor = labelAnchor(obj.regions[0]);
                return (
                  <span
                    key={`label-${obj.id}`}
                    className={`ph-label ${isFound ? 'found' : 'missed'} ${anchor.above ? 'above' : 'below'}`}
                    style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }}
                  >
                    {obj.hanzi}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="ph-zoom">
            <button onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - 0.5))} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out">−</button>
            <span>{zoom === 1 ? 'Pinch or tap + to zoom' : `${zoom.toFixed(1)}×`}</span>
            <button onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + 0.5))} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in">+</button>
          </div>
        </div>

        <div className="ph-side">
          {phase === 'playing' ? (
            <>
              <form
                className="ph-answer"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!composing.current) submit();
                }}
              >
                <input
                  ref={inputRef}
                  className="ph-input"
                  value={value}
                  lang="zh-CN"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  enterKeyHint="done"
                  placeholder="Type what you see… 杯子"
                  aria-label="What do you see?"
                  onChange={(e) => {
                    setValue(e.target.value);
                    const native = e.nativeEvent as InputEvent;
                    if (!composing.current && !native.isComposing) autoCheck(e.target.value);
                  }}
                  onCompositionStart={() => { composing.current = true; }}
                  onCompositionEnd={(e) => {
                    composing.current = false;
                    autoCheck(e.currentTarget.value);
                  }}
                />
                <button type="submit" className="btn btn-primary ph-go">Check</button>
              </form>
              <div className={`ph-feedback ${feedback?.tone ?? ''}`} role="status" aria-live="polite">
                {feedback?.text ?? (hint ? '' : 'Every thing you name lights up on the picture.')}
              </div>
              {hint && <div className="ph-hint" role="status">💡 {hint.text}</div>}
              <div className="ph-actions">
                <button className="btn btn-secondary" onClick={giveHint} disabled={found.length === total}>💡 Hint</button>
                <button className="btn btn-secondary" onClick={() => endGame('gave_up', found)}>🏳 Give up</button>
              </div>
            </>
          ) : (
            <div className="ph-result">
              <div className="ph-result-score">{found.length} / {total} found</div>
              <div className="ph-result-sub">
                {endReason === 'all' ? '全部找到了！Everything found.' : endReason === 'time' ? 'Time\'s up.' : 'Here\'s everything.'}
                {' '}{newBest ? '🏆 New best!' : best ? `Best ${best} / ${total}.` : ''}
              </div>
              <div className="ph-result-tip">Tap anything on the picture to hear it and add it as a card.</div>
              <button className="btn btn-primary" onClick={playAgain}>↻ Play again</button>
            </div>
          )}

          <ul className="ph-found-list" aria-label={phase === 'reveal' ? 'All objects' : 'Found'}>
            {(phase === 'reveal' ? [...objects].sort((a, b) => Number(foundSet.has(b.id)) - Number(foundSet.has(a.id))) : found.map((f) => objects.find((o) => o.id === f)!).reverse())
              .filter(Boolean)
              .map((obj) => (
                <li key={obj.id}>
                  <button className={`ph-found-chip ${foundSet.has(obj.id) ? 'found' : 'missed'}`} onClick={() => setInspect(obj)}>
                    <span className="zh">{obj.hanzi}</span>
                    <span className="py">{obj.pinyin}</span>
                  </button>
                </li>
              ))}
          </ul>
        </div>
      </div>

      {inspect && (
        <ObjectSheet
          obj={inspect}
          found={foundSet.has(inspect.id)}
          online={isOnline}
          speak={speak}
          onClose={() => setInspect(null)}
          onAdd={() => {
            setAdding(inspect);
            setInspect(null);
          }}
        />
      )}
      {adding && (
        <AddChunkModal source="picture_hunt"
          chunk={{
            hanzi: adding.hanzi,
            pinyin: adding.pinyin,
            english: adding.english,
            fun_facts: adding.fun_facts,
            sentence_clue: adding.sentence_clue,
            sentence_clue_pinyin: adding.sentence_clue_pinyin,
            sentence_clue_translation: adding.sentence_clue_translation,
          }}
          onClose={() => setAdding(null)}
        />
      )}
    </div>
  );
}
