/**
 * The body of each in-call activity kind, for one role. Pure rendering of the
 * room's session; every action goes back through `act` and is shown only
 * when `can` says the engine would take it from me.
 */

import { useEffect, useRef, useState } from 'react';
import {
  blanksFor,
  builtText,
  cellKey,
  otherRole,
  type ActivityAction,
  type ActivityRole,
  type ActivitySession,
  type BuildSpec,
  type DescribeSpec,
  type DictationSpec,
  type InfoGapSpec,
  type QuizSpec,
  type RoleplaySpec,
} from '@shared/call-activities';
import { diffHanzi } from '@shared/lesson/answer-check';
import { ReviewView } from './ReviewView';

export interface BodyProps {
  session: ActivitySession;
  me: string;
  /** The role whose view this is (mine; in a solo call the one I'm viewing as). */
  role: ActivityRole;
  host: boolean;
  act: (a: ActivityAction) => void;
  can: (a: ActivityAction) => boolean;
  speak: (text: string) => void;
}

const nameOf = (s: ActivitySession, r: ActivityRole) => s.names[s.roles[r]] ?? 'Your partner';

function NextButton({ can, act, label = 'Next ▸' }: Pick<BodyProps, 'can' | 'act'> & { label?: string }) {
  if (!can({ type: 'next' })) return null;
  return <button type="button" className="act-primary" onClick={() => act({ type: 'next' })} data-testid="activity-next">{label}</button>;
}

function Waiting({ children }: { children: React.ReactNode }) {
  return <p className="act-waiting" data-testid="activity-waiting"><span className="act-dots" aria-hidden="true" />{children}</p>;
}

export function ActivityBody(p: BodyProps) {
  switch (p.session.spec.kind) {
    case 'describe':
      return <DescribeView {...p} spec={p.session.spec} />;
    case 'info_gap':
      return <InfoGapView {...p} spec={p.session.spec} />;
    case 'roleplay':
      return <RoleplayView {...p} spec={p.session.spec} />;
    case 'build':
      return <BuildView {...p} spec={p.session.spec} />;
    case 'quiz':
      return <QuizView {...p} spec={p.session.spec} />;
    case 'dictation':
      return <DictationView {...p} spec={p.session.spec} />;
    case 'review':
      return <ReviewView {...p} spec={p.session.spec} />;
  }
}

// ------------------------------------------------------------------ describe & guess

function DescribeView({ session: s, role, act, can, speak, spec }: BodyProps & { spec: DescribeSpec }) {
  const item = spec.items[s.round];
  const pick = s.data.pick ?? null;
  const reveal = s.phase === 'reveal';
  if (role === 'a' && !reveal) {
    return (
      <div className="act-center">
        <div className="act-emoji" aria-hidden="true">{item.emoji}</div>
        <div className="act-hanzi" data-testid="describe-target">{item.hanzi}</div>
        <div className="act-pinyin">{item.pinyin} · {item.english}</div>
        <p className="act-instr">Describe it in Chinese — don’t say the word!</p>
        {item.hints?.length ? (
          <div className="act-chips" aria-label="Words you could use">
            {item.hints.map((h) => <button key={h} type="button" className="act-chip" onClick={() => speak(h)}>{h}</button>)}
          </div>
        ) : null}
        <Waiting>{nameOf(s, 'b')} is guessing…</Waiting>
      </div>
    );
  }
  return (
    <div className="act-center">
      {reveal ? (
        <>
          <div className="act-emoji" aria-hidden="true">{item.emoji}</div>
          <div className="act-hanzi">{item.hanzi}</div>
          <div className="act-pinyin">{item.pinyin} · {item.english}</div>
          <div className={`act-verdict ${pick === item.hanzi ? 'right' : 'wrong'}`} data-testid="activity-verdict">
            {pick === item.hanzi ? `✓ ${nameOf(s, 'b')} got it!` : `✗ ${nameOf(s, 'b')} picked ${pick}`}
          </div>
        </>
      ) : (
        <p className="act-instr">Listen to {nameOf(s, 'a')}’s description and pick what it is.</p>
      )}
      <div className="act-options four">
        {(s.data.options ?? []).map((o) => {
          const cls = reveal ? (o === item.hanzi ? ' right' : o === pick ? ' wrong' : ' dim') : '';
          return (
            <button key={o} type="button" className={`act-option${cls}`} disabled={!can({ type: 'pick', option: o })} onClick={() => act({ type: 'pick', option: o })} data-testid="describe-option">
              {o}
            </button>
          );
        })}
      </div>
      <NextButton can={can} act={act} />
    </div>
  );
}

// ------------------------------------------------------------------ information gap

function InfoGapView({ session: s, role, act, can, speak, spec }: BodyProps & { spec: InfoGapSpec }) {
  const answers = s.data.answers ?? {};
  const reveal = s.phase === 'reveal';
  const [choosing, setChoosing] = useState<string | null>(null);
  const choicesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (choosing) choicesRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [choosing]);
  const myBlanks = new Set(blanksFor(spec, role));
  const filled = Array.from(myBlanks).filter((k) => answers[k]).length;
  const gloss = (h: string) => spec.choices.find((c) => c.hanzi === h);
  return (
    <div className="act-gap">
      <p className="act-instr">{spec.prompt}</p>
      <p className="act-muted">You see half the table; {nameOf(s, otherRole(role))} sees the other half. Ask each other — then fill in your blanks ({filled}/{myBlanks.size}).</p>
      <table className="act-table" data-testid="infogap-table">
        <thead>
          <tr><th />{spec.columns.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {spec.rows.map((row, ri) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {row.cells.map((cell, ci) => {
                const k = cellKey(ri, ci);
                const got = answers[k];
                if (reveal) {
                  return (
                    <td key={k} className={got === cell.value ? 'right' : 'wrong'}>
                      <span className="act-cell-value">{cell.value}</span>
                      {got !== cell.value && <span className="act-cell-note">{got ? `wrote ${got}` : 'left blank'}</span>}
                    </td>
                  );
                }
                if (!myBlanks.has(k)) {
                  return (
                    <td key={k} className="seen" data-testid="infogap-seen">
                      <span className="act-cell-value">{cell.value}</span>
                      <span className="act-cell-note">{gloss(cell.value)?.pinyin}</span>
                      {got && <span className="act-cell-theirs">they put: {got}</span>}
                    </td>
                  );
                }
                return (
                  <td key={k} className={`blank${got ? ' filled' : ''}`}>
                    <button type="button" className="act-cell-btn" onClick={() => setChoosing(k)} disabled={!can({ type: 'fill', cell: k, value: null })} data-testid="infogap-blank">
                      {got ?? '?'}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {choosing && (
        <div ref={choicesRef} className="act-choices" role="dialog" aria-label="Fill in" data-testid="infogap-choices">
          <div className="act-choices-head">
            <span>{spec.rows[Number(choosing.split(':')[0])]?.label} · {spec.columns[Number(choosing.split(':')[1])]}</span>
            <button type="button" className="act-btn" onClick={() => setChoosing(null)} aria-label="Close">✕</button>
          </div>
          <div className="act-choice-list">
            {spec.choices.map((c) => (
              <button key={c.hanzi} type="button" className={`act-choice${answers[choosing] === c.hanzi ? ' on' : ''}`} onClick={() => { act({ type: 'fill', cell: choosing, value: c.hanzi }); setChoosing(null); }} data-testid="infogap-choice">
                <span className="act-choice-hanzi">{c.hanzi}</span>
                <span className="act-choice-gloss">{c.pinyin} · {c.english}</span>
              </button>
            ))}
            {answers[choosing] && <button type="button" className="act-choice clear" onClick={() => { act({ type: 'fill', cell: choosing, value: null }); setChoosing(null); }}>Clear</button>}
          </div>
        </div>
      )}
      {spec.phrases?.length ? (
        <div className="act-phrases">
          {spec.phrases.map((ph) => (
            <button key={ph.hanzi} type="button" className="act-phrase" onClick={() => speak(ph.hanzi)}>
              <span className="act-phrase-hanzi">▶ {ph.hanzi}</span>
              <span className="act-phrase-gloss">{ph.pinyin} — {ph.english}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="act-actions">
        {can({ type: 'reveal' }) && <button type="button" className="act-primary" onClick={() => act({ type: 'reveal' })} data-testid="infogap-check">Check answers</button>}
        {reveal && <span className="act-verdict-inline" data-testid="activity-verdict">{s.results[0]?.answer} right</span>}
        <NextButton can={can} act={act} label="Finish ▸" />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ role-play

function RoleplayView({ session: s, me, role, act, can, speak, spec }: BodyProps & { spec: RoleplaySpec }) {
  const [pinyin, setPinyin] = useState(true);
  const [english, setEnglish] = useState(false);
  const currentRef = useRef<HTMLDivElement>(null);
  // A block body, never `() => el.scrollIntoView(…)`: newer Chrome returns a Promise from the scroll
  // methods, React then takes it for the effect's cleanup and calls it → "n is not a function", which
  // took the whole call down (5 Oct 2026).
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [s.round]);
  const line = spec.lines[s.round];
  const mineNow = s.roles[line.speaker] === me && (s.roles.a !== s.roles.b || line.speaker === role);
  return (
    <div className="act-roleplay">
      <div className="act-rp-head">
        <span className="act-muted">{spec.setting} You are <b>{spec.speakers[role]}</b>.</span>
        <span className="act-toggles">
          <button type="button" className={pinyin ? 'on' : ''} aria-pressed={pinyin} onClick={() => setPinyin((v) => !v)} data-testid="roleplay-pinyin">拼</button>
          <button type="button" className={english ? 'on' : ''} aria-pressed={english} onClick={() => setEnglish((v) => !v)} data-testid="roleplay-english">EN</button>
        </span>
      </div>
      <div className="act-lines">
        {spec.lines.slice(0, s.round + 1).map((l, i) => {
          const current = i === s.round;
          const who = l.speaker === role ? 'mine' : 'theirs';
          return (
            <div key={i} ref={current ? currentRef : undefined} className={`act-line ${who}${current ? ' current' : ' past'}`} data-testid={current ? 'roleplay-current' : undefined}>
              <span className="act-line-who">{spec.speakers[l.speaker]} · {nameOf(s, l.speaker)}</span>
              <span className="act-line-hanzi">{l.hanzi}</span>
              {pinyin && <span className="act-line-pinyin">{l.pinyin}</span>}
              {english && <span className="act-line-english">{l.english}</span>}
              <button type="button" className="act-line-play" onClick={() => speak(l.hanzi)} aria-label="Listen">▶</button>
            </div>
          );
        })}
      </div>
      <div className="act-actions">
        {can({ type: 'line_back' }) && <button type="button" className="act-secondary" onClick={() => act({ type: 'line_back' })} data-testid="roleplay-back">◂ Back</button>}
        <span className="act-turn" data-testid="roleplay-turn">{mineNow ? 'Your line — read it aloud' : `${nameOf(s, line.speaker)}’s line`}</span>
        {can({ type: 'line_done' }) && <button type="button" className="act-primary" onClick={() => act({ type: 'line_done' })} data-testid="roleplay-done">Done ▸</button>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ sentence building

function BuildView({ session: s, me, act, can, speak, spec }: BodyProps & { spec: BuildSpec }) {
  const item = spec.items[s.round];
  const placed = s.data.placed ?? [];
  const pool = (s.data.pool ?? []).filter((i) => !placed.includes(i));
  const reveal = s.phase === 'reveal';
  const built = builtText(spec, s.round, placed);
  const right = built === item.tiles.join('');
  const said = s.data.said ?? [];
  return (
    <div className="act-center">
      <p className="act-instr">Put the words in order together: <b>“{item.english}”</b></p>
      <div className={`act-answer${reveal ? (right ? ' right' : ' wrong') : ''}`} data-testid="build-answer">
        {placed.length === 0 && !reveal && <span className="act-muted">Tap the words below…</span>}
        {placed.map((i) => (
          <button key={i} type="button" className="act-tile placed" disabled={!can({ type: 'unplace', tile: i })} onClick={() => act({ type: 'unplace', tile: i })} data-testid="build-placed">{item.tiles[i]}</button>
        ))}
      </div>
      {!reveal && (
        <div className="act-pool" data-testid="build-pool">
          {pool.map((i) => (
            <button key={i} type="button" className="act-tile" disabled={!can({ type: 'place', tile: i })} onClick={() => act({ type: 'place', tile: i })} data-testid="build-tile">{item.tiles[i]}</button>
          ))}
        </div>
      )}
      {reveal && (
        <div className="act-model" data-testid="build-model">
          <div className={`act-verdict ${right ? 'right' : 'wrong'}`} data-testid="activity-verdict">{right ? '✓ That’s it!' : `✗ You built: ${built || '(nothing)'}`}</div>
          <button type="button" className="act-hanzi act-play" onClick={() => speak(item.tiles.join(''))}>{item.tiles.join('')} ▶</button>
          <div className="act-pinyin">{item.pinyin}</div>
          <div className="act-muted">{item.english}</div>
          <p className="act-instr">🗣 Now both say it aloud.</p>
          <div className="act-said">
            {Object.entries(s.names).map(([uid, name]) => (
              <span key={uid} className={`act-said-chip${said.includes(uid) ? ' on' : ''}`}>{said.includes(uid) ? '✓' : '…'} {name}</span>
            ))}
            {can({ type: 'said' }) && !said.includes(me) && <button type="button" className="act-secondary" onClick={() => act({ type: 'said' })} data-testid="build-said">I said it ✓</button>}
          </div>
        </div>
      )}
      <div className="act-actions">
        {can({ type: 'clear_tiles' }) && <button type="button" className="act-secondary" onClick={() => act({ type: 'clear_tiles' })} data-testid="build-clear">Clear</button>}
        {can({ type: 'reveal' }) && <button type="button" className="act-primary" onClick={() => act({ type: 'reveal' })} data-testid="build-reveal">Reveal answer</button>}
        <NextButton can={can} act={act} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ quick quiz

const LETTERS = 'ABCDEFGH';

function QuizView({ session: s, role, act, can, speak, spec }: BodyProps & { spec: QuizSpec }) {
  const q = spec.questions[s.round];
  const pick = s.data.pick != null ? Number(s.data.pick) : null;
  const asker = role === 'a';
  if (s.phase === 'ready') {
    return asker ? (
      <div className="act-center">
        <p className="act-muted">Next question (only you see this):</p>
        {q.prompt && <div className="act-question">{q.prompt}</div>}
        {q.audio && <button type="button" className="act-secondary" onClick={() => speak(q.audio!)}>🔊 {q.audio} — plays for both when you ask</button>}
        <ol className="act-preview">{q.options.map((o, i) => <li key={i} className={i === q.answer ? 'right' : ''}>{o}{i === q.answer ? ' ✓' : ''}</li>)}</ol>
        <div className="act-actions">
          {can({ type: 'ask' }) && <button type="button" className="act-primary" onClick={() => act({ type: 'ask' })} data-testid="quiz-ask">Ask ▸</button>}
        </div>
      </div>
    ) : (
      <div className="act-center"><Waiting>{nameOf(s, 'a')} is about to ask…</Waiting></div>
    );
  }
  const reveal = s.phase === 'reveal';
  return (
    <div className="act-center">
      <div className="act-question" data-testid="quiz-question">{q.prompt || '🔊 Listen — which one is it?'}</div>
      {q.audio && (asker ? (
        can({ type: 'play_audio' }) && <button type="button" className="act-secondary" onClick={() => act({ type: 'play_audio' })} data-testid="quiz-play">🔊 Play for both</button>
      ) : (
        <button type="button" className="act-secondary" onClick={() => speak(q.audio!)} data-testid="quiz-replay">🔊 Listen again</button>
      ))}
      <div className="act-options">
        {q.options.map((o, i) => {
          const cls = reveal ? (i === q.answer ? ' right' : i === pick ? ' wrong' : ' dim') : i === pick ? ' picked' : '';
          return (
            <button key={i} type="button" className={`act-option${cls}`} disabled={!can({ type: 'pick', option: String(i) })} onClick={() => act({ type: 'pick', option: String(i) })} data-testid="quiz-option">
              <span className="act-letter">{LETTERS[i]}</span> {o}
            </button>
          );
        })}
      </div>
      {!reveal && asker && <p className="act-live" data-testid="quiz-live">{pick === null ? `${nameOf(s, 'b')} is choosing…` : `${nameOf(s, 'b')} picked: ${LETTERS[pick]} ${q.options[pick]}`}</p>}
      {!reveal && !asker && pick !== null && <p className="act-muted">{nameOf(s, 'a')} can see your answer — change it until they reveal.</p>}
      {reveal && (
        <>
          <div className={`act-verdict ${s.data.mark ? 'right' : 'wrong'}`} data-testid="activity-verdict">{s.data.mark ? '✓ Right' : '✗ Not quite'}{q.audio ? ` — it was ${q.audio}` : ''}</div>
          {q.explanation && <p className="act-explain">{q.explanation}</p>}
        </>
      )}
      <div className="act-actions">
        {can({ type: 'reveal' }) && <button type="button" className="act-primary" onClick={() => act({ type: 'reveal' })} data-testid="quiz-reveal">Reveal</button>}
        <MarkButtons s={s} can={can} act={act} />
        <NextButton can={can} act={act} />
      </div>
    </div>
  );
}

function MarkButtons({ s, can, act }: { s: ActivitySession } & Pick<BodyProps, 'can' | 'act'>) {
  if (!can({ type: 'mark', correct: true })) return null;
  return (
    <span className="act-mark" role="radiogroup" aria-label="Mark">
      <button type="button" role="radio" aria-checked={s.data.mark === true} className={s.data.mark === true ? 'on right' : ''} onClick={() => act({ type: 'mark', correct: true })} data-testid="mark-right">✓ Right</button>
      <button type="button" role="radio" aria-checked={s.data.mark === false} className={s.data.mark === false ? 'on wrong' : ''} onClick={() => act({ type: 'mark', correct: false })} data-testid="mark-wrong">✗ Wrong</button>
    </span>
  );
}

// ------------------------------------------------------------------ dictation

/** Sends at most every 160 ms while typing, and the last text always. */
function useThrottled(send: (text: string) => void, ms = 160) {
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (text: string) => {
    pending.current = text;
    const wait = ms - (Date.now() - last.current);
    if (wait <= 0) {
      last.current = Date.now();
      pending.current = null;
      send(text);
    } else if (!timer.current) {
      timer.current = setTimeout(() => {
        timer.current = null;
        last.current = Date.now();
        if (pending.current !== null) send(pending.current);
        pending.current = null;
      }, wait);
    }
  };
}

function DictationView({ session: s, role, act, can, speak, spec }: BodyProps & { spec: DictationSpec }) {
  const item = spec.items[s.round];
  const asker = role === 'a';
  // A new round, a swap or a reset (back to ready) starts the field from the room's draft again.
  const key = `${s.session_id}:${s.round}:${s.roles.b}:${s.phase}`;
  const [text, setText] = useState(s.data.draft ?? '');
  const keyRef = useRef(key);
  useEffect(() => {
    if (keyRef.current !== key) {
      keyRef.current = key;
      setText(s.data.draft ?? '');
    }
  }, [key, s.data.draft]);
  const sendDraft = useThrottled((t) => act({ type: 'draft', text: t }));
  const draft = s.data.draft ?? '';

  if (s.phase === 'ready') {
    return asker ? (
      <div className="act-center">
        <div className="act-hanzi" data-testid="dictation-word">{item.hanzi}</div>
        <div className="act-pinyin">{item.pinyin} · {item.english}</div>
        <p className="act-instr">Say it aloud, then Start (or Start and play it).</p>
        <div className="act-actions">
          <button type="button" className="act-secondary" onClick={() => speak(item.hanzi)}>🔊 Hear it</button>
          {can({ type: 'ask' }) && <button type="button" className="act-primary" onClick={() => act({ type: 'ask' })} data-testid="dictation-start">Start ▸</button>}
        </div>
      </div>
    ) : (
      <div className="act-center"><Waiting>Get ready — {nameOf(s, 'a')} is about to say a word…</Waiting></div>
    );
  }
  if (s.phase === 'reveal') {
    const diff = diffHanzi(draft, item.hanzi);
    return (
      <div className="act-center">
        <div className="act-hanzi">{item.hanzi}</div>
        <div className="act-pinyin">{item.pinyin} · {item.english}</div>
        <div className="act-diff" data-testid="dictation-diff" aria-label={`Written: ${draft || 'nothing'}`}>
          {diff.typed.length === 0 ? <span className="act-muted">(nothing written)</span> : diff.typed.map((m, i) => <span key={i} className={m.hit ? 'hit' : 'miss'}>{m.ch}</span>)}
        </div>
        <div className={`act-verdict ${s.data.mark ? 'right' : 'wrong'}`} data-testid="activity-verdict">{s.data.mark ? '✓ Right' : '✗ Not quite'}</div>
        <div className="act-actions">
          <MarkButtons s={s} can={can} act={act} />
          <NextButton can={can} act={act} />
        </div>
      </div>
    );
  }
  return asker ? (
    <div className="act-center">
      <div className="act-hanzi small">{item.hanzi}</div>
      <p className="act-muted">{item.pinyin} · {item.english}</p>
      <div className="act-live-box" data-testid="dictation-live">
        <span className="act-live-label">{nameOf(s, 'b')} {s.data.submitted ? 'wrote' : 'is writing'}:</span>
        <span className="act-live-text">{draft || '…'}</span>
      </div>
      <div className="act-actions">
        {can({ type: 'play_audio' }) && <button type="button" className="act-secondary" onClick={() => act({ type: 'play_audio' })} data-testid="dictation-play">🔊 Play for both</button>}
        {can({ type: 'reveal' }) && <button type="button" className="act-primary" onClick={() => act({ type: 'reveal' })} data-testid="dictation-reveal">Reveal</button>}
      </div>
    </div>
  ) : (
    <div className="act-center">
      <p className="act-instr">Write what {nameOf(s, 'a')} says — in characters.</p>
      <input
        className="act-input"
        value={s.data.submitted ? draft : text}
        lang="zh-CN"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="汉字…"
        disabled={!!s.data.submitted}
        onChange={(e) => {
          setText(e.target.value);
          sendDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && can({ type: 'submit' })) {
            act({ type: 'draft', text });
            act({ type: 'submit' });
          }
        }}
        data-testid="dictation-input"
      />
      <div className="act-actions">
        <button type="button" className="act-secondary" onClick={() => speak(item.hanzi)} data-testid="dictation-hear">🔊 Hear it</button>
        {can({ type: 'submit' }) && (
          <button type="button" className="act-primary" onClick={() => { act({ type: 'draft', text }); act({ type: 'submit' }); }} data-testid="dictation-submit">Submit</button>
        )}
        {s.data.submitted && <span className="act-muted">Sent — {nameOf(s, 'a')} will reveal it.</span>}
      </div>
    </div>
  );
}
