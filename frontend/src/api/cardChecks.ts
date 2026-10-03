/**
 * Word checks (worker routes/card-checks.ts, shared/cards/check.ts): the note's
 * "⚠ Possible issue" Apply fix / Dismiss, Paste a list's preview check, the
 * account switch, and per-deck "Check for errors".
 */
import { API_BASE, getAuthHeaders, authEvents } from './client';
import type { CheckEstimate, CheckWord, DeckCheckJob, IndexedCheckIssue, NoteCheckIssue } from '@shared/cards/check';
import type { Note } from '../types';

const API_PATH = `${API_BASE}/api`;

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getAuthHeaders(),
    ...(options?.headers as Record<string, string> | undefined),
  };
  const response = await fetch(`${API_PATH}${url}`, { ...options, credentials: 'include', headers });
  if (response.status === 401) {
    authEvents.onUnauthorized();
    throw new Error('Unauthorized');
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

export function applyNoteIssue(noteId: string, issueId: string): Promise<{ note: Note; applied: NoteCheckIssue }> {
  return request(`/notes/${noteId}/check-issues/${issueId}/apply`, { method: 'POST' });
}

export function dismissNoteIssue(noteId: string, issueId: string): Promise<{ note: Note }> {
  return request(`/notes/${noteId}/check-issues/${issueId}/dismiss`, { method: 'POST' });
}

/** Paste a list's preview: check rows before they are saved (nothing stored). */
export async function checkWords(words: CheckWord[]): Promise<IndexedCheckIssue[]> {
  const res = await request<{ issues: IndexedCheckIssue[] }>('/ai/check-words', { method: 'POST', body: JSON.stringify({ words }) });
  return res.issues;
}

export function setCardCheck(on: boolean | null): Promise<{ card_check: boolean; card_check_setting: boolean | null }> {
  return request('/profile/card-check', { method: 'PUT', body: JSON.stringify({ card_check: on }) });
}

export interface DeckCheckInfo {
  estimate: CheckEstimate;
  job: DeckCheckJob | null;
  deck_name: string | null;
  can_fix_source: boolean;
}

/** Which deck a check runs on: my own, or the student's copy of a homework deck I sent. */
export type DeckCheckTarget = { kind: 'own'; deckId: string } | { kind: 'student'; relId: string; sharedDeckId: string };

function targetPath(t: DeckCheckTarget): string {
  return t.kind === 'own' ? `/decks/${t.deckId}/check` : `/relationships/${t.relId}/shared-decks/${t.sharedDeckId}/check`;
}

export function getDeckCheckInfo(t: DeckCheckTarget): Promise<DeckCheckInfo> {
  return request(targetPath(t));
}

export async function startDeckCheck(t: DeckCheckTarget): Promise<DeckCheckJob> {
  return (await request<{ job: DeckCheckJob }>(targetPath(t), { method: 'POST' })).job;
}

export async function getDeckCheck(jobId: string): Promise<DeckCheckJob> {
  return (await request<{ job: DeckCheckJob }>(`/deck-checks/${jobId}`)).job;
}

export interface ApplyDeckCheckResult {
  applied: string[];
  source_applied: string[];
  failed: Array<{ id: string; error: string }>;
  job: DeckCheckJob;
}

export function applyDeckCheck(jobId: string, proposalIds: string[], alsoSource: boolean): Promise<ApplyDeckCheckResult> {
  return request(`/deck-checks/${jobId}/apply`, { method: 'POST', body: JSON.stringify({ proposal_ids: proposalIds, also_source: alsoSource }) });
}
