import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, Rating, User, CardQueue } from './types';
import * as db from './db/queries';
import { calculateSM2 } from './services/sm2';
import {
  scheduleCard,
  getIntervalPreview,
  DEFAULT_DECK_SETTINGS,
  parseLearningSteps,
} from './services/anki-scheduler';
import { generateDeck, suggestCards, askAboutNote } from './services/ai';
import { storeAudio, getAudio, deleteAudio, getRecordingKey, generateTTS } from './services/audio';
import {
  getGoogleAuthUrl,
  exchangeCodeForTokens,
  getGoogleUserInfo,
  getOrCreateUser,
  createSession,
  deleteSession,
  createSessionCookie,
  clearSessionCookie,
  parseSessionCookie,
  getSessionWithUser,
  createStateCookie,
  clearStateCookie,
  parseStateCookie,
  generateState,
  getAllUsersWithStats,
} from './services/auth';
import { notifyNewUser } from './services/notifications';
import { authMiddleware, adminMiddleware } from './middleware/auth';

// Extend Hono context to include user
declare module 'hono' {
  interface ContextVariableMap {
    user: User;
  }
}

const app = new Hono<{ Bindings: Env }>();

// CORS middleware - allow credentials for cookie-based auth
app.use('/api/*', cors({
  origin: (origin) => {
    // Allow localhost for development
    if (origin?.includes('localhost') || origin?.includes('127.0.0.1')) {
      return origin;
    }
    // Allow production domains
    if (origin?.includes('chinese-learning-2x9.pages.dev') || origin?.includes('jeromeswannack.workers.dev')) {
      return origin;
    }
    // Allow any origin in development
    return origin || '*';
  },
  credentials: true,
}));

// Health check (public)
app.get('/api/health', (c) => c.json({ status: 'ok' }));

// ============ Auth Routes (public) ============

app.get('/api/auth/login', (c) => {
  const state = generateState();
  const isSecure = c.req.url.startsWith('https');

  // Determine redirect URI based on environment
  const url = new URL(c.req.url);
  const redirectUri = `${url.protocol}//${url.host}/api/auth/callback`;

  const authUrl = getGoogleAuthUrl(c.env, state, redirectUri);

  return new Response(null, {
    status: 302,
    headers: {
      'Location': authUrl,
      'Set-Cookie': createStateCookie(state, isSecure),
    },
  });
});

app.get('/api/auth/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  const isSecure = c.req.url.startsWith('https');
  const frontendUrl = isSecure ? 'https://chinese-learning-2x9.pages.dev' : 'http://localhost:3000';

  console.log('[Auth Callback] Starting callback handler', { isSecure, frontendUrl });

  // Handle OAuth errors
  if (error) {
    console.error('[Auth Callback] OAuth error:', error);
    return Response.redirect(`${frontendUrl}?error=oauth_error`, 302);
  }

  if (!code || !state) {
    console.error('[Auth Callback] Missing code or state');
    return Response.redirect(`${frontendUrl}?error=missing_params`, 302);
  }

  // Verify state
  const cookieHeader = c.req.header('Cookie') || null;
  console.log('[Auth Callback] Cookie header:', cookieHeader);
  const cookieState = parseStateCookie(cookieHeader);
  console.log('[Auth Callback] State check:', { received: state, fromCookie: cookieState });
  if (state !== cookieState) {
    console.error('[Auth Callback] State mismatch');
    return Response.redirect(`${frontendUrl}?error=invalid_state`, 302);
  }

  try {
    // Determine redirect URI (must match what was used in login)
    const url = new URL(c.req.url);
    const redirectUri = `${url.protocol}//${url.host}/api/auth/callback`;
    console.log('[Auth Callback] Redirect URI:', redirectUri);

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(c.env, code, redirectUri);
    console.log('[Auth Callback] Got tokens');

    // Get user info from Google
    const googleUser = await getGoogleUserInfo(tokens.access_token);
    console.log('[Auth Callback] Got Google user:', { email: googleUser.email, name: googleUser.name });

    // Create or update user in database
    const isAdminEmail = googleUser.email === c.env.ADMIN_EMAIL;
    console.log('[Auth Callback] Is admin?', isAdminEmail);
    const { user, isNewUser } = await getOrCreateUser(c.env.DB, googleUser, isAdminEmail);
    console.log('[Auth Callback] User:', { id: user.id, email: user.email, isNewUser });

    // Send notification for new users (in background)
    if (isNewUser && c.env.NTFY_TOPIC) {
      c.executionCtx.waitUntil(notifyNewUser(c.env.NTFY_TOPIC, user));
    }

    // Create session
    const session = await createSession(c.env.DB, user.id);
    console.log('[Auth Callback] Created session:', session.id);

    // Redirect to frontend with session token in URL
    // We pass the token in the URL because third-party cookies are blocked by browsers
    // Frontend will store this in localStorage and send as Authorization header
    const redirectUrl = `${frontendUrl}?session_token=${session.id}`;
    console.log('[Auth Callback] Redirecting to frontend with token in URL');

    const headers = new Headers();
    headers.set('Location', redirectUrl);
    headers.append('Set-Cookie', clearStateCookie(isSecure));

    return new Response(null, {
      status: 302,
      headers,
    });
  } catch (error) {
    console.error('[Auth Callback] Error:', error);
    return Response.redirect(`${frontendUrl}?error=auth_failed`, 302);
  }
});

app.post('/api/auth/logout', async (c) => {
  const cookieHeader = c.req.header('Cookie') || null;
  const sessionId = parseSessionCookie(cookieHeader);
  const isSecure = c.req.url.startsWith('https');

  if (sessionId) {
    await deleteSession(c.env.DB, sessionId);
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookie(isSecure),
    },
  });
});

app.get('/api/auth/me', async (c) => {
  // Try Authorization header first (preferred for cross-origin)
  const authHeader = c.req.header('Authorization');
  let sessionId: string | null = null;

  if (authHeader?.startsWith('Bearer ')) {
    sessionId = authHeader.slice(7);
    console.log('[Auth Me] Got session from Authorization header');
  } else {
    // Fallback to cookie (for same-origin or when cookies work)
    const cookieHeader = c.req.header('Cookie') || null;
    console.log('[Auth Me] Cookie header:', cookieHeader);
    sessionId = parseSessionCookie(cookieHeader);
  }
  console.log('[Auth Me] Session ID:', sessionId ? 'found' : 'not found');

  if (!sessionId) {
    console.log('[Auth Me] No session ID found, returning 401');
    return c.json({ error: 'Not authenticated' }, 401);
  }

  const result = await getSessionWithUser(c.env.DB, sessionId);
  console.log('[Auth Me] Session lookup result:', result ? 'found' : 'not found');

  if (!result) {
    console.log('[Auth Me] Session not found in DB, returning 401');
    return c.json({ error: 'Not authenticated' }, 401);
  }

  // Return user without sensitive fields
  const { user } = result;
  console.log('[Auth Me] Returning user:', { id: user.id, email: user.email });
  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    picture_url: user.picture_url,
    role: user.role,
    is_admin: !!user.is_admin,
  });
});

// Apply auth middleware to all /api/* routes except auth routes
app.use('/api/*', authMiddleware);

// ============ Admin Routes ============

app.get('/api/admin/users', adminMiddleware, async (c) => {
  const users = await getAllUsersWithStats(c.env.DB);

  // Return users without sensitive fields, with stats
  return c.json(users.map(user => ({
    id: user.id,
    email: user.email,
    name: user.name,
    picture_url: user.picture_url,
    role: user.role,
    is_admin: !!user.is_admin,
    created_at: user.created_at,
    last_login_at: user.last_login_at,
    deck_count: user.deck_count,
    note_count: user.note_count,
    review_count: user.review_count,
  })));
});

// Get R2 storage stats
app.get('/api/admin/storage', adminMiddleware, async (c) => {
  let totalFiles = 0;
  let totalSize = 0;
  let cursor: string | undefined;

  // List all objects in bucket
  do {
    const listed = await c.env.AUDIO_BUCKET.list({ cursor, limit: 1000 });
    for (const obj of listed.objects) {
      totalFiles++;
      totalSize += obj.size;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return c.json({
    total_files: totalFiles,
    total_size_bytes: totalSize,
    total_size_mb: Math.round(totalSize / 1024 / 1024 * 100) / 100,
  });
});

// Find orphaned audio files (in R2 but not referenced in DB)
app.get('/api/admin/storage/orphans', adminMiddleware, async (c) => {
  // Get all audio URLs from DB
  const dbResult = await c.env.DB.prepare(
    'SELECT DISTINCT audio_url FROM notes WHERE audio_url IS NOT NULL'
  ).all<{ audio_url: string }>();
  const dbAudioUrls = new Set(dbResult.results.map(r => r.audio_url));

  // Also get recording URLs from reviews
  const reviewResult = await c.env.DB.prepare(
    'SELECT DISTINCT recording_url FROM card_reviews WHERE recording_url IS NOT NULL'
  ).all<{ recording_url: string }>();
  for (const r of reviewResult.results) {
    dbAudioUrls.add(r.recording_url);
  }

  // List all R2 objects and find orphans
  const orphans: Array<{ key: string; size: number }> = [];
  let cursor: string | undefined;

  do {
    const listed = await c.env.AUDIO_BUCKET.list({ cursor, limit: 1000 });
    for (const obj of listed.objects) {
      if (!dbAudioUrls.has(obj.key)) {
        orphans.push({ key: obj.key, size: obj.size });
      }
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  const totalOrphanSize = orphans.reduce((sum, o) => sum + o.size, 0);

  return c.json({
    orphan_count: orphans.length,
    orphan_size_bytes: totalOrphanSize,
    orphan_size_mb: Math.round(totalOrphanSize / 1024 / 1024 * 100) / 100,
    orphans: orphans.slice(0, 100), // Return first 100 for preview
  });
});

// Delete orphaned audio files
app.post('/api/admin/storage/cleanup', adminMiddleware, async (c) => {
  // Get all audio URLs from DB
  const dbResult = await c.env.DB.prepare(
    'SELECT DISTINCT audio_url FROM notes WHERE audio_url IS NOT NULL'
  ).all<{ audio_url: string }>();
  const dbAudioUrls = new Set(dbResult.results.map(r => r.audio_url));

  // Also get recording URLs from reviews
  const reviewResult = await c.env.DB.prepare(
    'SELECT DISTINCT recording_url FROM card_reviews WHERE recording_url IS NOT NULL'
  ).all<{ recording_url: string }>();
  for (const r of reviewResult.results) {
    dbAudioUrls.add(r.recording_url);
  }

  // List all R2 objects and delete orphans
  let deletedCount = 0;
  let deletedSize = 0;
  let cursor: string | undefined;

  do {
    const listed = await c.env.AUDIO_BUCKET.list({ cursor, limit: 1000 });
    for (const obj of listed.objects) {
      if (!dbAudioUrls.has(obj.key)) {
        try {
          await c.env.AUDIO_BUCKET.delete(obj.key);
          deletedCount++;
          deletedSize += obj.size;
        } catch (err) {
          console.error('[Cleanup] Failed to delete:', obj.key, err);
        }
      }
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return c.json({
    deleted_count: deletedCount,
    deleted_size_bytes: deletedSize,
    deleted_size_mb: Math.round(deletedSize / 1024 / 1024 * 100) / 100,
  });
});

// ============ Decks ============

app.get('/api/decks', async (c) => {
  const userId = c.get('user').id;
  const decks = await db.getAllDecks(c.env.DB, userId);
  return c.json(decks);
});

app.post('/api/decks', async (c) => {
  const userId = c.get('user').id;
  const { name, description } = await c.req.json<{ name: string; description?: string }>();
  if (!name) {
    return c.json({ error: 'Name is required' }, 400);
  }
  const deck = await db.createDeck(c.env.DB, userId, name, description);
  return c.json(deck, 201);
});

app.get('/api/decks/:id', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const deck = await db.getDeckWithNotesAndCards(c.env.DB, id, userId);
  if (!deck) {
    return c.json({ error: 'Deck not found' }, 404);
  }
  return c.json(deck);
});

app.put('/api/decks/:id', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const { name, description } = await c.req.json<{ name?: string; description?: string }>();
  const deck = await db.updateDeck(c.env.DB, id, userId, name, description);
  if (!deck) {
    return c.json({ error: 'Deck not found' }, 404);
  }
  return c.json(deck);
});

app.delete('/api/decks/:id', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');

  // Get all notes in deck to delete their audio
  const deck = await db.getDeckWithNotes(c.env.DB, id, userId);
  if (deck) {
    for (const note of deck.notes) {
      if (note.audio_url) {
        try {
          await deleteAudio(c.env.AUDIO_BUCKET, note.audio_url);
        } catch (err) {
          console.error('[Delete Deck] Failed to delete audio for note', note.id, err);
        }
      }
    }
  }

  await db.deleteDeck(c.env.DB, id, userId);
  return c.json({ success: true });
});

// Export deck as JSON
app.get('/api/decks/:id/export', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');

  const deck = await db.getDeckWithNotes(c.env.DB, id, userId);
  if (!deck) {
    return c.json({ error: 'Deck not found' }, 404);
  }

  // Get all cards for each note to include progress
  const notesWithProgress = await Promise.all(
    deck.notes.map(async (note) => {
      const noteWithCards = await db.getNoteWithCards(c.env.DB, note.id, userId);
      const cards = noteWithCards?.cards || [];

      // Average progress across all card types
      const avgInterval = cards.length > 0
        ? Math.round(cards.reduce((sum, c) => sum + c.interval, 0) / cards.length)
        : 0;
      const avgEase = cards.length > 0
        ? cards.reduce((sum, c) => sum + c.ease_factor, 0) / cards.length
        : 2.5;
      const avgReps = cards.length > 0
        ? Math.round(cards.reduce((sum, c) => sum + c.repetitions, 0) / cards.length)
        : 0;

      return {
        hanzi: note.hanzi,
        pinyin: note.pinyin,
        english: note.english,
        fun_facts: note.fun_facts || undefined,
        progress: avgInterval > 0 || avgReps > 0 ? {
          interval: avgInterval,
          ease_factor: avgEase,
          repetitions: avgReps,
        } : undefined,
      };
    })
  );

  const exportData = {
    version: 1,
    exported_at: new Date().toISOString(),
    deck: {
      name: deck.name,
      description: deck.description || undefined,
    },
    notes: notesWithProgress,
  };

  return c.json(exportData);
});

// Import deck from JSON
app.post('/api/decks/import', async (c) => {
  const userId = c.get('user').id;

  interface ImportNote {
    hanzi: string;
    pinyin: string;
    english: string;
    fun_facts?: string;
    progress?: {
      interval: number;
      ease_factor: number;
      repetitions: number;
    };
  }

  interface ImportData {
    version: number;
    deck: {
      name: string;
      description?: string;
    };
    deck_id?: string; // Optional: append to existing deck
    notes: ImportNote[];
  }

  const data = await c.req.json<ImportData>();

  // Validate
  if (!data.version || !data.deck || !data.notes) {
    return c.json({ error: 'Invalid import format' }, 400);
  }

  if (data.version !== 1) {
    return c.json({ error: 'Unsupported format version' }, 400);
  }

  if (!data.deck.name && !data.deck_id) {
    return c.json({ error: 'Deck name or deck_id is required' }, 400);
  }

  if (!Array.isArray(data.notes) || data.notes.length === 0) {
    return c.json({ error: 'At least one note is required' }, 400);
  }

  // Create or use existing deck
  let deck;
  if (data.deck_id) {
    // Append to existing deck
    deck = await db.getDeckById(c.env.DB, data.deck_id, userId);
    if (!deck) {
      return c.json({ error: 'Deck not found' }, 404);
    }
    console.log('[Import] Appending to deck:', deck.id, 'with', data.notes.length, 'notes');
  } else {
    // Create new deck
    deck = await db.createDeck(c.env.DB, userId, data.deck.name, data.deck.description);
    console.log('[Import] Created deck:', deck.id, 'with', data.notes.length, 'notes to import');
  }

  // For large imports, we create the deck and return immediately,
  // then process notes in batches in the background
  const BATCH_SIZE = 50;
  const totalNotes = data.notes.length;

  // Process notes in background using waitUntil
  c.executionCtx.waitUntil((async () => {
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < data.notes.length; i += BATCH_SIZE) {
      const batch = data.notes.slice(i, i + BATCH_SIZE);
      console.log(`[Import] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}, notes ${i + 1}-${Math.min(i + BATCH_SIZE, data.notes.length)}`);

      for (const noteData of batch) {
        try {
          if (!noteData.hanzi || !noteData.pinyin || !noteData.english) {
            errorCount++;
            continue;
          }

          // Create note
          const note = await db.createNote(
            c.env.DB,
            deck.id,
            noteData.hanzi,
            noteData.pinyin,
            noteData.english,
            undefined,
            noteData.fun_facts
          );

          // Set card progress if provided
          if (noteData.progress && noteData.progress.interval > 0) {
            const noteWithCards = await db.getNoteWithCards(c.env.DB, note.id, userId);
            if (noteWithCards?.cards) {
              for (const card of noteWithCards.cards) {
                await db.setCardProgress(
                  c.env.DB,
                  card.id,
                  noteData.progress.interval,
                  noteData.progress.ease_factor || 2.5,
                  noteData.progress.repetitions || 1
                );
              }
            }
          }

          // Generate TTS audio (don't await, let it run in parallel)
          generateTTS(c.env, noteData.hanzi, note.id).then(async (audioKey) => {
            if (audioKey) {
              await db.updateNote(c.env.DB, note.id, { audioUrl: audioKey });
            }
          }).catch((err) => {
            console.error('[Import] TTS failed for', noteData.hanzi, err);
          });

          successCount++;
        } catch (err) {
          console.error('[Import] Failed to import note:', noteData.hanzi, err);
          errorCount++;
        }
      }
    }

    console.log(`[Import] Completed: ${successCount} success, ${errorCount} errors`);
  })());

  // Return immediately with deck info - notes are being imported in background
  return c.json({
    deck_id: deck.id,
    imported: 0, // Will be processed in background
    total: totalNotes,
    message: `Importing ${totalNotes} notes in background. Refresh the deck to see progress.`,
  }, 201);
});

// ============ Notes ============

app.get('/api/decks/:deckId/notes', async (c) => {
  const userId = c.get('user').id;
  const deckId = c.req.param('deckId');
  const deck = await db.getDeckWithNotes(c.env.DB, deckId, userId);
  if (!deck) {
    return c.json({ error: 'Deck not found' }, 404);
  }
  return c.json(deck.notes);
});

app.post('/api/decks/:deckId/notes', async (c) => {
  const userId = c.get('user').id;
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

  const deck = await db.getDeckById(c.env.DB, deckId, userId);
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
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const note = await db.getNoteWithCards(c.env.DB, id, userId);
  if (!note) {
    return c.json({ error: 'Note not found' }, 404);
  }
  return c.json(note);
});

app.put('/api/notes/:id', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const updates = await c.req.json<{
    hanzi?: string;
    pinyin?: string;
    english?: string;
    fun_facts?: string;
  }>();

  const note = await db.updateNote(c.env.DB, id, userId, {
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
  const userId = c.get('user').id;
  const id = c.req.param('id');

  // Get note to find audio_url before deleting
  const note = await db.getNoteById(c.env.DB, id, userId);
  if (note?.audio_url) {
    try {
      await deleteAudio(c.env.AUDIO_BUCKET, note.audio_url);
    } catch (err) {
      console.error('[Delete Note] Failed to delete audio:', err);
    }
  }

  await db.deleteNote(c.env.DB, id, userId);
  return c.json({ success: true });
});

app.get('/api/notes/:id/history', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const history = await db.getNoteReviewHistory(c.env.DB, id, userId);
  if (!history) {
    return c.json({ error: 'Note not found' }, 404);
  }
  return c.json(history);
});

app.post('/api/notes/:id/ask', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const { question, context } = await c.req.json<{
    question: string;
    context?: { userAnswer?: string; correctAnswer?: string; cardType?: string };
  }>();

  if (!question) {
    return c.json({ error: 'question is required' }, 400);
  }

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI is not configured' }, 500);
  }

  const note = await db.getNoteById(c.env.DB, id, userId);
  if (!note) {
    return c.json({ error: 'Note not found' }, 404);
  }

  try {
    const answer = await askAboutNote(c.env.ANTHROPIC_API_KEY, note, question, context);
    const noteQuestion = await db.createNoteQuestion(c.env.DB, id, question, answer);
    return c.json(noteQuestion, 201);
  } catch (error) {
    console.error('AI ask error:', error);
    return c.json({ error: 'Failed to get answer from AI' }, 500);
  }
});

app.get('/api/notes/:id/questions', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const questions = await db.getNoteQuestions(c.env.DB, id, userId);
  return c.json(questions);
});

app.post('/api/notes/:id/generate-audio', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');

  const note = await db.getNoteById(c.env.DB, id, userId);
  if (!note) {
    return c.json({ error: 'Note not found' }, 404);
  }

  if (!c.env.GOOGLE_TTS_API_KEY) {
    return c.json({ error: 'TTS is not configured' }, 500);
  }

  try {
    const audioKey = await generateTTS(c.env, note.hanzi, note.id);
    if (audioKey) {
      await db.updateNote(c.env.DB, note.id, { audioUrl: audioKey });
      const updatedNote = await db.getNoteById(c.env.DB, note.id, userId);
      return c.json(updatedNote);
    } else {
      return c.json({ error: 'Failed to generate audio' }, 500);
    }
  } catch (error) {
    console.error('TTS generation error:', error);
    return c.json({ error: 'Failed to generate audio' }, 500);
  }
});

// ============ Cards ============

app.get('/api/cards/due', async (c) => {
  const userId = c.get('user').id;
  const deckId = c.req.query('deck_id');
  const includeNew = c.req.query('include_new') !== 'false';
  const limit = parseInt(c.req.query('limit') || '20', 10);

  const cards = await db.getDueCards(c.env.DB, userId, deckId, includeNew, limit);
  return c.json(cards);
});

// Queue counts for Anki-style display (must be before :id route)
app.get('/api/cards/queue-counts', async (c) => {
  const userId = c.get('user').id;
  const deckId = c.req.query('deck_id');

  const counts = await db.getQueueCounts(c.env.DB, userId, deckId);
  return c.json(counts);
});

app.get('/api/cards/:id', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const card = await db.getCardWithNote(c.env.DB, id, userId);
  if (!card) {
    return c.json({ error: 'Card not found' }, 404);
  }
  return c.json(card);
});

// ============ Anki-style Study ============

// Get next card to study
app.get('/api/study/next-card', async (c) => {
  const userId = c.get('user').id;
  const deckId = c.req.query('deck_id');
  const excludeNotes = c.req.query('exclude_notes');
  const ignoreDailyLimit = c.req.query('ignore_daily_limit') === 'true';

  const excludeNoteIds = excludeNotes ? excludeNotes.split(',').filter(Boolean) : [];

  const card = await db.getNextStudyCard(c.env.DB, userId, deckId, excludeNoteIds, ignoreDailyLimit);
  const counts = await db.getQueueCounts(c.env.DB, userId, deckId);

  if (!card) {
    // Check if there are more new cards beyond the daily limit
    const hasMoreNewCards = await db.getNextStudyCard(c.env.DB, userId, deckId, excludeNoteIds, true);
    return c.json({ card: null, counts, hasMoreNewCards: !!hasMoreNewCards });
  }

  // Get deck settings for interval previews
  let settings = DEFAULT_DECK_SETTINGS;
  if (card.note.deck_id) {
    const deckSettings = await db.getDeckSettings(c.env.DB, card.note.deck_id, userId);
    if (deckSettings) {
      settings = deckSettings;
    }
  }

  // Calculate interval previews for all ratings
  const intervalPreviews = {
    0: getIntervalPreview(0, card.queue, card.learning_step, card.ease_factor, card.interval, card.repetitions, settings),
    1: getIntervalPreview(1, card.queue, card.learning_step, card.ease_factor, card.interval, card.repetitions, settings),
    2: getIntervalPreview(2, card.queue, card.learning_step, card.ease_factor, card.interval, card.repetitions, settings),
    3: getIntervalPreview(3, card.queue, card.learning_step, card.ease_factor, card.interval, card.repetitions, settings),
  };

  return c.json({ card, counts, intervalPreviews });
});

// Submit review with Anki-style scheduling
app.post('/api/study/review', async (c) => {
  const userId = c.get('user').id;
  const { card_id, rating, time_spent_ms, user_answer, session_id } = await c.req.json<{
    card_id: string;
    rating: Rating;
    time_spent_ms?: number;
    user_answer?: string;
    session_id?: string;
  }>();

  if (!card_id || rating === undefined) {
    return c.json({ error: 'card_id and rating are required' }, 400);
  }

  // Get current card state (verify ownership)
  const card = await db.getCardWithNote(c.env.DB, card_id, userId);
  if (!card) {
    return c.json({ error: 'Card not found' }, 404);
  }

  // Get deck settings
  let settings = DEFAULT_DECK_SETTINGS;
  if (card.note.deck_id) {
    const deckSettings = await db.getDeckSettings(c.env.DB, card.note.deck_id, userId);
    if (deckSettings) {
      settings = deckSettings;
    }
  }

  // If this is a new card being studied, increment daily count
  if (card.queue === CardQueue.NEW) {
    await db.incrementDailyNewCount(c.env.DB, userId, card.note.deck_id);
  }

  // Calculate new scheduling values using Anki algorithm
  const result = scheduleCard(
    rating,
    card.queue,
    card.learning_step,
    card.ease_factor,
    card.interval,
    card.repetitions,
    settings
  );

  // Update card with new values
  await db.updateCardSchedule(c.env.DB, card_id, result);

  // Create review record if we have a session
  let review = null;
  if (session_id) {
    review = await db.createCardReview(
      c.env.DB,
      session_id,
      card_id,
      rating,
      time_spent_ms,
      user_answer
    );
  }

  // Get updated queue counts
  const counts = await db.getQueueCounts(c.env.DB, userId, card.note.deck_id);

  return c.json({
    review,
    counts,
    next_queue: result.queue,
    next_interval: result.interval,
    next_due: result.due_timestamp || result.next_review_at?.toISOString(),
  }, 201);
});

// ============ Deck Settings ============

app.put('/api/decks/:id/settings', async (c) => {
  const userId = c.get('user').id;
  const deckId = c.req.param('id');
  const settings = await c.req.json<{
    new_cards_per_day?: number;
    learning_steps?: string;
    graduating_interval?: number;
    easy_interval?: number;
    relearning_steps?: string;
    starting_ease?: number;
    minimum_ease?: number;
    maximum_ease?: number;
    interval_modifier?: number;
    hard_multiplier?: number;
    easy_bonus?: number;
  }>();

  const deck = await db.updateDeckSettings(c.env.DB, deckId, userId, settings);
  if (!deck) {
    return c.json({ error: 'Deck not found' }, 404);
  }
  return c.json(deck);
});

// ============ Study Sessions ============

app.post('/api/study/sessions', async (c) => {
  const userId = c.get('user').id;
  const { deck_id } = await c.req.json<{ deck_id?: string }>();
  const session = await db.createStudySession(c.env.DB, userId, deck_id);
  return c.json(session, 201);
});

app.get('/api/study/sessions/:id', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const session = await db.getSessionWithReviews(c.env.DB, id, userId);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }
  return c.json(session);
});

app.post('/api/study/sessions/:id/reviews', async (c) => {
  const userId = c.get('user').id;
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

  // Get current card state (verify ownership)
  const card = await db.getCardById(c.env.DB, card_id, userId);
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
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const session = await db.completeStudySession(c.env.DB, id, userId);
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

  // Get origin for CORS
  const origin = c.req.header('Origin') || '*';

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'audio/mpeg');
  headers.set('Cache-Control', 'public, max-age=31536000');
  // Explicit CORS headers for audio element cross-origin playback
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Credentials', 'true');

  return new Response(object.body, { headers });
});

// ============ AI Generation ============

app.post('/api/ai/generate-deck', async (c) => {
  const userId = c.get('user').id;
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
    const deck = await db.createDeck(c.env.DB, userId, generated.deck_name, generated.deck_description);

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
  const userId = c.get('user').id;
  const stats = await db.getOverviewStats(c.env.DB, userId);
  return c.json(stats);
});

app.get('/api/stats/deck/:id', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const stats = await db.getDeckStats(c.env.DB, id, userId);
  if (!stats) {
    return c.json({ error: 'Deck not found' }, 404);
  }
  return c.json(stats);
});

// ============ Sync (for offline PWA) ============

app.get('/api/sync/changes', async (c) => {
  const userId = c.get('user').id;
  const sinceParam = c.req.query('since');

  if (!sinceParam) {
    return c.json({ error: 'since parameter is required' }, 400);
  }

  const since = parseInt(sinceParam, 10);
  if (isNaN(since)) {
    return c.json({ error: 'since must be a valid timestamp' }, 400);
  }

  const sinceDate = new Date(since).toISOString();

  // Get updated decks
  const decksResult = await c.env.DB.prepare(`
    SELECT * FROM decks
    WHERE user_id = ? AND updated_at > ?
  `).bind(userId, sinceDate).all();

  // Get updated notes (across all user's decks)
  const notesResult = await c.env.DB.prepare(`
    SELECT n.* FROM notes n
    JOIN decks d ON n.deck_id = d.id
    WHERE d.user_id = ? AND n.updated_at > ?
  `).bind(userId, sinceDate).all();

  // Get updated cards (across all user's notes)
  const cardsResult = await c.env.DB.prepare(`
    SELECT c.* FROM cards c
    JOIN notes n ON c.note_id = n.id
    JOIN decks d ON n.deck_id = d.id
    WHERE d.user_id = ? AND c.updated_at > ?
  `).bind(userId, sinceDate).all();

  // For deletions, we'd need a deleted_items table (not implemented yet)
  // For now, return empty arrays for deleted items
  const deleted = {
    deck_ids: [] as string[],
    note_ids: [] as string[],
    card_ids: [] as string[],
  };

  return c.json({
    decks: decksResult.results || [],
    notes: notesResult.results || [],
    cards: cardsResult.results || [],
    deleted,
    server_time: new Date().toISOString(),
  });
});

// Serve static files (frontend) for non-API routes
app.get('*', async (c) => {
  // In production, this would serve from c.env.ASSETS
  // For development, the frontend runs separately on port 3000
  return c.text('API server running. Frontend served separately in development.', 200);
});

export default app;
