import { Fragment, useRef, useState } from 'react';
import {
  recapBar, recapKeepHint, recapKeepLabel, recapKey, recapProgress, recapRightFirstTime, recapSource, recapWhyLines, recapWordFor, recapWords,
  RECAP_SAY_LABEL, RECAP_SAY_LISTENING, recapSaySuggestion,
  type WordRecapRun, type WordRecapSource, type WordRecapWord,
} from '@shared/study/wordRecap';
import type { PassOutcome } from '@shared/homework/pass-card';
import { PractiseSentence } from '../coach/PractiseSentence';
import { track } from '../../services/analytics';
import type { ExplorerSource } from '../explorer/ExplorerContext';
import { retryBarNote } from '@shared/homework';
import { RetryProgressBar } from '../homework/RetryProgressBar';
import { ExplorableText } from '../explorer/ExplorableText';
import { Confetti } from '../Confetti';
import '../homework/homework.css';
import '../StudyReader.css';
import './ReaderRecap.css';

export interface ReaderRecapActions {
  answer: (key: string, right: boolean) => void;
  keep: (key: string, on: boolean) => void;
  restart: () => void;
  /** Done: apply the switches (the caller bumps / adds and leaves). */
  done: () => void;
  close: () => void;
  speak: (text: string) => void;
}

/** The explorer source of a recap's words. */
const explorerSource = (source: WordRecapSource): ExplorerSource => (source === 'chat' ? 'claude_chat' : 'reader');

/**
 * The word recap (docs/STUDY_SESSION.md "Reader word recap"): a ONE-OFF pass over the words
 * collected while reading a graded reader — or in a "💬 Ask Claude" chat (the run's `source`; the
 * cue is then the chat message's sentence) —, in story / chat order — the homework pass's rules (`passProgress`: "Not yet"
 * words come back until "Got it", the retry bar), practice only. Each card: the word with the story
 * sentence it came from (the word marked) → Show answer → pinyin, meaning, ▶, the page in English,
 * why it is here, and its switch (OFF by default): "Add to my long-term review" for a new word,
 * "⚡ Study it today" for one already in the decks. Then the list of every word with its switch, and
 * Done. Stateless: the page (pages/ReaderRecapPage) holds the run.
 */
export function ReaderRecapView({
  run,
  title,
  sourceLabel,
  owned,
  glosses,
  online,
  doneLine,
  actions,
}: {
  run: WordRecapRun;
  title: string;
  /** Where the words come from: "from the story “…”" / "from your chat with Claude". */
  sourceLabel?: string;
  /** Recap keys of words already in his decks. */
  owned: ReadonlySet<string>;
  /** Meanings looked up for words whose chip had none (the word dictionary). */
  glosses: ReadonlyMap<string, string>;
  online: boolean;
  /** After Done: the outcome line ("2 words added …"). */
  doneLine: string | null;
  actions: ReaderRecapActions;
}) {
  const progress = recapProgress(run);
  const [listing, setListing] = useState(false);
  const nextKey = progress.remaining[0] ?? null;
  const word = nextKey ? recapWordFor(run, nextKey) : null;
  // A word shown again after "Not yet" is a fresh card.
  const attempt = nextKey ? run.events.filter((e) => e.item_id === nextKey).length : 0;
  const showList = listing || progress.complete || !word;
  const source = recapSource(run);

  return (
    <div className="study-fullscreen recap" data-testid="reader-recap">
      <div className="study-topbar">
        <span className="study-topbar-label" lang="zh">📝 {title}</span>
        <div className="study-topbar-controls">
          {!showList && (
            <button type="button" className="btn btn-secondary btn-sm recap-list-btn" onClick={() => setListing(true)} data-testid="recap-to-list">
              Choose words
            </button>
          )}
          <button className="study-close-btn" onClick={actions.close} aria-label="Close">✕</button>
        </div>
      </div>
      {sourceLabel && <p className="recap-source" lang="zh-CN" data-testid="recap-source">{sourceLabel}</p>}
      {showList ? (
        <RecapSummary source={source} run={run} owned={owned} glosses={glosses} online={online} complete={progress.complete} doneLine={doneLine} actions={actions} onBack={!progress.complete && word ? () => setListing(false) : undefined} />
      ) : (
        <>
          <RetryProgressBar bar={recapBar(run)} className="hw-pass-progress" testId="recap-progress" />
          <RecapNote run={run} />
          <RecapCard
            key={`${nextKey}:${attempt}`}
            source={source}
            word={word!}
            owned={owned.has(nextKey!)}
            kept={run.keep.includes(nextKey!)}
            gloss={word!.gloss || glosses.get(nextKey!) || ''}
            actions={actions}
          />
        </>
      )}
    </div>
  );
}

function RecapNote({ run }: { run: WordRecapRun }) {
  const note = retryBarNote(recapBar(run));
  if (!note) return null;
  return <div className="hw-pass-meta"><span className="hw-pass-retry" data-testid="recap-retry">{note}</span></div>;
}

/** The story sentence with the word marked. */
function MarkedSentence({ sentence, hanzi }: { sentence: string; hanzi: string }) {
  const at = sentence.indexOf(hanzi);
  if (at < 0) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, at)}
      <mark className="recap-mark">{hanzi}</mark>
      {sentence.slice(at + hanzi.length)}
    </>
  );
}

export function RecapKeepSwitch({ owned, on, onChange, testId = 'recap-keep' }: { owned: boolean; on: boolean; onChange: (on: boolean) => void; testId?: string }) {
  const label = recapKeepLabel(owned);
  return (
    <label className={`hw-longterm recap-keep${on ? ' is-on' : ''}`} data-testid={testId}>
      <span className="hw-longterm-label">{label}</span>
      <span className="hw-longterm-switch">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          onChange={(e) => {
            try { navigator.vibrate?.(10); } catch { /* no haptics */ }
            onChange(e.target.checked);
          }}
          aria-label={label}
          data-testid={`${testId}-switch`}
        />
        <span className="hw-longterm-track" aria-hidden="true"><span className="hw-longterm-thumb" /></span>
      </span>
    </label>
  );
}

function RecapCard({ source, word, owned, kept, gloss, actions }: { source: WordRecapSource; word: WordRecapWord; owned: boolean; kept: boolean; gloss: string; actions: ReaderRecapActions }) {
  const xs = explorerSource(source);
  const [revealed, setRevealed] = useState(false);
  const key = recapKey(word.hanzi);
  // 🎤 Say it: a take started before Show answer is the question side; said right, it suggests Got it.
  const takeSide = useRef<'question' | 'answer'>('question');
  const [suggested, setSuggested] = useState<PassOutcome | null>(null);
  const reveal = () => {
    setRevealed(true);
    actions.speak(word.hanzi);
  };
  return (
    <>
      <div className="study-card-content recap-card" data-testid="recap-card">
        <div className="recap-word hanzi" lang="zh-CN">
          {revealed ? <ExplorableText text={word.hanzi} source={xs} /> : word.hanzi}
        </div>
        {word.sentence && (
          <p className="recap-sentence" lang="zh-CN" data-testid="recap-sentence">
            {revealed ? <ExplorableText text={word.sentence} source={xs} highlight={word.hanzi} /> : <MarkedSentence sentence={word.sentence} hanzi={word.hanzi} />}
          </p>
        )}
        <PractiseSentence
          hanzi={word.hanzi}
          testId="recap-say"
          className="recap-say"
          label={RECAP_SAY_LABEL}
          listeningLine={RECAP_SAY_LISTENING}
          surface="reader_recap"
          showListen={false}
          onStart={() => { takeSide.current = revealed ? 'answer' : 'question'; }}
          onPractised={(p) => {
            if (takeSide.current === 'question') setSuggested(recapSaySuggestion(p.result.state));
          }}
          onOutcome={(result) => track('reader.recap_say', { result, side: takeSide.current, source })}
        />
        {revealed && (
          <div className="recap-back" data-testid="recap-back">
            <div className="recap-pinyin-row">
              <button type="button" className="recap-play" onClick={() => actions.speak(word.hanzi)} aria-label={`Play ${word.hanzi}`}>▶</button>
              <span className="recap-pinyin">{word.pinyin}</span>
            </div>
            <div className="recap-meaning" data-testid="recap-meaning">{gloss || 'Tap the word for its meaning'}</div>
            {word.page_english && <p className="recap-page-english"><span className="recap-label">The page</span> {word.page_english}</p>}
            <ul className="recap-why" data-testid="recap-why">
              {recapWhyLines(word, source).map((l) => <li key={l}>{l}</li>)}
            </ul>
            <RecapKeepSwitch owned={owned} on={kept} onChange={(on) => actions.keep(key, on)} />
          </div>
        )}
      </div>
      <div className="study-reader-nav recap-footer">
        {revealed ? (
          <>
            <button type="button" className="btn recap-not-yet" onClick={() => actions.answer(key, false)} data-testid="recap-not-yet">Not yet</button>
            <button
              type="button"
              className={`btn recap-got-it${suggested === 'right' ? ' is-suggested' : ''}`}
              onClick={() => actions.answer(key, true)}
              data-testid="recap-got-it"
              data-suggested={suggested === 'right' ? 'true' : undefined}
            >
              Got it
              {suggested === 'right' && <span className="recap-suggested-hint">✓ suggested</span>}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary recap-show" onClick={reveal} data-testid="recap-show">Show answer</button>
        )}
      </div>
    </>
  );
}

function RecapSummary({ source, run, owned, glosses, online, complete, doneLine, actions, onBack }: {
  source: WordRecapSource;
  run: WordRecapRun;
  owned: ReadonlySet<string>;
  glosses: ReadonlyMap<string, string>;
  online: boolean;
  complete: boolean;
  doneLine: string | null;
  actions: ReaderRecapActions;
  onBack?: () => void;
}) {
  const firstTime = recapRightFirstTime(run);
  const words = recapWords(run);
  const keptNew = words.filter((w) => run.keep.includes(recapKey(w.hanzi)) && !owned.has(recapKey(w.hanzi))).length;
  const [celebrate] = useState(complete);
  return (
    <>
      <div className="study-card-content recap-summary" data-testid="recap-summary">
        {celebrate && complete && <Confetti />}
        <h2 className="recap-summary-title">{complete ? 'Recap done 🎉' : 'Choose words to keep'}</h2>
        <p className="recap-summary-line">
          {words.length} {words.length === 1 ? 'word' : 'words'}
          {complete ? ` · ${firstTime} right first time` : ''}
        </p>
        <p className="recap-summary-hint">{recapKeepHint(source)}</p>
        <ul className="recap-list">
          {words.map((w) => {
            const key = recapKey(w.hanzi);
            const has = owned.has(key);
            return (
              <li key={key} className="recap-row" data-testid="recap-row">
                <div className="recap-row-word">
                  <span className="recap-row-hanzi" lang="zh-CN"><ExplorableText text={w.hanzi} source={explorerSource(source)} /></span>
                  <span className="recap-row-pinyin">{w.pinyin}</span>
                  <span className="recap-row-gloss">{w.gloss || glosses.get(key) || ''}</span>
                  <span className="recap-row-tags">
                    {w.reasons.map((r) => (
                      <Fragment key={r}><span className={`recap-tag recap-tag--${r}`}>{r === 'tapped' ? 'tapped' : 'said wrong'}</span></Fragment>
                    ))}
                  </span>
                </div>
                <RecapKeepSwitch owned={has} on={run.keep.includes(key)} onChange={(on) => actions.keep(key, on)} testId="recap-row-keep" />
              </li>
            );
          })}
        </ul>
        {!online && keptNew > 0 && <p className="recap-summary-hint" data-testid="recap-offline">The new cards are made when you&rsquo;re back online.</p>}
        {doneLine && <p className="recap-done-line" role="status" data-testid="recap-done-line">{doneLine}</p>}
      </div>
      <div className="study-reader-nav recap-footer">
        {onBack ? (
          <button type="button" className="btn btn-secondary" onClick={onBack} data-testid="recap-back-to-cards">‹ Back to the cards</button>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={actions.restart} data-testid="recap-again">↺ Again</button>
        )}
        <button type="button" className="btn btn-primary" onClick={actions.done} disabled={!!doneLine} data-testid="recap-done">Done</button>
      </div>
    </>
  );
}
