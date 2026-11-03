/**
 * "🎤 Read it aloud" on a graded reader page (docs/STUDY_SESSION.md "Graded readers" → "Read it
 * aloud"; rules in shared/reader/readAloud.ts). The 🎤 sits in the page's audio row beside the speed
 * chip (`ReadAloudMic`); a tap records through the voice boxes' pipeline (`useVoiceDictation`: the
 * live transcript while he reads, upload fallback, "Couldn't transcribe — tap to retry", the
 * signed-out state); tap again to stop, and the take is judged against the page's own Chinese. The
 * result marks the page's Chinese IN PLACE (ReaderWordsText `marks`) — no second copy — with one small,
 * muted line under the audio ("✓ 92% — 2 to check"), a tiny legend of the marks it shows (wavy = tone
 * off, solid = wrong, dashed = missed, ‸ = extra words; ReadAloud.css) and the transcript behind
 * "You said ▸" (`ReadAloudPanel`). 🎤 again replaces the result. Practice only: nothing is stored or queued
 * (offline → "Needs a connection to check your reading"). Lab: ui/readers/ReadAloud.kt.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  judgeReadAloud,
  readAloudAllRight,
  readAloudBucket,
  readAloudDifferenceAt,
  readAloudDifferences,
  readAloudLocksPage,
  READ_ALOUD_DIFF_KIND,
  readAloudHeardAnything,
  readAloudLegend,
  readAloudLine,
  readAloudTone,
  READ_ALOUD_LEGEND,
  READ_ALOUD_AGAIN,
  READ_ALOUD_CHECKING,
  READ_ALOUD_EMPTY,
  READ_ALOUD_LABEL,
  READ_ALOUD_LISTENING,
  READ_ALOUD_OFFLINE,
  READ_ALOUD_STOP,
  READ_ALOUD_STOP_RECORDING,
  READ_ALOUD_YOU_SAID,
  type ReadAloudDifference,
  type ReadAloudHeardChar,
  type ReadAloudLegendKey,
  type ReadAloudResult,
} from '@shared/reader/readAloud';
import { practiseBlockNote } from '@shared/coach';
import { useVoiceDictation, type VoiceDictation } from '../../hooks/useVoiceDictation';
import { YouSaidFailed } from '../study/YouSaid';
import { track } from '../../services/analytics';
import './ReadAloud.css';

export interface ReadAloud {
  dictation: VoiceDictation;
  result: ReadAloudResult | null;
  /** What was heard (the take's transcript). */
  said: string;
  /** 🎤 tapped while offline: say why. */
  offlineNote: boolean;
  /**
   * A take is under way (recording, or stopped and being checked): the page is locked
   * (`readAloudLocksPage`) — the reading view swaps its footer for "■ Stop recording" and disables
   * what would disturb the take.
   */
  locked: boolean;
  /** Recording right now (the footer's Stop is live; while finishing it says "Checking…"). */
  recording: boolean;
  /** Stop the take (= the ⏹): it is checked and marked as usual. No-op unless recording. */
  stop: () => void;
  /** Counts the takes read ALL right (`readAloudAllRight`): a new value = one burst of confetti. */
  perfectTakes: number;
  /** The result's differences, one per page word (`readAloudDifferences` over the words shown). */
  diffs: ReadAloudDifference[];
  /** The page's words (their texts) from the reading view's chips — the differences group by them. */
  setWords: (texts: string[] | null) => void;
  /** A tap on a marked word: its difference row is scrolled to and lit (`tick` makes a second tap on the same row count). */
  focused: { index: number; tick: number } | null;
  focusAt: (cp: number) => void;
  toggle: () => void;
}

/** Where a read-aloud runs: the voice surface and the analytics event (+ props from the result). */
export interface ReadAloudPlace {
  surface: string;
  event: 'reader.read_aloud' | 'coach.ask_read_back';
  /** Extra event props from the result (null = no result: failed / empty). */
  props?: (r: ReadAloudResult | null) => Record<string, string | number | boolean>;
}

const READER_PLACE: ReadAloudPlace = { surface: 'reader_read_aloud', event: 'reader.read_aloud' };

/**
 * One text's read-aloud state (the caller keys the text, so a page turn starts afresh). Reader pages
 * by default; the Claude chat's "🎤 Read it back" passes its own `place`.
 */
export function useReadAloud(
  pageText: string,
  hooks: { onStart?: () => void; onResult?: (r: ReadAloudResult, said: string) => void } = {},
  place: ReadAloudPlace = READER_PLACE,
): ReadAloud {
  const [result, setResult] = useState<ReadAloudResult | null>(null);
  const [said, setSaid] = useState('');
  const [offlineNote, setOfflineNote] = useState(false);
  const [perfectTakes, setPerfectTakes] = useState(0);
  const [words, setWords] = useState<string[] | null>(null);
  const [focused, setFocused] = useState<{ index: number; tick: number } | null>(null);
  const latest = useRef({ pageText, hooks, place });
  latest.current = { pageText, hooks, place };
  const dictation = useVoiceDictation({
    surface: place.surface,
    value: '',
    onChange: () => {},
    autoSubmit: true,
    onSubmit: (answer) => {
      const { pageText: text, hooks: h, place: p } = latest.current;
      if (!readAloudHeardAnything(answer.text)) {
        track(p.event, { result_bucket: 'empty', chars: 0, via: answer.via ?? 'none', all_right: false, ...p.props?.(null) });
        return;
      }
      const r = judgeReadAloud(text, answer.text);
      const allRight = readAloudAllRight(r);
      setResult(r);
      setSaid(answer.text.trim());
      track(p.event, { result_bucket: readAloudBucket(r.pct), chars: r.total, via: answer.via ?? 'none', all_right: allRight, ...p.props?.(r) });
      if (allRight) {
        // The whole page read right: confetti (once for this take) and a happy buzz.
        setPerfectTakes((n) => n + 1);
        try {
          navigator.vibrate?.([14, 60, 22]);
        } catch {
          // no haptics
        }
      }
      h.onResult?.(r, answer.text.trim());
    },
  });
  const { state } = dictation;
  const failed = state.phase === 'failed';
  const reported = useRef(false);
  useEffect(() => {
    if (failed && !reported.current) {
      reported.current = true;
      const p = latest.current.place;
      track(p.event, { result_bucket: state.failure === 'empty' ? 'empty' : 'failed', chars: 0, via: 'none', all_right: false, ...p.props?.(null) });
    }
    if (!failed) reported.current = false;
  }, [failed, state.failure]);
  useEffect(() => {
    if (state.blocked !== 'offline') setOfflineNote(false);
  }, [state.blocked]);

  const toggle = () => {
    if (state.phase === 'listening') return dictation.stop();
    if (state.phase === 'finishing') return;
    if (state.blocked === 'offline') {
      setOfflineNote(true);
      return;
    }
    setResult(null);
    setSaid('');
    latest.current.hooks.onStart?.();
    dictation.say();
  };

  const diffs = useMemo(() => (result ? readAloudDifferences(result, words) : []), [result, words]);
  useEffect(() => {
    setFocused(null);
  }, [result]);
  const focusAt = (cp: number) => {
    const index = readAloudDifferenceAt(diffs, cp);
    if (index < 0) return;
    track('reader.read_aloud_diff', { action: 'tap_page', kind: diffs[index].kind });
    setFocused((f) => ({ index, tick: (f?.tick ?? 0) + 1 }));
  };

  const recording = state.phase === 'listening';
  const stop = () => {
    if (state.phase === 'listening') dictation.stop();
  };

  return { dictation, result, said, offlineNote, locked: readAloudLocksPage(state.phase), recording, stop, perfectTakes, diffs, setWords, focused, focusAt, toggle };
}

/**
 * The reading view's footer while a take is under way: ONE big red "■ Stop recording" in the slot
 * of Previous / Next / Finish (so a thumb aimed at Next stops the take instead of losing the page),
 * then a disabled "Checking your reading…" until the result shows.
 */
export function ReadAloudStopFooter({ recording, onStop }: { recording: boolean; onStop: () => void }) {
  return (
    <div className="study-reader-nav reader-read-aloud-footer" data-testid="reader-read-aloud-footer">
      <button
        type="button"
        className={`btn reader-read-aloud-stop-btn${recording ? '' : ' checking'}`}
        onClick={onStop}
        disabled={!recording}
        data-testid="reader-read-aloud-stop-footer"
      >
        {recording ? (
          <>
            <span className="reader-read-aloud-stop-square" aria-hidden="true" />
            {READ_ALOUD_STOP_RECORDING}
          </>
        ) : (
          <>
            <span className="spinner reader-read-aloud-spinner" aria-hidden="true" />
            {READ_ALOUD_CHECKING}
          </>
        )}
      </button>
    </div>
  );
}

/** 🎤 in the page's audio row: Read it aloud · ⏹ Stop · Say it again (icon button, 44px). */
export function ReadAloudMic({ ra, idleLabel = READ_ALOUD_LABEL, testId = 'reader-read-aloud' }: { ra: ReadAloud; idleLabel?: string; testId?: string }) {
  const { state } = ra.dictation;
  if (state.blocked === 'unsupported') return null;
  const listening = state.phase === 'listening';
  const finishing = state.phase === 'finishing';
  const label = listening ? READ_ALOUD_STOP : finishing ? READ_ALOUD_CHECKING : ra.result ? READ_ALOUD_AGAIN : idleLabel;
  return (
    <button
      type="button"
      className={`reader-read-aloud-mic${listening ? ' listening' : ''}${ra.result ? ' has-result' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        ra.toggle();
      }}
      disabled={finishing}
      aria-pressed={listening}
      aria-label={label}
      title={label}
      data-testid={testId}
    >
      {finishing ? <span className="spinner reader-read-aloud-spinner" aria-hidden="true" /> : <span aria-hidden="true">{listening ? '⏹' : '🎤'}</span>}
    </button>
  );
}

/** Under the audio row: the live transcript, then the one result line (+ "You said" collapsed), or why there is none. */
export function ReadAloudPanel({ ra, onSpeak, listeningText = READ_ALOUD_LISTENING }: { ra: ReadAloud; onSpeak?: (text: string) => void; listeningText?: string }) {
  const { dictation, result, said } = ra;
  const { state } = dictation;
  const [showSaid, setShowSaid] = useState(false);
  useEffect(() => {
    setShowSaid(false);
  }, [result]);
  const listening = state.phase === 'listening';
  const failed = state.phase === 'failed';
  const blockNote = state.blocked && state.blocked !== 'offline' && state.blocked !== 'unsupported' ? practiseBlockNote(state.blocked) : null;

  if (listening) {
    return (
      <div className="reader-read-aloud-live" aria-live="polite" data-testid="reader-read-aloud-live">
        {dictation.finalText || dictation.partialText ? (
          <span lang="zh-CN">
            {dictation.finalText}
            <span className="reader-read-aloud-partial">{dictation.partialText}</span>
          </span>
        ) : (
          <span className="reader-read-aloud-hint">{listeningText}</span>
        )}
      </div>
    );
  }
  if (state.phase === 'finishing') return <p className="reader-read-aloud-hint" role="status">{READ_ALOUD_CHECKING}</p>;
  if (failed && state.failure !== 'empty') {
    return (
      <YouSaidFailed
        onRetry={dictation.retryUpload}
        note="Or record it again"
        signedOut={state.failure === 'signed_out'}
        testId="reader-read-aloud-retry"
      />
    );
  }
  if (failed) return <p className="reader-read-aloud-hint" role="status" data-testid="reader-read-aloud-empty">{READ_ALOUD_EMPTY}</p>;
  if (ra.offlineNote && state.blocked === 'offline') {
    return <p className="reader-read-aloud-hint" role="status" data-testid="reader-read-aloud-offline">{READ_ALOUD_OFFLINE}</p>;
  }
  if (blockNote) return <p className="reader-read-aloud-hint" role="status">{blockNote}</p>;
  if (!result) return null;
  return (
    <div className="reader-read-aloud-result" data-testid="reader-read-aloud-result">
      <div className="reader-read-aloud-line-row">
        <span className={`reader-read-aloud-line tone-${readAloudTone(result)}`} role="status" data-testid="reader-read-aloud-line">
          {readAloudLine(result)}
        </span>
        <button
          type="button"
          className="reader-read-aloud-said-toggle"
          onClick={(e) => {
            e.stopPropagation();
            setShowSaid((s) => !s);
          }}
          aria-expanded={showSaid}
          data-testid="reader-read-aloud-said-toggle"
        >
          {READ_ALOUD_YOU_SAID} {showSaid ? '▾' : '▸'}
        </button>
      </div>
      <ReadAloudLegend keys={readAloudLegend(result)} />
      <ReadAloudDifferences diffs={ra.diffs} focused={ra.focused} onSpeak={onSpeak} />
      {showSaid && (
        <div className="reader-read-aloud-said" lang="zh-CN" data-testid="reader-read-aloud-said">
          {result.heard && result.heard.length > 0 ? <HeardChars chars={result.heard} /> : said}
        </div>
      )}
    </div>
  );
}

/** The transcript with what differs marked like the page (a homophone unmarked — it was right; extra words solid). */
function HeardChars({ chars }: { chars: readonly ReadAloudHeardChar[] }) {
  return (
    <>
      {chars.map((c, i) => {
        if (c.mark === 'plain' || c.mark === 'ok' || c.mark === 'sound') return <span key={i}>{c.char}</span>;
        const cls = c.mark === 'close' ? 'ra-close' : 'ra-wrong';
        const title = c.mark === 'extra' ? 'extra — not on the page' : c.mark === 'close' ? 'tone off' : 'not what the page says';
        return <span key={i} className={`ra-char ${cls}`} data-mark={c.mark} title={title}>{c.char}</span>;
      })}
    </>
  );
}

const DIFFS_SHOWN = 6;

/**
 * What it heard vs what the page says, one row per word (Jerome: "I'd love to see what the app thought I
 * was saying versus what it should have been"): the page's word + pinyin, what was heard + pinyin, ▶ the
 * page's word, and a reason line per character ("都 dū → you said dù (4th tone instead of 1st)"). A
 * homophone-only word is a muted "Sounded right" row (not to check). A tap on a marked word in the page
 * lights its row. Lab: ReadAloudViews.kt `ReadAloudDifferences`.
 */
export function ReadAloudDifferences({ diffs, focused, onSpeak }: {
  diffs: readonly ReadAloudDifference[];
  focused: { index: number; tick: number } | null;
  onSpeak?: (text: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const [lit, setLit] = useState<number | null>(null);
  useEffect(() => {
    if (!focused) return;
    if (focused.index >= DIFFS_SHOWN) setShowAll(true);
    setLit(focused.index);
    const t = setTimeout(() => setLit(null), 1600);
    requestAnimationFrame(() => rows.current[focused.index]?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }));
    return () => clearTimeout(t);
  }, [focused]);
  if (diffs.length === 0) return null;
  const shown = showAll ? diffs : diffs.slice(0, DIFFS_SHOWN);
  return (
    <>
      <ol className="ra-diffs" data-testid="reader-read-aloud-diffs" aria-label="What it heard vs the page">
        {shown.map((d, i) => (
          <li
            key={`${d.start}-${d.end}`}
            ref={(el) => {
              rows.current[i] = el;
            }}
            className={`ra-diff kind-${d.kind}${d.toCheck ? '' : ' is-right'}${lit === i ? ' is-lit' : ''}`}
            data-testid="reader-read-aloud-diff"
            data-kind={d.kind}
          >
            <div className="ra-diff-pair">
              <div className="ra-diff-side">
                <span className="ra-diff-label">Page</span>
                <span className="ra-diff-zh" lang="zh-CN">{d.page || '—'}</span>
                {d.pagePinyin && <span className="ra-diff-py">{d.pagePinyin}</span>}
              </div>
              <span className="ra-diff-vs" aria-hidden="true">vs</span>
              <div className="ra-diff-side">
                <span className="ra-diff-label">You said</span>
                <span className="ra-diff-zh" lang="zh-CN">{d.heard || '—'}</span>
                {d.heardPinyin && <span className="ra-diff-py">{d.heardPinyin}</span>}
              </div>
              <span className="ra-diff-kind">{READ_ALOUD_DIFF_KIND[d.kind]}</span>
              {onSpeak && d.page && (
                <button
                  type="button"
                  className="ra-diff-play"
                  onClick={(e) => {
                    e.stopPropagation();
                    track('reader.read_aloud_diff', { action: 'play', kind: d.kind });
                    onSpeak(d.page);
                  }}
                  aria-label={`Play ${d.page}`}
                  title={`Play ${d.page}`}
                  data-testid="reader-read-aloud-diff-play"
                >
                  ▶
                </button>
              )}
            </div>
            <ul className="ra-diff-reasons">
              {d.reasons.map((r, k) => <li key={k} lang="zh-CN">{r}</li>)}
            </ul>
          </li>
        ))}
      </ol>
      {!showAll && diffs.length > DIFFS_SHOWN && (
        <button type="button" className="ra-diffs-more" onClick={(e) => { e.stopPropagation(); setShowAll(true); }}>
          Show {diffs.length - DIFFS_SHOWN} more
        </button>
      )}
    </>
  );
}

/** A sample of each mark the page shows, with its word ("‿ tone off · ▁ wrong · ╌ missed · ‸ extra words"). */
export function ReadAloudLegend({ keys }: { keys: readonly ReadAloudLegendKey[] }) {
  if (keys.length === 0) return null;
  return (
    <div className="reader-read-aloud-legend" data-testid="reader-read-aloud-legend">
      {keys.map((k) => (
        <span key={k} className="reader-read-aloud-legend-item" data-legend={k}>
          {k === 'extra' ? (
            <span className="ra-swatch ra-extra" aria-hidden="true">‸</span>
          ) : (
            <span className={`ra-swatch ra-char ra-${k}`} aria-hidden="true">{'\u00a0'.repeat(6)}</span>
          )}
          {READ_ALOUD_LEGEND[k]}
        </span>
      ))}
    </div>
  );
}
