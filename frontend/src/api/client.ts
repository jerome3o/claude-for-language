import {
  Deck,
  DeckWithNotes,
  NoteWithCards,
  CardWithNote,
  StudySession,
  SessionWithReviews,
  Rating,
  OverviewStats,
  DeckStats,
  GeneratedNote,
} from '../types';

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// ============ Decks ============

export async function getDecks(): Promise<Deck[]> {
  return fetchJSON<Deck[]>('/decks');
}

export async function getDeck(id: string): Promise<DeckWithNotes> {
  return fetchJSON<DeckWithNotes>(`/decks/${id}`);
}

export async function createDeck(name: string, description?: string): Promise<Deck> {
  return fetchJSON<Deck>('/decks', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
}

export async function updateDeck(
  id: string,
  updates: { name?: string; description?: string }
): Promise<Deck> {
  return fetchJSON<Deck>(`/decks/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function deleteDeck(id: string): Promise<void> {
  await fetchJSON<{ success: boolean }>(`/decks/${id}`, { method: 'DELETE' });
}

// ============ Notes ============

export async function getNote(id: string): Promise<NoteWithCards> {
  return fetchJSON<NoteWithCards>(`/notes/${id}`);
}

export async function createNote(
  deckId: string,
  data: { hanzi: string; pinyin: string; english: string; fun_facts?: string }
): Promise<NoteWithCards> {
  return fetchJSON<NoteWithCards>(`/decks/${deckId}/notes`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateNote(
  id: string,
  updates: { hanzi?: string; pinyin?: string; english?: string; fun_facts?: string }
): Promise<NoteWithCards> {
  return fetchJSON<NoteWithCards>(`/notes/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export async function deleteNote(id: string): Promise<void> {
  await fetchJSON<{ success: boolean }>(`/notes/${id}`, { method: 'DELETE' });
}

// ============ Cards ============

export async function getDueCards(options?: {
  deckId?: string;
  includeNew?: boolean;
  limit?: number;
}): Promise<CardWithNote[]> {
  const params = new URLSearchParams();
  if (options?.deckId) params.set('deck_id', options.deckId);
  if (options?.includeNew !== undefined) params.set('include_new', String(options.includeNew));
  if (options?.limit) params.set('limit', String(options.limit));

  const query = params.toString();
  return fetchJSON<CardWithNote[]>(`/cards/due${query ? `?${query}` : ''}`);
}

export async function getCard(id: string): Promise<CardWithNote> {
  return fetchJSON<CardWithNote>(`/cards/${id}`);
}

// ============ Study Sessions ============

export async function startSession(deckId?: string): Promise<StudySession> {
  return fetchJSON<StudySession>('/study/sessions', {
    method: 'POST',
    body: JSON.stringify({ deck_id: deckId }),
  });
}

export async function getSession(id: string): Promise<SessionWithReviews> {
  return fetchJSON<SessionWithReviews>(`/study/sessions/${id}`);
}

export async function recordReview(
  sessionId: string,
  data: {
    card_id: string;
    rating: Rating;
    time_spent_ms?: number;
    user_answer?: string;
  }
): Promise<{ review: { id: string }; next_review_at: string; interval: number }> {
  return fetchJSON(`/study/sessions/${sessionId}/reviews`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function completeSession(id: string): Promise<StudySession> {
  return fetchJSON<StudySession>(`/study/sessions/${id}/complete`, {
    method: 'PUT',
  });
}

// ============ Audio ============

export async function uploadRecording(reviewId: string, audioBlob: Blob): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append('file', audioBlob, 'recording.webm');
  formData.append('review_id', reviewId);

  const response = await fetch(`${API_BASE}/audio/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('Failed to upload recording');
  }

  return response.json();
}

export function getAudioUrl(key: string): string {
  return `${API_BASE}/audio/${key}`;
}

// ============ AI Generation ============

export async function generateDeck(
  prompt: string,
  deckName?: string
): Promise<{ deck: Deck; notes: NoteWithCards[] }> {
  return fetchJSON('/ai/generate-deck', {
    method: 'POST',
    body: JSON.stringify({ prompt, deck_name: deckName }),
  });
}

export async function suggestCards(
  context: string,
  count?: number
): Promise<{ suggestions: GeneratedNote[] }> {
  return fetchJSON('/ai/suggest-cards', {
    method: 'POST',
    body: JSON.stringify({ context, count }),
  });
}

// ============ Statistics ============

export async function getOverviewStats(): Promise<OverviewStats> {
  return fetchJSON<OverviewStats>('/stats/overview');
}

export async function getDeckStats(deckId: string): Promise<DeckStats> {
  return fetchJSON<DeckStats>(`/stats/deck/${deckId}`);
}
