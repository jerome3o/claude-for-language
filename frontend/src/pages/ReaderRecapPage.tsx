import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { recapDoneLine, recapKey } from '@shared/study/wordRecap';
import { db } from '../db/database';
import {
  answerRecapWord, finishRecap, ownedRecapNotes, restartRecapRun, setRecapWordKeep, useRecapRun,
} from '../services/wordRecap';
import { lookupWords } from '../services/wordDict';
import { track } from '../services/analytics';
import { useLessonSpeak } from '../components/editor/useLessonSpeak';
import { useNetwork } from '../contexts/NetworkContext';
import { ReaderRecapView } from '../components/readerRecap/ReaderRecapView';
import './StudyPage.css';

/**
 * `/readers/:id/recap` — the reader word recap of the reader's latest run (docs/STUDY_SESSION.md
 * "Reader word recap"): offered after the story's finish, or from the Readers list afterwards
 * (`?from=readers`). Immersive, offline-first: the run lives on the device (services/wordRecap.ts).
 */
export function ReaderRecapPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { isOnline } = useNetwork();
  const run = useRecapRun(id);
  const reader = useLiveQuery(async () => (id ? (await db.readers.get(id)) ?? null : null), [id]);
  const speak = useLessonSpeak();
  const [doneLine, setDoneLine] = useState<string | null>(null);

  const wordsKey = run ? run.words.map((w) => w.hanzi).join('|') : '';
  const owned = useLiveQuery(async () => (run ? new Set((await ownedRecapNotes(run)).keys()) : new Set<string>()), [wordsKey]) ?? new Set<string>();

  // Meanings for words the chip had none for (device-segmented pages): the word dictionary, cache-first.
  const [glosses, setGlosses] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!run) return;
    const missing = run.words.filter((w) => !w.gloss).map((w) => w.hanzi);
    if (missing.length === 0) return;
    let cancelled = false;
    void (async () => {
      const found = await lookupWords(missing);
      const out = new Map<string, string>();
      // CC-CEDICT's cross-references ("see 成都市") aren't a meaning: the first real sense, else the target's.
      const seeAlso = new Map<string, string>();
      for (const [hanzi, r] of found) {
        if (r.status !== 'ok') continue;
        const senses = [r.record.english, ...r.record.senses].filter(Boolean);
        const meaning = senses.find((m) => !/^see\s/i.test(m));
        if (meaning) out.set(recapKey(hanzi), meaning);
        else {
          const target = senses.map((m) => /^see\s+([\p{Script=Han}]+)/u.exec(m)?.[1]).find(Boolean);
          if (target) seeAlso.set(hanzi, target);
        }
      }
      if (seeAlso.size) {
        const targets = await lookupWords([...seeAlso.values()]);
        for (const [hanzi, target] of seeAlso) {
          const r = targets.get(target);
          const meaning = r?.status === 'ok' ? [r.record.english, ...r.record.senses].find((m) => m && !/^see\s/i.test(m)) : undefined;
          if (meaning) out.set(recapKey(hanzi), meaning);
        }
      }
      if (!cancelled) setGlosses(out);
    })().catch(() => undefined);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordsKey]);

  // Opened from the Readers list (the offer tracks its own start).
  const started = useRef(false);
  useEffect(() => {
    if (!run || started.current) return;
    started.current = true;
    if (params.get('from') === 'readers') track('reader.word_recap_start', { from: 'readers', words: run.words.length });
  }, [run, params]);

  const leave = useMemo(() => () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/readers');
  }, [navigate]);

  if (run === undefined) return <div className="study-page-fullscreen"><div className="study-fullscreen" /></div>;
  if (!run || !id || run.words.length === 0) {
    return (
      <div className="study-page-fullscreen">
        <div className="study-fullscreen hw-pass">
          <div className="hw-pass-empty">
            <p>No words to recap from this story yet. Tap words while you read, or read a page aloud — they gather here.</p>
            <Link to="/readers" className="btn btn-secondary">Readers</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="study-page-fullscreen">
      <ReaderRecapView
        run={run}
        title={reader?.title_chinese || 'Word recap'}
        owned={owned}
        glosses={glosses}
        online={isOnline}
        doneLine={doneLine}
        actions={{
          answer: (key, right) => {
            try { navigator.vibrate?.(right ? [12, 40, 18] : 10); } catch { /* no haptics */ }
            void answerRecapWord(id, key, right);
          },
          keep: (key, on) => void setRecapWordKeep(id, key, on),
          restart: () => void restartRecapRun(id),
          done: () => {
            void finishRecap(id).then(({ added, bumped }) => {
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
