import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, Rating } from './types';
import * as db from './db/queries';
import { calculateSM2 } from './services/sm2';
import { generateDeck, suggestCards } from './services/ai';
import { storeAudio, getAudio, getRecordingKey, generateTTS } from './services/audio';

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use('/api/*', cors());

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok' }));

// ============ Decks ============

app.get('/api/decks', async (c) => {
  const decks = await db.getAllDecks(c.env.DB);
  return c.json(decks);
});

app.post('/api/decks', async (c) => {
  const { name, description } = await c.req.json<{ name: string; description?: string }>();
  if (!name) {
    return c.json({ error: 'Name is required' }, 400);
  }
  const deck = await db.createDeck(c.env.DB, name, description);
  return c.json(deck, 201);
});

app.get('/api/decks/:id', async (c) => {
  const id = c.req.param('id');
  const deck = await db.getDeckWithNotes(c.env.DB, id);
  if (!deck) {
    return c.json({ error: 'Deck not found' }, 404);
  }
  return c.json(deck);
});

app.put('/api/decks/:id', async (c) => {
  const id = c.req.param('id');
  const { name, description } = await c.req.json<{ name?: string; description?: string }>();
  const deck = await db.updateDeck(c.env.DB, id, name, description);
  if (!deck) {
    return c.json({ error: 'Deck not found' }, 404);
  }
  return c.json(deck);
});

app.delete('/api/decks/:id', async (c) => {
  const id = c.req.param('id');
  await db.deleteDeck(c.env.DB, id);
  return c.json({ success: true });
});

// ============ Notes ============

app.get('/api/decks/:deckId/notes', async (c) => {
  const deckId = c.req.param('deckId');
  const deck = await db.getDeckWithNotes(c.env.DB, deckId);
  if (!deck) {
    return c.json({ error: 'Deck not found' }, 404);
  }
  return c.json(deck.notes);
});

app.post('/api/decks/:deckId/notes', async (c) => {
  const deckId = c.req.param('deckId');
  const { hanzi, pinyin, english, fun_facts } = await c.req.json<{
    hanzi: string;
    pinyin: string;
    english: string;
    fun_facts?: string;
  }>();

  if (!hanzi || !pinyin || !english) {
    return c.json({ error: 'hanzi, pinyin, and english are required' }, 400);
  }

  const deck = await db.getDeckById(c.env.DB, deckId);
  if (!deck) {
    return c.json({ error: 'Deck not found' }, 404);
  }

  const note = await db.createNote(c.env.DB, deckId, hanzi, pinyin, english, undefined, fun_facts);
  console.log('[API] Created note:', note.id, 'hanzi:', hanzi);

  // Generate TTS audio in background (don't await to keep response fast)
  c.executionCtx.waitUntil(
    generateTTS(c.env, hanzi, note.id).then(async (audioKey) => {
      console.log('[API] TTS generation result for note', note.id, ':', audioKey);
      if (audioKey) {
        await db.updateNote(c.env.DB, note.id, { audioUrl: audioKey });
        console.log('[API] Updated note with audioUrl:', audioKey);
      }
    }).catch((err) => {
      console.error('[API] TTS generation failed for note', note.id, ':', err);
    })
  );

  return c.json(note, 201);
});

app.get('/api/notes/:id', async (c) => {
  const id = c.req.param('id');
  const note = await db.getNoteWithCards(c.env.DB, id);
  if (!note) {
    return c.json({ error: 'Note not found' }, 404);
  }
  return c.json(note);
});

app.put('/api/notes/:id', async (c) => {
  const id = c.req.param('id');
  const updates = await c.req.json<{
    hanzi?: string;
    pinyin?: string;
    english?: string;
    fun_facts?: string;
  }>();

  const note = await db.updateNote(c.env.DB, id, {
    hanzi: updates.hanzi,
    pinyin: updates.pinyin,
    english: updates.english,
    funFacts: updates.fun_facts,
  });

  if (!note) {
    return c.json({ error: 'Note not found' }, 404);
  }
  return c.json(note);
});

app.delete('/api/notes/:id', async (c) => {
  const id = c.req.param('id');
  await db.deleteNote(c.env.DB, id);
  return c.json({ success: true });
});

// ============ Cards ============

app.get('/api/cards/due', async (c) => {
  const deckId = c.req.query('deck_id');
  const includeNew = c.req.query('include_new') !== 'false';
  const limit = parseInt(c.req.query('limit') || '20', 10);

  const cards = await db.getDueCards(c.env.DB, deckId, includeNew, limit);
  return c.json(cards);
});

app.get('/api/cards/:id', async (c) => {
  const id = c.req.param('id');
  const card = await db.getCardWithNote(c.env.DB, id);
  if (!card) {
    return c.json({ error: 'Card not found' }, 404);
  }
  return c.json(card);
});

// ============ Study Sessions ============

app.post('/api/study/sessions', async (c) => {
  const { deck_id } = await c.req.json<{ deck_id?: string }>();
  const session = await db.createStudySession(c.env.DB, deck_id);
  return c.json(session, 201);
});

app.get('/api/study/sessions/:id', async (c) => {
  const id = c.req.param('id');
  const session = await db.getSessionWithReviews(c.env.DB, id);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }
  return c.json(session);
});

app.post('/api/study/sessions/:id/reviews', async (c) => {
  const sessionId = c.req.param('id');
  const { card_id, rating, time_spent_ms, user_answer } = await c.req.json<{
    card_id: string;
    rating: Rating;
    time_spent_ms?: number;
    user_answer?: string;
  }>();

  if (!card_id || rating === undefined) {
    return c.json({ error: 'card_id and rating are required' }, 400);
  }

  // Get current card state
  const card = await db.getCardById(c.env.DB, card_id);
  if (!card) {
    return c.json({ error: 'Card not found' }, 404);
  }

  // Calculate new SM-2 values
  const sm2Result = calculateSM2(
    rating,
    card.ease_factor,
    card.interval,
    card.repetitions
  );

  // Update card with new SM-2 values
  await db.updateCardSM2(
    c.env.DB,
    card_id,
    sm2Result.easeFactor,
    sm2Result.interval,
    sm2Result.repetitions,
    sm2Result.nextReviewAt
  );

  // Create the review record
  const review = await db.createCardReview(
    c.env.DB,
    sessionId,
    card_id,
    rating,
    time_spent_ms,
    user_answer
  );

  return c.json({
    review,
    next_review_at: sm2Result.nextReviewAt.toISOString(),
    interval: sm2Result.interval,
  }, 201);
});

app.put('/api/study/sessions/:id/complete', async (c) => {
  const id = c.req.param('id');
  const session = await db.completeStudySession(c.env.DB, id);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }
  return c.json(session);
});

// ============ Audio ============

app.post('/api/audio/upload', async (c) => {
  const formData = await c.req.formData();
  const file = formData.get('file') as unknown;
  const reviewId = formData.get('review_id');

  // Check if file is a Blob/File (has arrayBuffer method)
  if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || !reviewId || typeof reviewId !== 'string') {
    return c.json({ error: 'file and review_id are required' }, 400);
  }

  const blob = file as Blob;
  const key = getRecordingKey(reviewId);
  const arrayBuffer = await blob.arrayBuffer();
  await storeAudio(c.env.AUDIO_BUCKET, key, arrayBuffer, blob.type);

  // Update review with recording URL
  await c.env.DB.prepare('UPDATE card_reviews SET recording_url = ? WHERE id = ?')
    .bind(key, reviewId)
    .run();

  return c.json({ key, url: `/api/audio/${key}` }, 201);
});

app.get('/api/audio/*', async (c) => {
  const key = c.req.path.replace('/api/audio/', '');
  const object = await getAudio(c.env.AUDIO_BUCKET, key);

  if (!object) {
    return c.json({ error: 'Audio not found' }, 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'audio/webm');
  headers.set('Cache-Control', 'public, max-age=31536000');

  return new Response(object.body, { headers });
});

// ============ AI Generation ============

app.post('/api/ai/generate-deck', async (c) => {
  const { prompt, deck_name } = await c.req.json<{ prompt: string; deck_name?: string }>();

  if (!prompt) {
    return c.json({ error: 'prompt is required' }, 400);
  }

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI generation is not configured' }, 500);
  }

  try {
    const generated = await generateDeck(c.env.ANTHROPIC_API_KEY, prompt, deck_name);

    // Create the deck
    const deck = await db.createDeck(c.env.DB, generated.deck_name, generated.deck_description);

    // Create all notes
    const notes = await Promise.all(
      generated.notes.map((note) =>
        db.createNote(
          c.env.DB,
          deck.id,
          note.hanzi,
          note.pinyin,
          note.english,
          undefined,
          note.fun_facts
        )
      )
    );

    // Generate TTS audio for all notes (wait for completion so frontend has audio URLs)
    console.log('[API] Starting TTS generation for', notes.length, 'notes');
    const notesWithAudio = await Promise.all(
      notes.map(async (note) => {
        console.log('[API] Generating TTS for AI note:', note.id, note.hanzi);
        const audioKey = await generateTTS(c.env, note.hanzi, note.id);
        console.log('[API] TTS result for AI note', note.id, ':', audioKey);
        if (audioKey) {
          const updated = await db.updateNote(c.env.DB, note.id, { audioUrl: audioKey });
          console.log('[API] Updated AI note with audioUrl:', audioKey);
          return updated || note;
        }
        return note;
      })
    );

    return c.json({ deck, notes: notesWithAudio }, 201);
  } catch (error) {
    console.error('AI generation error:', error);
    return c.json({ error: 'Failed to generate deck' }, 500);
  }
});

app.post('/api/ai/suggest-cards', async (c) => {
  const { context, count } = await c.req.json<{ context: string; count?: number }>();

  if (!context) {
    return c.json({ error: 'context is required' }, 400);
  }

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI generation is not configured' }, 500);
  }

  try {
    const suggestions = await suggestCards(c.env.ANTHROPIC_API_KEY, context, count);
    return c.json({ suggestions });
  } catch (error) {
    console.error('AI suggestion error:', error);
    return c.json({ error: 'Failed to generate suggestions' }, 500);
  }
});

// ============ Debug ============

app.get('/api/debug/notes-audio', async (c) => {
  const results = await c.env.DB.prepare(
    'SELECT id, hanzi, audio_url FROM notes ORDER BY created_at DESC LIMIT 20'
  ).all();
  return c.json({
    notes: results.results,
    hasGoogleTtsKey: !!c.env.GOOGLE_TTS_API_KEY,
  });
});

// ============ Statistics ============

app.get('/api/stats/overview', async (c) => {
  const stats = await db.getOverviewStats(c.env.DB);
  return c.json(stats);
});

app.get('/api/stats/deck/:id', async (c) => {
  const id = c.req.param('id');
  const stats = await db.getDeckStats(c.env.DB, id);
  if (!stats) {
    return c.json({ error: 'Deck not found' }, 404);
  }
  return c.json(stats);
});

// Serve static files (frontend) for non-API routes
app.get('*', async (c) => {
  // In production, this would serve from c.env.ASSETS
  // For development, the frontend runs separately on port 3000
  return c.text('API server running. Frontend served separately in development.', 200);
});

export default app;
