import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { recapDoneLine, recapEmptyLine, recapKey, type WordRecapSource } from '@shared/study/wordRecap';
import {
  answerRecapWord, finishRecap, ownedRecapNotes, restartRecapRun, setRecapWordKeep, useRecapRun,
} from '../../services/wordRecap';
import { lookupWords } from '../../services/wordDict';
import { useLessonSpeak } from '../editor/useLessonSpeak';
import { useNetwork } from '../../contexts/NetworkContext';
import { ReaderRecapView } from './ReaderRecapView';
import '../../pages/StudyPage.css';

/** Meanings for words the chip had none for (device-segmented text): the word dictionary, cache-first. */
function useRecapGlosses(hanzi: readonly string[], wordsKey: string): Map<string, string> {
  const [glosses, setGlosses] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (hanzi.length === 0) return;
    let cancelled = false;
    void (async () => {
      const found = await lookupWords([...hanzi]);
      const out = new Map<string, string>();
      // CC-CEDICT's cross-references ("see 成都市") aren't a meaning: the first real sense, else the target's.
      const seeAlso = new Map<string, string>();
      for (const [h, r] of found) {
        if (r.status !== 'ok') continue;
        const senses = [r.record.english, ...r.record.senses].filter(Boolean);
        const meaning = senses.find((m) => !/^see\s/i.test(m));
        if (meaning) out.set(recapKey(h), meaning);
        else {
          const target = senses.map((m) => /^see\s+([\p{Script=Han}]+)/u.exec(m)?.[1]).find(Boolean);
          if (target) seeAlso.set(h, target);
        }
      }
      if (seeAlso.size) {
        const targets = await lookupWords([...seeAlso.values()]);
        for (const [h, target] of seeAlso) {
          const r = targets.get(target);
          const meaning = r?.status === 'ok' ? [r.record.english, ...r.record.senses].find((m) => m && !/^see\s/i.test(m)) : undefined;
          if (meaning) out.set(recapKey(h), meaning);
        }
      }
      if (!cancelled) setGlosses(out);
    })().catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordsKey]);
  return glosses;
}

/**
 * The word recap pass for one run (docs/STUDY_SESSION.md "Reader word recap") — a graded reader's
 * reading (pages/ReaderRecapPage, `/readers/:id/recap`) or a "💬 Ask Claude" chat
 * (pages/ClaudeChatRecapPage, `/coach/chat/:id/recap`). Immersive, offline-first: the run lives on
 * the device (services/wordRecap.ts). `runId` = the reader id or `chatRecapRunId(thread)`.
 */
export function WordRecapPass({
  runId,
  source,
  sourceLabel,
  backTo,
  onRun,
}: {
  runId: string | undefined;
  source: WordRecapSource;
  sourceLabel: string;
  /** Where ✕ goes without history, and the empty state's link. */
  backTo: { path: string; label: string };
  /** The run loaded (once): the page's start event. */
  onRun?: (words: number) => void;
}) {
  const navigate = useNavigate();
  const { isOnline } = useNetwork();
  const run = useRecapRun(runId);
  const speak = useLessonSpeak();
  const [doneLine, setDoneLine] = useState<string | null>(null);

  const wordsKey = run ? run.words.map((w) => w.hanzi).join('|') : '';
  const owned = useLiveQuery(async () => (run ? new Set((await ownedRecapNotes(run)).keys()) : new Set<string>()), [wordsKey]) ?? new Set<string>();
  const missing = useMemo(() => (run ? run.words.filter((w) => !w.gloss).map((w) => w.hanzi) : []), [wordsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const glosses = useRecapGlosses(missing, wordsKey);

  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!run || started) return;
    setStarted(true);
    onRun?.(run.words.length);
  }, [run, started, onRun]);

  const leave = useMemo(() => () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(backTo.path);
  }, [navigate, backTo.path]);

  if (run === undefined) return <div className="study-page-fullscreen"><div className="study-fullscreen" /></div>;
  if (!run || !runId || run.words.length === 0) {
    return (
      <div className="study-page-fullscreen">
        <div className="study-fullscreen hw-pass">
          <div className="hw-pass-empty" data-testid="recap-empty">
            <p>{recapEmptyLine(source)}</p>
            <Link to={backTo.path} className="btn btn-secondary">{backTo.label}</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="study-page-fullscreen">
      <ReaderRecapView
        run={run}
        title="Word recap"
        sourceLabel={sourceLabel}
        owned={owned}
        glosses={glosses}
        online={isOnline}
        doneLine={doneLine}
        actions={{
          answer: (key, right) => {
            try { navigator.vibrate?.(right ? [12, 40, 18] : 10); } catch { /* no haptics */ }
            void answerRecapWord(runId, key, right);
          },
          keep: (key, on) => void setRecapWordKeep(runId, key, on),
          restart: () => void restartRecapRun(runId),
          done: () => {
            void finishRecap(runId).then(({ added, bumped }) => {
              setDoneLine(recapDoneLine(added, bumped));
              setTimeout(leave, 1200);
            });
          },
          close: leave,
          speak,
        }}
      />
    </div>
  );
}
