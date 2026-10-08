import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  IDIOM_ROLES,
  idiomCardFields,
  idiomQuizScoreLine,
  idiomRegisterLabel,
  idiomSentimentLabel,
  normalizeIdiomHanzi,
  type IdiomEntry,
  type IdiomLine,
  type IdiomRecord,
  type IdiomRef,
} from '@shared/idioms';
import { useNetwork } from '../contexts/NetworkContext';
import { cachedIdiom, fetchIdiom, markIdiomOpened, prefetchIdiomAudio, startIdiom } from '../services/idioms';
import { getTTSWithCache } from '../services/ttsCache';
import { findExistingNotes } from '../services/studyBumps';
import { invalidateKnownHanzi } from '../services/readerWords';
import { track } from '../services/analytics';
import { createAudioPlayer } from '../utils/audioPlayback';
import { useTTS } from '../hooks/useAudio';
import type { LocalNote } from '../db/database';
import { AddChunkModal } from '../components/AddChunkModal';
import { BumpButton } from '../components/bumps/BumpButton';
import { useExplorer } from '../components/explorer/ExplorerContext';
import { ExplorableText } from '../components/explorer/ExplorableText';
import './IdiomsPage.css';

const POLL_MS = 2500;
const POLL_LIMIT_MS = 4 * 60_000;
const TOGGLES_KEY = 'idioms-story-toggles-v1';

type View =
  | { kind: 'loading' }
  | { kind: 'ready'; entry: IdiomEntry }
  | { kind: 'generating' }
  | { kind: 'failed'; message: string }
  | { kind: 'not_idiom'; reason: string; suggestion: string | null }
  | { kind: 'offline' }
  | { kind: 'unavailable'; message: string };

function viewOf(record: IdiomRecord): View | null {
  if (record.status === 'ready' && record.entry) return { kind: 'ready', entry: record.entry };
  if (record.status === 'generating') return { kind: 'generating' };
  if (record.status === 'not_idiom') return { kind: 'not_idiom', reason: record.error ?? '', suggestion: record.suggestion };
  if (record.status === 'failed') return { kind: 'failed', message: record.error ?? 'Something went wrong — try again.' };
  return null;
}

function readToggles(): { pinyin: boolean; english: boolean } {
  try {
    const raw = localStorage.getItem(TOGGLES_KEY);
    if (raw) return { pinyin: false, english: false, ...JSON.parse(raw) };
  } catch {
    /* default */
  }
  return { pinyin: false, english: false };
}

/** One audio player for the page: a clip at a time, keyed so the button shows ■ while it plays. */
function usePagePlayer() {
  const player = useRef(createAudioPlayer());
  const tts = useTTS();
  const [playing, setPlaying] = useState<string | null>(null);
  const queue = useRef<string[]>([]);

  useEffect(() => {
    const p = player.current;
    return () => p.dispose();
  }, []);

  const stop = useCallback(() => {
    queue.current = [];
    player.current.stop();
    setPlaying(null);
  }, []);

  const playOne = useCallback(async (key: string, text: string, then?: () => void) => {
    setPlaying(key);
    const id = player.current.claim();
    const blob = await getTTSWithCache(text).catch(() => null);
    if (!player.current.isCurrent(id)) return;
    if (!blob) {
      tts.speak(text);
      setPlaying(null);
      return;
    }
    player.current.play(blob, {
      onEnded: () => (then ? then() : setPlaying(null)),
      onError: () => setPlaying(null),
    });
  }, [tts]);

  const play = useCallback((key: string, text: string) => {
    if (playing === key) return stop();
    queue.current = [];
    void playOne(key, text);
  }, [playing, playOne, stop]);

  /** Several clips back to back (the whole story). */
  const playAll = useCallback((key: string, texts: string[]) => {
    if (playing?.startsWith(key)) return stop();
    queue.current = [...texts];
    const next = (i: number) => {
      const text = queue.current.shift();
      if (!text) return setPlaying(null);
      void playOne(`${key}:${i}`, text, () => next(i + 1));
    };
    next(0);
  }, [playing, playOne, stop]);

  return { playing, play, playAll, stop };
}

function PlayButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" className={`idiom-play${active ? ' playing' : ''}`} onClick={onClick} aria-label={label}>
      {active ? '■' : '▶'}
    </button>
  );
}

/** An example sentence: listen first — taps uncover the Chinese, then the pinyin, then the English. */
function ExampleRow({ line, index, playing, onPlay }: { line: IdiomLine; index: number; playing: boolean; onPlay: () => void }) {
  const [step, setStep] = useState(0);
  const steps = 1 + (line.pinyin ? 1 : 0) + (line.english ? 1 : 0);
  return (
    <div className="idiom-example" data-testid="idiom-example">
      <button
        type="button"
        className="idiom-example-body"
        onClick={() => setStep((s) => (s >= steps ? 0 : s + 1))}
        aria-label={step === 0 ? `Reveal example ${index + 1}` : `Example ${index + 1}`}
      >
        {step === 0 ? (
          <span className="idiom-example-blank">Example {index + 1} · listen, then tap to reveal</span>
        ) : (
          <>
            <span className="idiom-example-zh" lang="zh-CN">{line.hanzi}</span>
            {step >= 2 && line.pinyin && <span className="idiom-example-py">{line.pinyin}</span>}
            {step >= (line.pinyin ? 3 : 2) && line.english && <span className="idiom-example-en">{line.english}</span>}
          </>
        )}
      </button>
      <PlayButton active={playing} onClick={onPlay} label={`Play example ${index + 1}`} />
    </div>
  );
}

function RefChips({ title, refs, onOpen }: { title: string; refs: IdiomRef[]; onOpen: (r: IdiomRef) => void }) {
  if (refs.length === 0) return null;
  return (
    <div className="idiom-refs">
      <h3 className="idiom-h3">{title}</h3>
      <div className="idiom-ref-row">
        {refs.map((r) => (
          <button key={r.hanzi} type="button" className="idiom-ref" onClick={() => onOpen(r)}>
            <span className="idiom-ref-zh" lang="zh-CN">{r.hanzi}</span>
            <span className="idiom-ref-en">{r.english}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** "Try it": 2–3 multiple-choice questions. Practice only — one analytics event, nothing else. */
function TryIt({ entry }: { entry: IdiomEntry }) {
  const [picked, setPicked] = useState<Array<number | null>>(() => entry.quiz.map(() => null));
  const reported = useRef(false);
  const done = picked.every((p) => p !== null);
  const correct = picked.filter((p, i) => p === entry.quiz[i].answer).length;

  useEffect(() => {
    if (done && !reported.current) {
      reported.current = true;
      track('idioms.quiz', { correct, total: entry.quiz.length });
    }
  }, [done, correct, entry.quiz.length]);

  return (
    <section className="idiom-section" aria-label="Try it">
      <h2 className="idiom-h2">🎯 Try it</h2>
      {entry.quiz.map((q, qi) => (
        <div key={qi} className="idiom-quiz-q" data-testid="idiom-quiz-question">
          <div className="idiom-quiz-prompt">{q.prompt}</div>
          <div className="idiom-quiz-options">
            {q.options.map((opt, oi) => {
              const chosen = picked[qi];
              const state = chosen === null ? '' : oi === q.answer ? ' right' : oi === chosen ? ' wrong' : ' dim';
              return (
                <button
                  key={oi}
                  type="button"
                  className={`idiom-quiz-option${state}`}
                  disabled={chosen !== null}
                  onClick={() => setPicked((p) => p.map((x, i) => (i === qi ? oi : x)))}
                  lang={/\p{Script=Han}/u.test(opt) ? 'zh-CN' : undefined}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          {picked[qi] !== null && (
            <div className={`idiom-quiz-feedback${picked[qi] === q.answer ? ' right' : ' wrong'}`} role="status">
              {picked[qi] === q.answer ? '✓ Right. ' : '✗ Not quite. '}
              {q.explanation}
            </div>
          )}
        </div>
      ))}
      {done && (
        <div className="idiom-quiz-score" data-testid="idiom-quiz-score">
          {idiomQuizScoreLine(correct, entry.quiz.length)}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              reported.current = false;
              setPicked(entry.quiz.map(() => null));
            }}
          >
            Try again
          </button>
        </div>
      )}
    </section>
  );
}

function IdiomReader({ entry, onOpenRef }: { entry: IdiomEntry; onOpenRef: (r: IdiomRef) => void }) {
  const explorer = useExplorer();
  const { playing, play, playAll } = usePagePlayer();
  const [toggles, setToggles] = useState(readToggles);
  const [peek, setPeek] = useState<Set<number>>(new Set());

  const setToggle = (key: 'pinyin' | 'english') => {
    setToggles((t) => {
      const next = { ...t, [key]: !t[key] };
      try {
        localStorage.setItem(TOGGLES_KEY, JSON.stringify(next));
      } catch {
        /* per device convenience only */
      }
      return next;
    });
  };

  const o = entry.origin;
  const where = [o.source, o.era].filter(Boolean).join(' · ');

  return (
    <>
      <header className="idiom-head">
        <div className="idiom-head-row">
          <h1 className="idiom-hanzi" lang="zh-CN" data-testid="idiom-hanzi">{entry.hanzi}</h1>
          <PlayButton active={playing === 'head'} onClick={() => play('head', entry.hanzi)} label={`Play ${entry.hanzi}`} />
        </div>
        <div className="idiom-pinyin">{entry.pinyin}</div>
        <div className="idiom-meaning">{entry.meaning}</div>
        <div className="idiom-explain" lang="zh-CN">{entry.explanation_zh}</div>
        {entry.explanation_pinyin && <div className="idiom-explain-py">{entry.explanation_pinyin}</div>}
        {entry.confidence !== 'high' && (
          <p className="idiom-caution" data-testid="idiom-caution">
            ⓘ Claude wasn’t fully sure about some details{entry.confidence_note ? `: ${entry.confidence_note}` : '.'} Check with your tutor.
          </p>
        )}
      </header>

      <section className="idiom-section" aria-label="Character by character">
        <h2 className="idiom-h2">Character by character</h2>
        <div className="idiom-literal">
          {entry.literal.map((c, i) => (
            <button
              key={`${c.hanzi}-${i}`}
              type="button"
              className="idiom-char"
              onClick={() => explorer.open({ kind: 'char', char: c.hanzi }, { source: 'idioms' })}
              aria-label={`The character ${c.hanzi}, ${c.pinyin}, ${c.gloss}`}
            >
              <span className="idiom-char-glyph" lang="zh-CN">{c.hanzi}</span>
              <span className="idiom-char-py">{c.pinyin}</span>
              <span className="idiom-char-gloss">{c.gloss}</span>
            </button>
          ))}
        </div>
        {entry.literal_english && <p className="idiom-literal-en">Literally “{entry.literal_english}”</p>}
      </section>

      <section className="idiom-section" aria-label="The story">
        <div className="idiom-story-head">
          <h2 className="idiom-h2">📜 典故 · The story</h2>
          {o.story.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => playAll('story', o.story.map((p) => p.hanzi))}
              data-testid="idiom-play-story"
            >
              {playing?.startsWith('story') ? '■ Stop' : '▶ Play story'}
            </button>
          )}
        </div>
        {where && <div className="idiom-source" data-testid="idiom-source">{where}</div>}
        {o.note && <p className="idiom-origin-note">{o.note}</p>}
        {o.story.length > 0 && (
          <>
            <div className="idiom-toggles" role="group" aria-label="Show under each paragraph">
              <button type="button" className={`idiom-toggle${toggles.pinyin ? ' on' : ''}`} aria-pressed={toggles.pinyin} onClick={() => setToggle('pinyin')}>
                拼音
              </button>
              <button type="button" className={`idiom-toggle${toggles.english ? ' on' : ''}`} aria-pressed={toggles.english} onClick={() => setToggle('english')} data-testid="idiom-toggle-english">
                English
              </button>
            </div>
            <div className="idiom-story" data-testid="idiom-story">
              {o.story.map((p, i) => {
                const showEn = toggles.english || peek.has(i);
                return (
                  <div key={i} className={`idiom-para${playing === `story:${i}` ? ' speaking' : ''}`}>
                    <div className="idiom-para-main">
                      <p className="idiom-para-zh">
                        <ExplorableText text={p.hanzi} source="idioms" highlight={entry.hanzi} />
                      </p>
                      {toggles.pinyin && p.pinyin && <p className="idiom-para-py">{p.pinyin}</p>}
                      {showEn && p.english && <p className="idiom-para-en" data-testid="idiom-para-en">{p.english}</p>}
                    </div>
                    <div className="idiom-para-tools">
                      <PlayButton active={playing === `para:${i}`} onClick={() => play(`para:${i}`, p.hanzi)} label={`Play paragraph ${i + 1}`} />
                      {!toggles.english && (
                        <button
                          type="button"
                          className={`idiom-peek${peek.has(i) ? ' on' : ''}`}
                          onClick={() => setPeek((s) => {
                            const n = new Set(s);
                            if (n.has(i)) n.delete(i);
                            else n.add(i);
                            return n;
                          })}
                          aria-label={`English for paragraph ${i + 1}`}
                        >
                          EN
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {o.summary && (
          <details className="idiom-summary">
            <summary>In one line (English)</summary>
            <p>{o.summary}</p>
          </details>
        )}
      </section>

      <section className="idiom-section" aria-label="How to use it">
        <h2 className="idiom-h2">用法 · How to use it</h2>
        <div className="idiom-usage-chips">
          {entry.usage.roles.map((r) => (
            <span key={r} className="idiom-chip">
              <span lang="zh-CN">{r}</span> {IDIOM_ROLES[r]}
            </span>
          ))}
          <span className={`idiom-chip idiom-chip--${entry.usage.sentiment}`}>{idiomSentimentLabel(entry.usage.sentiment)}</span>
          <span className="idiom-chip">{idiomRegisterLabel(entry.usage.register)}</span>
        </div>
        {entry.usage.note && <p className="idiom-usage-note">{entry.usage.note}</p>}
        {entry.usage.collocations.length > 0 && (
          <>
            <h3 className="idiom-h3">Goes with</h3>
            <ul className="idiom-collocations">
              {entry.usage.collocations.map((c) => (
                <li key={c.hanzi}>
                  <span lang="zh-CN" className="idiom-coll-zh">{c.hanzi}</span>
                  <span className="idiom-coll-py">{c.pinyin}</span>
                  <span className="idiom-coll-en">{c.english}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <h3 className="idiom-h3">Examples · easiest first</h3>
        {entry.usage.examples.map((ex, i) => (
          <ExampleRow key={i} line={ex} index={i} playing={playing === `ex:${i}`} onPlay={() => play(`ex:${i}`, ex.hanzi)} />
        ))}
        {entry.usage.mistake && (
          <div className="idiom-mistake">
            <strong>⚠ Common mistake</strong>
            <p>{entry.usage.mistake}</p>
          </div>
        )}
      </section>

      {(entry.synonyms.length > 0 || entry.antonyms.length > 0) && (
        <section className="idiom-section" aria-label="Related idioms">
          <RefChips title="近义 · Similar" refs={entry.synonyms} onOpen={onOpenRef} />
          <RefChips title="反义 · Opposite" refs={entry.antonyms} onOpen={onOpenRef} />
        </section>
      )}

      {entry.quiz.length > 0 && <TryIt entry={entry} />}
    </>
  );
}

/** The card tie-in: "📚 In <deck> · ⚡ Study it today", else "+ Add as card". */
function CardFooter({ entry }: { entry: IdiomEntry }) {
  const navigate = useNavigate();
  const [existing, setExisting] = useState<Array<{ note: LocalNote; deckName: string }> | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [bumpMsg, setBumpMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    findExistingNotes(entry.hanzi).then((e) => alive && setExisting(e)).catch(() => alive && setExisting([]));
    return () => {
      alive = false;
    };
  }, [entry.hanzi]);

  if (existing === null) return null;
  const decks = [...new Set(existing.map((e) => e.deckName))];
  return (
    <div className="page-footer idiom-footer" data-testid="idiom-card-footer">
      {existing.length > 0 ? (
        <>
          <div className="idiom-have">📚 You have this card in {decks.join(', ')}</div>
          {bumpMsg && <div className="bump-hint" role="status">{bumpMsg}</div>}
          <div className="idiom-footer-row">
            <button type="button" className="btn btn-secondary" onClick={() => navigate(`/cards/${existing[0].note.id}`)}>Open card →</button>
            <BumpButton noteIds={existing.map((e) => e.note.id)} source="idioms" label="⚡ Study it today" onBumped={setBumpMsg} />
          </div>
        </>
      ) : added ? (
        <div className="idiom-have" role="status">✓ Added — it will be in your decks after the next sync.</div>
      ) : (
        <button type="button" className="btn btn-primary idiom-add" onClick={() => setAdding(true)} data-testid="idiom-add-card">
          + Add as card
        </button>
      )}
      {adding && createPortal(
        <AddChunkModal
          source="idioms"
          chunk={idiomCardFields(entry)}
          onOpenCard={(noteId) => navigate(`/cards/${noteId}`)}
          onAdded={() => {
            track('idioms.add_card', {});
            invalidateKnownHanzi();
            setAdded(true);
          }}
          onClose={() => setAdding(false)}
        />,
        document.body,
      )}
    </div>
  );
}

/** `/idioms/:hanzi` — one 成语: meaning, character by character, the 典故, usage, examples, Try it. */
export function IdiomPage() {
  const params = useParams<{ hanzi: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { isOnline } = useNetwork();
  const hanzi = normalizeIdiomHanzi(params.hanzi ?? '');
  const source = search.get('from') ?? 'list';
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [retrying, setRetrying] = useState(false);
  const opened = useRef<string | null>(null);

  const show = useCallback((v: View, cached: boolean) => {
    setView(v);
    if (v.kind === 'ready') {
      if (opened.current !== v.entry.hanzi) {
        opened.current = v.entry.hanzi;
        track('idioms.open', { source, cached });
        void markIdiomOpened(v.entry.hanzi);
        prefetchIdiomAudio(v.entry);
      }
    }
  }, [source]);

  // Cached first (instant, offline), then the server: get-or-generate on first open.
  useEffect(() => {
    let alive = true;
    opened.current = null;
    setView({ kind: 'loading' });
    void (async () => {
      const cached = await cachedIdiom(hanzi);
      const cachedView = cached ? viewOf(cached) : null;
      if (alive && cachedView?.kind === 'ready') show(cachedView, true);
      if (!navigator.onLine) {
        if (alive && cachedView?.kind !== 'ready') setView({ kind: 'offline' });
        return;
      }
      try {
        let record = await fetchIdiom(hanzi);
        if (record.status === 'missing') record = await startIdiom(hanzi);
        const v = viewOf(record);
        if (alive && v && !(v.kind !== 'ready' && cachedView?.kind === 'ready')) show(v, false);
      } catch (e) {
        if (!alive || cachedView?.kind === 'ready') return;
        const status = (e as { status?: number }).status;
        setView(status === 503 || status === 400
          ? { kind: 'unavailable', message: e instanceof Error ? e.message : 'Idioms aren’t available right now.' }
          : navigator.onLine ? { kind: 'failed', message: 'Couldn’t load this idiom — try again.' } : { kind: 'offline' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [hanzi, show]);

  // While Claude writes it: poll the row.
  useEffect(() => {
    if (view.kind !== 'generating' || !isOnline) return;
    const started = Date.now();
    const t = window.setInterval(() => {
      if (Date.now() - started > POLL_LIMIT_MS) {
        window.clearInterval(t);
        setView({ kind: 'failed', message: 'This is taking too long — try again.' });
        return;
      }
      fetchIdiom(hanzi)
        .then((r) => {
          const v = viewOf(r);
          if (v && v.kind !== 'generating') show(v, false);
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [view.kind, hanzi, isOnline, show]);

  const retry = async () => {
    setRetrying(true);
    try {
      const v = viewOf(await startIdiom(hanzi, true));
      if (v) show(v, false);
    } catch (e) {
      setView({ kind: 'failed', message: e instanceof Error ? e.message : 'Couldn’t start it — try again.' });
    } finally {
      setRetrying(false);
    }
  };

  const openRef = (r: IdiomRef) => navigate(`/idioms/${encodeURIComponent(r.hanzi)}?from=related`);

  return (
    <div className="container idiom-page" data-testid="idiom-page">
      <Link to="/idioms" className="idiom-back">← 成语 Idioms <span className="idiom-beta">beta</span></Link>
      {view.kind === 'ready' ? (
        <>
          <IdiomReader entry={view.entry} onOpenRef={openRef} />
          <CardFooter entry={view.entry} />
        </>
      ) : (
        <div className="idiom-state" data-testid={`idiom-state-${view.kind}`}>
          <div className="idiom-state-hanzi" lang="zh-CN">{hanzi}</div>
          {view.kind === 'loading' && <p className="idiom-muted">Loading…</p>}
          {view.kind === 'generating' && (
            <>
              <div className="idiom-writing" aria-hidden>✍️</div>
              <p>Claude is writing the story and usage of {hanzi}…</p>
              <p className="idiom-muted">About half a minute, once — then it’s here for everyone, offline too.</p>
            </>
          )}
          {view.kind === 'failed' && (
            <>
              <p>{view.message}</p>
              <button type="button" className="btn btn-primary" onClick={() => void retry()} disabled={retrying || !isOnline}>
                {retrying ? 'Starting…' : 'Try again'}
              </button>
            </>
          )}
          {view.kind === 'not_idiom' && (
            <>
              <p>{view.reason || `${hanzi} doesn’t look like a 成语.`}</p>
              {view.suggestion && (
                <p>
                  Did you mean{' '}
                  <Link to={`/idioms/${encodeURIComponent(view.suggestion)}?from=search`} className="idiom-suggest" lang="zh-CN">
                    {view.suggestion}
                  </Link>
                  ?
                </p>
              )}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void retry()} disabled={retrying || !isOnline}>
                It is one — write it up anyway
              </button>
            </>
          )}
          {view.kind === 'offline' && <p>You’re offline and this idiom isn’t on the device yet. Open it once online and it stays here.</p>}
          {view.kind === 'unavailable' && <p>{view.message}</p>}
        </div>
      )}
    </div>
  );
}
