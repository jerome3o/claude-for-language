/**
 * "🎤 Read it aloud" on a graded reader page (docs/STUDY_SESSION.md "Graded readers" → "Read it
 * aloud"; rules in shared/reader/readAloud.ts). The 🎤 sits in the page's audio row beside the speed
 * chip (`ReadAloudMic`); a tap records through the voice boxes' pipeline (`useVoiceDictation`: the
 * live transcript while he reads, upload fallback, "Couldn't transcribe — tap to retry", the
 * signed-out state); tap again to stop, and the take is judged against the page's own Chinese. The
 * result marks the page's Chinese IN PLACE (ReaderWordsText `marks`) — no second copy — with one line
 * under the audio ("✓ 92% — 2 to check") and the transcript small behind "You said ▸"
 * (`ReadAloudPanel`). 🎤 again replaces the result. Practice only: nothing is stored or queued
 * (offline → "Needs a connection to check your reading"). Lab: ui/readers/ReadAloud.kt.
 */
import { useEffect, useRef, useState } from 'react';
import {
  judgeReadAloud,
  readAloudBucket,
  readAloudHeardAnything,
  readAloudLine,
  readAloudTone,
  READ_ALOUD_AGAIN,
  READ_ALOUD_CHECKING,
  READ_ALOUD_EMPTY,
  READ_ALOUD_LABEL,
  READ_ALOUD_LISTENING,
  READ_ALOUD_OFFLINE,
  READ_ALOUD_STOP,
  READ_ALOUD_YOU_SAID,
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
  toggle: () => void;
}

/** One page's read-aloud state (the caller keys the page, so a page turn starts afresh). */
export function useReadAloud(pageText: string, hooks: { onStart?: () => void; onResult?: () => void } = {}): ReadAloud {
  const [result, setResult] = useState<ReadAloudResult | null>(null);
  const [said, setSaid] = useState('');
  const [offlineNote, setOfflineNote] = useState(false);
  const latest = useRef({ pageText, hooks });
  latest.current = { pageText, hooks };
  const dictation = useVoiceDictation({
    surface: 'reader_read_aloud',
    value: '',
    onChange: () => {},
    autoSubmit: true,
    onSubmit: (answer) => {
      const { pageText: text, hooks: h } = latest.current;
      if (!readAloudHeardAnything(answer.text)) {
        track('reader.read_aloud', { result_bucket: 'empty', chars: 0, via: answer.via ?? 'none' });
        return;
      }
      const r = judgeReadAloud(text, answer.text);
      setResult(r);
      setSaid(answer.text.trim());
      track('reader.read_aloud', { result_bucket: readAloudBucket(r.pct), chars: r.total, via: answer.via ?? 'none' });
      h.onResult?.();
    },
  });
  const { state } = dictation;
  const failed = state.phase === 'failed';
  const reported = useRef(false);
  useEffect(() => {
    if (failed && !reported.current) {
      reported.current = true;
      track('reader.read_aloud', { result_bucket: state.failure === 'empty' ? 'empty' : 'failed', chars: 0, via: 'none' });
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

  return { dictation, result, said, offlineNote, toggle };
}

/** 🎤 in the page's audio row: Read it aloud · ⏹ Stop · Say it again (icon button, 44px). */
export function ReadAloudMic({ ra }: { ra: ReadAloud }) {
  const { state } = ra.dictation;
  if (state.blocked === 'unsupported') return null;
  const listening = state.phase === 'listening';
  const finishing = state.phase === 'finishing';
  const label = listening ? READ_ALOUD_STOP : finishing ? READ_ALOUD_CHECKING : ra.result ? READ_ALOUD_AGAIN : READ_ALOUD_LABEL;
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
      data-testid="reader-read-aloud"
    >
      {finishing ? <span className="spinner reader-read-aloud-spinner" aria-hidden="true" /> : <span aria-hidden="true">{listening ? '⏹' : '🎤'}</span>}
    </button>
  );
}

/** Under the audio row: the live transcript, then the one result line (+ "You said" collapsed), or why there is none. */
export function ReadAloudPanel({ ra }: { ra: ReadAloud }) {
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
          <span className="reader-read-aloud-hint">{READ_ALOUD_LISTENING}</span>
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
      {showSaid && (
        <div className="reader-read-aloud-said" lang="zh-CN" data-testid="reader-read-aloud-said">{said}</div>
      )}
    </div>
  );
}
