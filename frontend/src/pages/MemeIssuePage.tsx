import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  isMemeMonth,
  memeCardFields,
  memeCoversLabel,
  memeLinkLabel,
  memeMonthLabel,
  memeMonthLabelZh,
  memePlatformName,
  memeQuizScoreLine,
  memeRegisterChips,
  memeVerdictLabel,
  type MemeIssue,
  type MemeItem,
  type MemeLessonJob,
  type MemeMedia,
  type MemeSource,
} from '@shared/meme-review';
import { useNetwork } from '../contexts/NetworkContext';
import { getMemeLessonJob, startMemeLesson, type MemeIssueStats } from '../api/memeReview';
import { cachedMemeIssue, fetchMemeIssue, memePictureUrl, prefetchMemeAudio } from '../services/memeReview';
import { getTTSWithCache } from '../services/ttsCache';
import { findExistingNotes } from '../services/studyBumps';
import { invalidateKnownHanzi } from '../services/readerWords';
import { track } from '../services/analytics';
import { createAudioPlayer } from '../utils/audioPlayback';
import { useTTS } from '../hooks/useAudio';
import type { LocalNote } from '../db/database';
import { AddChunkModal } from '../components/AddChunkModal';
import { BumpButton } from '../components/bumps/BumpButton';
import { ExplorableText } from '../components/explorer/ExplorableText';
import { useExplorer } from '../components/explorer/ExplorerContext';
import './MemeReviewPage.css';

const POLL_MS = 4000;

/** One player for the page: a clip at a time; the button of the playing line shows ■. */
function usePlayer() {
  const player = useRef(createAudioPlayer());
  const tts = useTTS();
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => {
    const p = player.current;
    return () => p.dispose();
  }, []);
  const play = useCallback(async (key: string, text: string) => {
    if (playing === key) {
      player.current.stop();
      setPlaying(null);
      return;
    }
    setPlaying(key);
    const id = player.current.claim();
    const blob = await getTTSWithCache(text).catch(() => null);
    if (!player.current.isCurrent(id)) return;
    if (!blob) {
      tts.speak(text);
      setPlaying(null);
      return;
    }
    player.current.play(blob, { onEnded: () => setPlaying(null), onError: () => setPlaying(null) });
  }, [playing, tts]);
  return { playing, play };
}

type Play = ReturnType<typeof usePlayer>;

function PlayButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" className={`meme-play${active ? ' playing' : ''}`} onClick={onClick} aria-label={label}>
      {active ? '■' : '🔊'}
    </button>
  );
}

function Picture({ imageKey, alt, className }: { imageKey: string | null; alt: string; className: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (imageKey) void memePictureUrl(imageKey).then((u) => alive && setSrc(u));
    return () => {
      alive = false;
    };
  }, [imageKey]);
  if (!imageKey || !src) return <div className={`${className} meme-pic-blank`} aria-hidden>梗</div>;
  return <img className={className} src={src} alt={alt} loading="lazy" />;
}

function LinkOut({ link, kind, onOpen }: { link: MemeMedia | MemeSource; kind: 'media' | 'source'; onOpen: () => void }) {
  const { isOnline } = useNetwork();
  const [thumbOk, setThumbOk] = useState(true);
  const media = kind === 'media' ? (link as MemeMedia) : null;
  return (
    <a
      className={`meme-link meme-link--${kind}`}
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onOpen}
      data-testid={`meme-link-${kind}`}
    >
      {media?.thumbnail_url && isOnline && thumbOk && (
        <img className="meme-link-thumb" src={media.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setThumbOk(false)} />
      )}
      <span className="meme-link-body">
        <span className="meme-link-label">{media ? memeLinkLabel(media) : `↗ ${memePlatformName(link.platform)}`}</span>
        {link.title && <span className="meme-link-title">{link.title}</span>}
      </span>
    </a>
  );
}

function CardFooter({ item, month }: { item: MemeItem; month: string }) {
  const navigate = useNavigate();
  const [existing, setExisting] = useState<Array<{ note: LocalNote; deckName: string }> | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [bumpMsg, setBumpMsg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    findExistingNotes(item.hanzi).then((e) => alive && setExisting(e)).catch(() => alive && setExisting([]));
    return () => {
      alive = false;
    };
  }, [item.hanzi]);
  if (existing === null) return null;
  const decks = [...new Set(existing.map((e) => e.deckName))];
  return (
    <div className="meme-card-actions">
      {existing.length > 0 ? (
        <>
          <span className="meme-have">📚 In {decks.join(', ')}</span>
          {bumpMsg && <span className="bump-hint" role="status">{bumpMsg}</span>}
          <BumpButton noteIds={existing.map((e) => e.note.id)} source="other" label="⚡ Study it today" onBumped={setBumpMsg} />
        </>
      ) : added ? (
        <span className="meme-have" role="status">✓ Added — it will be in your decks after the next sync.</span>
      ) : (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(true)} data-testid="meme-add-card">+ Add as card</button>
      )}
      {adding && createPortal(
        <AddChunkModal
          source="other"
          chunk={memeCardFields(item, month)}
          onOpenCard={(noteId) => navigate(`/cards/${noteId}`)}
          onAdded={() => {
            track('meme_review.add_card', { item: item.id });
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

function MemeCard({ item, index, month, open, onToggle, player }: { item: MemeItem; index: number; month: string; open: boolean; onToggle: () => void; player: Play }) {
  const explorer = useExplorer();
  const [english, setEnglish] = useState(false);
  const linkOut = (kind: 'media' | 'source', l: MemeMedia | MemeSource) =>
    track('meme_review.link_out', { link: kind, kind: kind === 'media' ? (l as MemeMedia).kind : 'post', platform: l.platform });
  return (
    <article className={`meme-card${open ? ' open' : ''}`} data-testid="meme-card">
      <div className="meme-card-head">
        <button type="button" className="meme-card-toggle" onClick={onToggle} aria-expanded={open} aria-label={`${item.hanzi}, ${item.english}${open ? '' : ' — show more'}`}>
          <Picture imageKey={item.picture.image_key} alt="" className="meme-thumb" />
          <span className="meme-card-words">
            <span className="meme-num">{index + 1}</span>
            <span className="meme-hanzi" lang="zh-CN">{item.hanzi}</span>
            <span className="meme-pinyin">{item.pinyin}</span>
            <span className="meme-gist">{item.english}</span>
          </span>
          <span className="meme-chevron" aria-hidden>{open ? '▴' : '▾'}</span>
        </button>
        <PlayButton active={player.playing === `${item.id}:head`} onClick={() => void player.play(`${item.id}:head`, item.hanzi)} label={`Play ${item.hanzi}`} />
      </div>

      {open && (
        <div className="meme-card-body" data-testid="meme-card-body">
          {item.picture.image_key && <Picture imageKey={item.picture.image_key} alt={`An illustration of ${item.english}`} className="meme-pic" />}

          <section className="meme-sec">
            <div className="meme-sec-head">
              <h3 className="meme-h3">什么意思 · What it means</h3>
              <button type="button" className={`meme-toggle${english ? ' on' : ''}`} aria-pressed={english} onClick={() => setEnglish((v) => !v)}>EN</button>
            </div>
            <div className="meme-line">
              <div className="meme-line-main">
                <p className="meme-zh"><ExplorableText text={item.meaning.hanzi} source="meme_review" highlight={item.hanzi} /></p>
                {item.meaning.pinyin && <p className="meme-py">{item.meaning.pinyin}</p>}
                {english && item.meaning.english && <p className="meme-en">{item.meaning.english}</p>}
              </div>
              <PlayButton active={player.playing === `${item.id}:meaning`} onClick={() => void player.play(`${item.id}:meaning`, item.meaning.hanzi)} label="Play the meaning" />
            </div>
          </section>

          <section className="meme-sec">
            <h3 className="meme-h3">出处 · Where it came from</h3>
            <p className="meme-text">{item.origin.text}</p>
            <p className="meme-muted">
              {item.origin.when}
              {item.origin.confidence === 'medium' && <span className="meme-unsure"> · ⓘ not fully certain</span>}
            </p>
          </section>

          <section className="meme-sec">
            <h3 className="meme-h3">怎么用 · How people use it</h3>
            {item.examples.map((ex, i) => (
              <div key={i} className="meme-line meme-example">
                <div className="meme-line-main">
                  <p className="meme-zh"><ExplorableText text={ex.hanzi} source="meme_review" highlight={item.hanzi} /></p>
                  {ex.pinyin && <p className="meme-py">{ex.pinyin}</p>}
                  {english && ex.english && <p className="meme-en">{ex.english}</p>}
                </div>
                <PlayButton active={player.playing === `${item.id}:ex${i}`} onClick={() => void player.play(`${item.id}:ex${i}`, ex.hanzi)} label={`Play example ${i + 1}`} />
              </div>
            ))}
            {!english && <button type="button" className="meme-link-btn" onClick={() => setEnglish(true)}>Show the English</button>}
          </section>

          <section className="meme-sec">
            <h3 className="meme-h3">谁在说 · Who says it</h3>
            <div className="meme-chips">
              {memeRegisterChips(item.register).map((c) => <span key={c} className={`meme-chip${c.startsWith('⚠') ? ' meme-chip--crude' : ''}`}>{c}</span>)}
            </div>
            {item.register.note && <p className="meme-text">{item.register.note}</p>}
            <div className={`meme-verdict meme-verdict--${item.say_it.verdict}`} data-testid="meme-verdict">
              <strong>Would you say it? {memeVerdictLabel(item.say_it.verdict)}</strong>
              {item.say_it.note && <p>{item.say_it.note}</p>}
            </div>
          </section>

          {item.related.length > 0 && (
            <section className="meme-sec">
              <h3 className="meme-h3">相关 · It riffs on</h3>
              <div className="meme-chips">
                {item.related.map((r) => (
                  <button key={r.hanzi} type="button" className="meme-ref" onClick={() => explorer.open({ kind: 'word', hanzi: r.hanzi }, { source: 'meme_review' })}>
                    <span lang="zh-CN">{r.hanzi}</span> <span className="meme-ref-en">{r.english}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {(item.media.length > 0 || item.sources.length > 0) && (
            <section className="meme-sec">
              <h3 className="meme-h3">原视频 · Watch / read</h3>
              <div className="meme-links">
                {item.media.map((m) => <LinkOut key={m.url} link={m} kind="media" onOpen={() => linkOut('media', m)} />)}
                {item.sources.map((s) => <LinkOut key={s.url} link={s} kind="source" onOpen={() => linkOut('source', s)} />)}
              </div>
            </section>
          )}

          <CardFooter item={item} month={month} />
        </div>
      )}
    </article>
  );
}

function Quiz({ issue }: { issue: MemeIssue }) {
  const [picked, setPicked] = useState<Array<number | null>>(() => issue.quiz.map(() => null));
  const reported = useRef(false);
  const done = picked.every((p) => p !== null);
  const correct = picked.filter((p, i) => p === issue.quiz[i].answer).length;
  useEffect(() => {
    if (done && !reported.current && issue.quiz.length > 0) {
      reported.current = true;
      track('meme_review.quiz_finish', { correct, total: issue.quiz.length });
    }
  }, [done, correct, issue.quiz.length]);
  if (issue.quiz.length === 0) return null;
  return (
    <section className="meme-quiz" aria-label="Quiz" data-testid="meme-quiz">
      <h2 className="meme-h2">🎯 你懂梗吗？ Quick quiz</h2>
      {issue.quiz.map((q, qi) => (
        <div key={qi} className="meme-quiz-q" data-testid="meme-quiz-question">
          <div className="meme-quiz-prompt">{q.prompt}</div>
          <div className="meme-quiz-options">
            {q.options.map((opt, oi) => {
              const chosen = picked[qi];
              const state = chosen === null ? '' : oi === q.answer ? ' right' : oi === chosen ? ' wrong' : ' dim';
              return (
                <button key={oi} type="button" className={`meme-quiz-option${state}`} disabled={chosen !== null} onClick={() => setPicked((p) => p.map((x, i) => (i === qi ? oi : x)))}>
                  {opt}
                </button>
              );
            })}
          </div>
          {picked[qi] !== null && (
            <div className={`meme-quiz-feedback${picked[qi] === q.answer ? ' right' : ' wrong'}`} role="status">
              {picked[qi] === q.answer ? '✓ Right. ' : '✗ Not quite. '}
              {q.explanation}
            </div>
          )}
        </div>
      ))}
      {done && (
        <div className="meme-quiz-score" data-testid="meme-quiz-score">
          {memeQuizScoreLine(correct, issue.quiz.length)}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { reported.current = false; setPicked(issue.quiz.map(() => null)); }}>Try again</button>
        </div>
      )}
    </section>
  );
}

function LessonSection({ month, initial }: { month: string; initial: MemeLessonJob | null }) {
  const navigate = useNavigate();
  const { isOnline } = useNetwork();
  const [job, setJob] = useState<MemeLessonJob | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setJob(initial);
  }, [initial]);
  useEffect(() => {
    if (job?.status !== 'generating' || !isOnline) return;
    const t = window.setInterval(() => {
      getMemeLessonJob(job.id).then((r) => setJob(r.job)).catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [job?.id, job?.status, isOnline]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const { job: j } = await startMemeLesson(month);
      setJob(j);
      track('meme_review.make_lesson', { status: j.status === 'generating' ? 'started' : 'writing' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t start the lesson.');
    } finally {
      setBusy(false);
    }
  };
  const open = (id: string) => {
    track('meme_review.make_lesson', { status: 'open' });
    navigate(`/lessons/${id}/play?from=lessons_page`);
  };

  return (
    <section className="meme-lesson" data-testid="meme-lesson">
      <h2 className="meme-h2">🎓 Practise them</h2>
      {job?.status === 'ready' && job.lesson_id ? (
        <>
          <p className="meme-text">Your mini lesson on this issue is in your Mini Lessons.</p>
          <div className="meme-lesson-row">
            <button type="button" className="btn btn-primary" onClick={() => open(job.lesson_id!)} data-testid="meme-lesson-open">▶ Open the lesson</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void start()} disabled={busy || !isOnline}>Make another</button>
          </div>
        </>
      ) : job?.status === 'generating' ? (
        <p className="meme-text" role="status">✍️ Claude is writing your mini lesson… (about a minute — you can leave this page)</p>
      ) : (
        <>
          <p className="meme-text">A short mini lesson on these memes — meanings, matching, using them in a chat — saved in <strong>your own</strong> Mini Lessons. Nothing is sent to anyone.</p>
          {job?.status === 'failed' && <p className="meme-error">{job.error ?? 'The last try failed.'}</p>}
          <button type="button" className="btn btn-primary" onClick={() => void start()} disabled={busy || !isOnline} data-testid="meme-make-lesson">
            {busy ? 'Starting…' : 'Make a mini lesson from this issue'}
          </button>
          {!isOnline && <p className="meme-muted">Needs a connection.</p>}
        </>
      )}
      {error && <p className="meme-error" role="alert">{error}</p>}
    </section>
  );
}

type View =
  | { kind: 'loading' }
  | { kind: 'ready'; issue: MemeIssue; lesson: MemeLessonJob | null; stats: MemeIssueStats | null }
  | { kind: 'generating'; progress: string | null }
  | { kind: 'failed'; message: string }
  | { kind: 'missing' }
  | { kind: 'offline' };

/** `/meme-review/:month` — one monthly issue. */
export function MemeIssuePage() {
  const params = useParams<{ month: string }>();
  const [search] = useSearchParams();
  const { isOnline } = useNetwork();
  const month = params.month ?? '';
  const source = search.get('from') === 'list' ? 'list' : 'link';
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [openId, setOpenId] = useState<string | null>(null);
  const [introEn, setIntroEn] = useState(false);
  const player = usePlayer();
  const opened = useRef(false);

  const load = useCallback(async (alive: () => boolean) => {
    const cached = await cachedMemeIssue(month);
    if (alive() && cached?.issue) setView({ kind: 'ready', issue: cached.issue, lesson: null, stats: null });
    if (!navigator.onLine) {
      if (alive() && !cached?.issue) setView({ kind: 'offline' });
      return;
    }
    try {
      const res = await fetchMemeIssue(month);
      if (!alive()) return;
      const r = res.issue;
      if (r.status === 'ready' && r.issue) setView({ kind: 'ready', issue: r.issue, lesson: res.lesson, stats: res.stats ?? null });
      else if (cached?.issue) return;
      else if (r.status === 'generating') setView({ kind: 'generating', progress: r.progress });
      else if (r.status === 'failed') setView({ kind: 'failed', message: r.error ?? 'This issue didn’t come out.' });
      else setView({ kind: 'missing' });
    } catch {
      if (alive() && !cached?.issue) setView(navigator.onLine ? { kind: 'failed', message: 'Couldn’t load this issue — try again.' } : { kind: 'offline' });
    }
  }, [month]);

  useEffect(() => {
    let alive = true;
    opened.current = false;
    if (!isMemeMonth(month)) {
      setView({ kind: 'missing' });
      return;
    }
    void load(() => alive);
    return () => {
      alive = false;
    };
  }, [month, load]);

  useEffect(() => {
    if (view.kind !== 'ready' || opened.current) return;
    opened.current = true;
    track('meme_review.open', { source, cached: !navigator.onLine, items: view.issue.items.length });
    prefetchMemeAudio(view.issue);
  }, [view, source]);

  useEffect(() => {
    if (view.kind !== 'generating' || !isOnline) return;
    let alive = true;
    const t = window.setInterval(() => void load(() => alive), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [view.kind, isOnline, load]);

  const toggle = (item: MemeItem, index: number) => {
    setOpenId((cur) => (cur === item.id ? null : item.id));
    if (openId !== item.id) track('meme_review.item_open', { item: item.id, position: index + 1 });
  };

  return (
    <div className="container meme-page meme-issue-page" data-testid="meme-issue-page">
      <Link to="/meme-review" className="meme-back">← 梗 Meme review <span className="meme-proto">prototype</span></Link>
      {view.kind === 'ready' ? (
        <>
          <header className="meme-issue-head">
            <div className="meme-issue-month"><span lang="zh-CN">{memeMonthLabelZh(view.issue.month)}</span> · {memeMonthLabel(view.issue.month)}</div>
            <h1 className="meme-issue-title" lang="zh-CN" data-testid="meme-issue-title">{view.issue.title}</h1>
            {view.issue.title_en && <p className="meme-issue-sub">{view.issue.title_en}</p>}
            {memeCoversLabel(view.issue.covers) && <p className="meme-muted">Covers {memeCoversLabel(view.issue.covers)}</p>}
            <div className="meme-line meme-intro">
              <div className="meme-line-main">
                <p className="meme-zh"><ExplorableText text={view.issue.intro.hanzi} source="meme_review" /></p>
                {view.issue.intro.pinyin && <p className="meme-py">{view.issue.intro.pinyin}</p>}
                {introEn && <p className="meme-en">{view.issue.intro.english}</p>}
              </div>
              <div className="meme-line-tools">
                <PlayButton active={player.playing === 'intro'} onClick={() => void player.play('intro', view.issue.intro.hanzi)} label="Play the intro" />
                <button type="button" className={`meme-toggle${introEn ? ' on' : ''}`} aria-pressed={introEn} onClick={() => setIntroEn((v) => !v)}>EN</button>
              </div>
            </div>
            {view.stats && (
              <p className="meme-muted meme-stats" data-testid="meme-stats">
                Admin: {view.stats.rounds ?? 0} model calls · {view.stats.searches ?? 0} searches · {view.stats.images ?? 0} pictures · ≈ ${Number(view.stats.cost_usd ?? 0).toFixed(2)}
              </p>
            )}
          </header>

          <div className="meme-cards">
            {view.issue.items.map((item, i) => (
              <MemeCard key={item.id} item={item} index={i} month={view.issue.month} open={openId === item.id} onToggle={() => toggle(item, i)} player={player} />
            ))}
          </div>

          <Quiz issue={view.issue} />
          <LessonSection month={view.issue.month} initial={view.lesson} />
          <p className="meme-muted meme-footnote">Researched and written by Claude from web search results; every link was in the search results. Videos and posts open on their own sites.</p>
        </>
      ) : (
        <div className="meme-state" data-testid={`meme-state-${view.kind}`}>
          <div className="meme-state-month" lang="zh-CN">{isMemeMonth(month) ? memeMonthLabelZh(month) : month}</div>
          {view.kind === 'loading' && <p className="meme-muted">Loading…</p>}
          {view.kind === 'generating' && (
            <>
              <div className="meme-writing" aria-hidden>🔎</div>
              <p>Claude is researching this month’s memes…</p>
              {view.progress && <p className="meme-muted">{view.progress}</p>}
              <p className="meme-muted">Usually 5–15 minutes, once — then it’s here for everyone, offline too.</p>
            </>
          )}
          {view.kind === 'failed' && <p>{view.message}</p>}
          {view.kind === 'missing' && <p>No issue for this month yet — it comes out on the 1st.</p>}
          {view.kind === 'offline' && <p>You’re offline and this issue isn’t on the device yet. Open it once online and it stays here.</p>}
        </div>
      )}
    </div>
  );
}
