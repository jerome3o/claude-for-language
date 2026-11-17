/**
 * The correction of a "which sentence is wrong?" choice's wrong option on the device (shared/lesson/choiceMistake.ts;
 * docs/STUDY_SESSION.md "Which sentence is wrong?"): the spec's own `correction` when it has one; for an older lesson
 * the device cache first (localStorage, keyed by `choiceCorrectionCacheText` — a correction seen once works offline),
 * then `POST /api/lessons/choice-correction` (cached for everyone on the server). Offline with nothing cached there is
 * no correction — and the wrong sentence is still never read aloud.
 */
import { useEffect, useState } from 'react';
import {
  choiceCorrectionCacheText, choiceCorrectionFromResult, choiceCorrectionInput, initialChoiceCorrection, needsChoiceCorrection,
  normalizeChoiceCorrection, type ChoiceCorrection, type ChoiceCorrectionResult,
} from '@shared/lesson/choiceMistake';
import type { ChoiceExerciseSpec } from '@shared/lesson';
import { AnswerCheckUnavailable, postJson } from './answerCheck';
import { track } from './analytics';

const CACHE_KEY = 'lesson-choice-corrections-v1';
const CACHE_MAX = 200;

type Cache = Record<string, { result: ChoiceCorrectionResult; at: number }>;

function readCache(): Cache {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed as Cache : {};
  } catch {
    return {};
  }
}

function writeCache(key: string, result: ChoiceCorrectionResult): void {
  try {
    const all = readCache();
    all[key] = { result, at: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > CACHE_MAX) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - CACHE_MAX).forEach((k) => delete all[k]);
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    // Storage full / blocked: shown, just not kept.
  }
}

export type ChoiceEx = Pick<ChoiceExerciseSpec, 'question' | 'options' | 'correct' | 'explanation' | 'correction'>;

/** A correction seen before on this device, or null. */
export function cachedChoiceCorrection(ex: ChoiceEx): ChoiceCorrection | null {
  const input = choiceCorrectionInput(ex);
  if (!input) return null;
  const hit = readCache()[choiceCorrectionCacheText(input)];
  if (!hit) return null;
  try {
    return choiceCorrectionFromResult(normalizeChoiceCorrection(hit.result, input.sentence));
  } catch {
    return null;
  }
}

/** Ask the server (throws AnswerCheckUnavailable offline / busy / declined). */
export async function fetchChoiceCorrection(ex: ChoiceEx): Promise<ChoiceCorrection> {
  const input = choiceCorrectionInput(ex);
  if (!input) throw new AnswerCheckUnavailable('nothing to correct');
  const r = await postJson<{ correction?: unknown; unchanged?: boolean; cached?: boolean }>('/lessons/choice-correction', input);
  const result = normalizeChoiceCorrection(r, input.sentence);
  writeCache(choiceCorrectionCacheText(input), result);
  track('lesson.choice_correction', { cached: r.cached === true, unchanged: result.unchanged });
  return choiceCorrectionFromResult(result);
}

/** The state before anything is fetched: the spec's correction, else the device cache, else loading / offline / none. */
export function startingChoiceCorrection(ex: ChoiceEx): ChoiceCorrection {
  if (!needsChoiceCorrection(ex)) return initialChoiceCorrection(ex);
  const cached = cachedChoiceCorrection(ex);
  if (cached) return cached;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { status: 'unavailable', offline: true };
  return { status: 'loading' };
}

/**
 * A choice's correction, fetched as soon as the exercise is on screen (before the answer, so it is usually there by
 * the reveal) when the lesson has none.
 */
export function useChoiceCorrection(ex: ChoiceEx): ChoiceCorrection {
  const [state, setState] = useState<ChoiceCorrection>(() => startingChoiceCorrection(ex));
  const key = `${ex.question}|${ex.correct}|${ex.options.map((o) => o.hanzi).join('|')}|${ex.correction?.hanzi ?? ''}`;
  useEffect(() => {
    const start = startingChoiceCorrection(ex);
    setState(start);
    if (start.status !== 'loading') return;
    let live = true;
    fetchChoiceCorrection(ex)
      .then((next) => {
        if (live) setState(next);
      })
      .catch((e: unknown) => {
        if (live) setState({ status: 'unavailable', offline: e instanceof AnswerCheckUnavailable && e.offline });
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}
