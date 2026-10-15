/**
 * Claude's check of a self-assessed lesson answer (shared/lesson/answerCheck.ts) on the device:
 * the device cache first (localStorage, keyed by `answerCheckCacheText` — a check seen once works
 * offline), then `POST /api/lessons/answer-check` (one retry on a busy 503). Throws
 * `AnswerCheckUnavailable` when there is no check to be had (offline, no key, declined): the
 * exercise is then self-assessed exactly as before.
 */
import {
  answerCheckCacheText, parseAnswerCheck, type AnswerCheck, type AnswerCheckInput,
} from '@shared/lesson/answerCheck';
import { API_BASE, getAuthHeaders } from '../api/client';

const API_PATH = `${API_BASE}/api`;
const CACHE_KEY = 'lesson-answer-checks-v1';
const CACHE_MAX = 150;

export class AnswerCheckUnavailable extends Error {
  constructor(message: string, readonly offline = false) {
    super(message);
  }
}

type CacheEntry = { check: AnswerCheck; at: number };

function readCache(): Record<string, CacheEntry> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed as Record<string, CacheEntry> : {};
  } catch {
    return {};
  }
}

function writeCache(key: string, check: AnswerCheck): void {
  try {
    const all = readCache();
    all[key] = { check, at: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > CACHE_MAX) {
      keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - CACHE_MAX).forEach((k) => delete all[k]);
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    // Storage full / blocked: the check still shows, it just isn't kept.
  }
}

export function cachedAnswerCheck(input: AnswerCheckInput): AnswerCheck | null {
  const hit = readCache()[answerCheckCacheText(input)];
  return hit ? parseAnswerCheck(hit.check, input.answer) : null;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new AnswerCheckUnavailable('offline', true);
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${API_PATH}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new AnswerCheckUnavailable('network', true);
    }
    if (response.ok) return (await response.json()) as T;
    const err = await response.json().catch(() => ({})) as { error?: string; retryable?: boolean };
    if (response.status === 503 && err.retryable && attempt === 0) continue;
    throw new AnswerCheckUnavailable(err.error || `HTTP ${response.status}`);
  }
  throw new AnswerCheckUnavailable('busy');
}

export interface AnswerCheckResult {
  check: AnswerCheck;
  /** From the device or the server cache. */
  cached: boolean;
}

export async function checkLessonAnswer(input: AnswerCheckInput): Promise<AnswerCheckResult> {
  const local = cachedAnswerCheck(input);
  if (local) return { check: local, cached: true };
  const r = await postJson<{ check: unknown; cached?: boolean }>('/lessons/answer-check', input);
  const check = parseAnswerCheck(r.check, input.answer);
  if (!check) throw new AnswerCheckUnavailable('bad reply');
  writeCache(answerCheckCacheText(input), check);
  return { check, cached: r.cached === true };
}

export interface AskTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** 💬 Ask about this: one follow-up reply (online only). */
export async function askAboutLessonAnswer(input: AnswerCheckInput, check: AnswerCheck | null, history: AskTurn[], question: string): Promise<string> {
  const r = await postJson<{ reply: string }>('/lessons/answer-check/ask', { ...input, check, history, question });
  return r.reply;
}
