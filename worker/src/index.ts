import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, Rating, User, CardQueue, CreateConversationRequest, CLAUDE_AI_USER_ID, AIRespondResponse, ConversationTTSRequest, ConversationTTSResponse, CheckMessageResponse, GenerateReaderRequest, DifficultyLevel } from './types';
import * as db from './db/queries';
import { calculateSM2 } from './services/sm2';
import {
  scheduleCard,
  getIntervalPreview,
  DEFAULT_DECK_SETTINGS,
  parseLearningSteps,
} from './services/anki-scheduler';
import { generateDeck, suggestCards, askAboutNote, generateAIConversationResponse, checkUserMessage, generateIDontKnowOptions } from './services/ai';
import { analyzeSentence } from './services/sentence';
import { generateStory, generatePageImage } from './services/graded-reader';
import { storeAudio, getAudio, deleteAudio, getRecordingKey, generateTTS, generateMiniMaxTTS, generateConversationTTS } from './services/audio';
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
import {
  createRelationship,
  getMyRelationships,
  acceptRelationship,
  removeRelationship,
  getRelationshipById,
  getStudentProgress,
  getStudentDailyProgress,
  getStudentDayCards,
  getStudentCardReviews,
  getMyDailyProgress,
  getMyDayCards,
  getMyCardReviews,
  ensureClaudeRelationship,
  getOtherUserId,
  cancelPendingInvitation,
  processPendingInvitations,
} from './services/relationships';
import { sendNewMessageNotification, sendInvitationEmail } from './services/email';
import {
  getConversations,
  createConversation,
  getConversationById,
  getMessages,
  sendMessage,
  shareDeck,
  getSharedDecks,
  getChatContext,
  buildFlashcardPrompt,
  buildResponseOptionsPrompt,
} from './services/conversations';
import {
  createTutorReviewRequest,
  getTutorReviewRequestById,
  getTutorReviewInbox,
  getStudentSentRequests,
  respondToTutorReviewRequest,
  archiveTutorReviewRequest,
  getPendingReviewRequestCount,
} from './services/tutor-review-requests';
import { CreateRelationshipRequest, SendMessageRequest, ShareDeckRequest, GenerateFlashcardRequest, CreateTutorReviewRequest, RespondToTutorReviewRequest, TutorReviewRequestStatus } from './types';

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

    // Process pending invitations for new users (auto-connect with inviters)
    if (isNewUser) {
      c.executionCtx.waitUntil(
        processPendingInvitations(c.env.DB, user).then(count => {
          if (count > 0) {
            console.log(`[Auth Callback] Created ${count} relationship(s) from pending invitations for user ${user.id}`);
          }
        }).catch(err => {
          console.error('[Auth Callback] Failed to process pending invitations:', err);
        })
      );
    }

    // Ensure user has a Claude AI tutor relationship (in background)
    c.executionCtx.waitUntil(
      ensureClaudeRelationship(c.env.DB, user.id).catch(err => {
        console.error('[Auth Callback] Failed to create Claude relationship:', err);
      })
    );

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

  // Also get recording URLs from review_events
  const reviewResult = await c.env.DB.prepare(
    'SELECT DISTINCT recording_url FROM review_events WHERE recording_url IS NOT NULL'
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

  // Also get recording URLs from review_events
  const reviewResult = await c.env.DB.prepare(
    'SELECT DISTINCT recording_url FROM review_events WHERE recording_url IS NOT NULL'
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
  console.log('[API decks/:id] Fetching deck:', id, 'for user:', userId);
  const deck = await db.getDeckWithNotesAndCards(c.env.DB, id, userId);
  if (!deck) {
    console.log('[API decks/:id] Deck not found:', id);
    return c.json({ error: 'Deck not found' }, 404);
  }
  // Log card queue distribution
  const queueCounts = { new: 0, learning: 0, review: 0, relearning: 0 };
  let totalCards = 0;
  for (const note of deck.notes) {
    if (note.cards) {
      for (const card of note.cards) {
        totalCards++;
        if (card.queue === 0) queueCounts.new++;
        else if (card.queue === 1) queueCounts.learning++;
        else if (card.queue === 2) queueCounts.review++;
        else if (card.queue === 3) queueCounts.relearning++;
      }
    }
  }
  console.log('[API decks/:id] Deck:', deck.name, 'notes:', deck.notes.length, 'cards:', totalCards, 'queues:', queueCounts);
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
          generateTTS(c.env, noteData.hanzi, note.id).then(async (result) => {
            if (result) {
              await db.updateNote(c.env.DB, note.id, { audioUrl: result.audioKey, audioProvider: result.provider });
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
    generateTTS(c.env, hanzi, note.id).then(async (result) => {
      console.log('[API] TTS generation result for note', note.id, ':', result);
      if (result) {
        await db.updateNote(c.env.DB, note.id, { audioUrl: result.audioKey, audioProvider: result.provider });
        console.log('[API] Updated note with audioUrl:', result.audioKey, 'provider:', result.provider);
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

  if (!c.env.GOOGLE_TTS_API_KEY && !c.env.MINIMAX_API_KEY) {
    return c.json({ error: 'TTS is not configured' }, 500);
  }

  // Parse optional body for TTS options
  let speed: number | undefined;
  let preferProvider: 'minimax' | 'gtts' | undefined;
  try {
    const body = await c.req.json() as { speed?: number; provider?: string } | null;
    if (body?.speed !== undefined) {
      speed = Math.max(0.3, Math.min(1.5, body.speed));
    }
    if (body?.provider === 'minimax' || body?.provider === 'gtts') {
      preferProvider = body.provider;
    }
  } catch {
    // No body or invalid JSON - use defaults
  }

  try {
    const result = await generateTTS(c.env, note.hanzi, note.id, { speed, preferProvider });
    if (result) {
      await db.updateNote(c.env.DB, note.id, { audioUrl: result.audioKey, audioProvider: result.provider });
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

// Upgrade a single note's audio to MiniMax
app.post('/api/notes/:id/upgrade-audio', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');

  const note = await db.getNoteById(c.env.DB, id, userId);
  if (!note) {
    return c.json({ error: 'Note not found' }, 404);
  }

  if (!c.env.MINIMAX_API_KEY) {
    return c.json({ error: 'MiniMax TTS is not configured' }, 500);
  }

  try {
    // Delete old audio if exists
    if (note.audio_url) {
      try {
        await deleteAudio(c.env.AUDIO_BUCKET, note.audio_url);
      } catch (err) {
        console.error('[Upgrade Audio] Failed to delete old audio:', err);
      }
    }

    // Generate new audio with MiniMax
    const audioKey = await generateMiniMaxTTS(c.env, note.hanzi, note.id);
    if (audioKey) {
      await db.updateNote(c.env.DB, note.id, { audioUrl: audioKey, audioProvider: 'minimax' });
      const updatedNote = await db.getNoteById(c.env.DB, note.id, userId);
      return c.json(updatedNote);
    } else {
      return c.json({ error: 'Failed to generate MiniMax audio' }, 500);
    }
  } catch (error) {
    console.error('MiniMax TTS generation error:', error);
    return c.json({ error: 'Failed to generate audio' }, 500);
  }
});

// Upgrade all GTTS notes in a deck to MiniMax
app.post('/api/decks/:id/upgrade-all-audio', async (c) => {
  const userId = c.get('user').id;
  const deckId = c.req.param('id');

  const deck = await db.getDeckWithNotes(c.env.DB, deckId, userId);
  if (!deck) {
    return c.json({ error: 'Deck not found' }, 404);
  }

  if (!c.env.MINIMAX_API_KEY) {
    return c.json({ error: 'MiniMax TTS is not configured' }, 500);
  }

  // Find all notes with gtts or null audio_provider
  const notesToUpgrade = deck.notes.filter(note =>
    note.audio_url && (!note.audio_provider || note.audio_provider === 'gtts')
  );

  if (notesToUpgrade.length === 0) {
    return c.json({ upgraded: 0, message: 'No notes to upgrade' });
  }

  // Process upgrades in background
  let upgraded = 0;
  const errors: string[] = [];

  c.executionCtx.waitUntil((async () => {
    for (const note of notesToUpgrade) {
      try {
        // Delete old audio
        if (note.audio_url) {
          try {
            await deleteAudio(c.env.AUDIO_BUCKET, note.audio_url);
          } catch (err) {
            console.error('[Upgrade All] Failed to delete old audio for', note.hanzi, err);
          }
        }

        // Generate new audio with MiniMax
        const audioKey = await generateMiniMaxTTS(c.env, note.hanzi, note.id);
        if (audioKey) {
          await db.updateNote(c.env.DB, note.id, { audioUrl: audioKey, audioProvider: 'minimax' });
          upgraded++;
          console.log('[Upgrade All] Upgraded', note.hanzi, 'to MiniMax');
        } else {
          errors.push(`Failed to generate audio for ${note.hanzi}`);
        }
      } catch (err) {
        console.error('[Upgrade All] Failed to upgrade', note.hanzi, err);
        errors.push(`Error upgrading ${note.hanzi}: ${err}`);
      }
    }
    console.log(`[Upgrade All] Completed: ${upgraded}/${notesToUpgrade.length} upgraded`);
  })());

  // Return immediately with count of notes being processed
  return c.json({
    upgrading: notesToUpgrade.length,
    message: `Upgrading ${notesToUpgrade.length} notes to MiniMax audio in background. Refresh to see progress.`,
  });
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
  const { card_id, rating, time_spent_ms, user_answer, session_id, reviewed_at, offline_result, event_id } = await c.req.json<{
    card_id: string;
    rating: Rating;
    time_spent_ms?: number;
    user_answer?: string;
    session_id?: string;
    reviewed_at?: string; // ISO timestamp from client (for offline sync)
    event_id?: string; // Client-generated event ID for idempotency
    offline_result?: {
      queue: number;
      learning_step: number;
      ease_factor: number;
      interval: number;
      repetitions: number;
      next_review_at: string | null;
      due_timestamp: number | null;
    };
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

  // Use offline_result if provided (from offline sync), otherwise calculate
  let result;
  if (offline_result) {
    // Trust the offline calculation - convert to SchedulerResult format
    result = {
      queue: offline_result.queue,
      learning_step: offline_result.learning_step,
      ease_factor: offline_result.ease_factor,
      interval: offline_result.interval,
      repetitions: offline_result.repetitions,
      next_review_at: offline_result.next_review_at ? new Date(offline_result.next_review_at) : null,
      due_timestamp: offline_result.due_timestamp,
    };
  } else {
    // Calculate new scheduling values using Anki algorithm
    result = scheduleCard(
      rating,
      card.queue,
      card.learning_step,
      card.ease_factor,
      card.interval,
      card.repetitions,
      settings
    );
  }

  // Update card with new values
  await db.updateCardSchedule(c.env.DB, card_id, result);

  // Create review event (source of truth for sync)
  const actualReviewedAt = reviewed_at || new Date().toISOString();
  await db.createReviewEvent(
    c.env.DB,
    card_id,
    userId,
    rating,
    actualReviewedAt,
    time_spent_ms,
    user_answer,
    undefined, // recordingUrl - will be updated separately
    {
      queue: result.queue,
      ease_factor: result.ease_factor,
      interval: result.interval,
      next_review_at: result.next_review_at?.toISOString() || null,
    }
  );

  // Get updated queue counts
  const counts = await db.getQueueCounts(c.env.DB, userId, card.note.deck_id);

  return c.json({
    success: true,
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

  // Create review event (source of truth)
  const reviewedAt = new Date().toISOString();
  await db.createReviewEvent(
    c.env.DB,
    card_id,
    userId,
    rating,
    reviewedAt,
    time_spent_ms,
    user_answer,
    undefined, // recordingUrl
    {
      queue: card.queue, // Note: SM-2 doesn't update queue, keeping original
      ease_factor: sm2Result.easeFactor,
      interval: sm2Result.interval,
      next_review_at: sm2Result.nextReviewAt.toISOString(),
    }
  );

  return c.json({
    success: true,
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
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const userId = user.id;

  const formData = await c.req.formData();
  const file = formData.get('file') as unknown;
  const reviewId = formData.get('review_id') as string | null;
  const cardId = formData.get('card_id') as string | null;

  console.log('[audio/upload] userId:', userId, 'cardId:', cardId, 'reviewId:', reviewId);

  // Check if file is a Blob/File (has arrayBuffer method)
  if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
    return c.json({ error: 'file is required' }, 400);
  }

  // Need either review_id or card_id
  if (!reviewId && !cardId) {
    return c.json({ error: 'review_id or card_id is required' }, 400);
  }

  let targetReviewId = reviewId;

  // If card_id provided instead of review_id, find the most recent review event for this card by this user
  if (!targetReviewId && cardId) {
    console.log('[audio/upload] Looking for review with card_id:', cardId, 'user_id:', userId);
    const recentReview = await c.env.DB.prepare(`
      SELECT id
      FROM review_events
      WHERE card_id = ? AND user_id = ?
      ORDER BY reviewed_at DESC
      LIMIT 1
    `).bind(cardId, userId).first<{ id: string }>();

    console.log('[audio/upload] Query result:', recentReview);

    if (!recentReview) {
      return c.json({ error: 'No review found for this card' }, 404);
    }
    targetReviewId = recentReview.id;
  }

  const blob = file as Blob;
  const key = getRecordingKey(targetReviewId!);
  const arrayBuffer = await blob.arrayBuffer();
  await storeAudio(c.env.AUDIO_BUCKET, key, arrayBuffer, blob.type);

  // Update review event with recording URL
  await c.env.DB.prepare('UPDATE review_events SET recording_url = ? WHERE id = ?')
    .bind(key, targetReviewId)
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
        const result = await generateTTS(c.env, note.hanzi, note.id);
        console.log('[API] TTS result for AI note', note.id, ':', result);
        if (result) {
          const updated = await db.updateNote(c.env.DB, note.id, { audioUrl: result.audioKey, audioProvider: result.provider });
          console.log('[API] Updated AI note with audioUrl:', result.audioKey, 'provider:', result.provider);
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

// ============ Sentence Analysis (Learning Subtitles) ============

app.post('/api/sentence/analyze', async (c) => {
  const { sentence } = await c.req.json<{ sentence: string }>();

  if (!sentence || typeof sentence !== 'string' || !sentence.trim()) {
    return c.json({ error: 'sentence is required' }, 400);
  }

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI analysis is not configured' }, 500);
  }

  try {
    const breakdown = await analyzeSentence(c.env.ANTHROPIC_API_KEY, sentence.trim());
    return c.json(breakdown);
  } catch (error) {
    console.error('Sentence analysis error:', error);
    return c.json({ error: 'Failed to analyze sentence' }, 500);
  }
});

// ============ Graded Readers ============

// List all graded readers for the user
app.get('/api/readers', async (c) => {
  const userId = c.get('user').id;
  const readers = await db.getGradedReaders(c.env.DB, userId);
  return c.json(readers);
});

// Get a specific graded reader with pages
app.get('/api/readers/:id', async (c) => {
  const userId = c.get('user').id;
  const readerId = c.req.param('id');

  const reader = await db.getGradedReader(c.env.DB, readerId, userId);
  if (!reader) {
    return c.json({ error: 'Reader not found' }, 404);
  }

  return c.json(reader);
});

// Generate a new graded reader (async - returns immediately with status='generating')
app.post('/api/readers/generate', async (c) => {
  const userId = c.get('user').id;
  const { deck_ids, topic, difficulty = 'beginner' } = await c.req.json<GenerateReaderRequest>();

  if (!deck_ids || !Array.isArray(deck_ids) || deck_ids.length === 0) {
    return c.json({ error: 'deck_ids is required and must be a non-empty array' }, 400);
  }

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI generation is not configured' }, 500);
  }

  try {
    // Get learned vocabulary from the specified decks
    const vocabulary = await db.getLearnedVocabulary(c.env.DB, userId, deck_ids);

    if (vocabulary.length < 5) {
      return c.json({
        error: 'Not enough learned vocabulary. Please study more cards first.',
        vocabulary_count: vocabulary.length,
        minimum_required: 5
      }, 400);
    }

    console.log('[Readers] Creating pending reader with', vocabulary.length, 'vocabulary items');

    // Create a pending reader immediately with status='generating'
    const pendingReader = await db.createPendingReader(c.env.DB, userId, {
      title_chinese: '生成中...',
      title_english: topic ? `Story about: ${topic}` : 'Generating story...',
      difficulty_level: difficulty as DifficultyLevel,
      topic: topic || null,
      source_deck_ids: deck_ids,
      vocabulary_used: vocabulary,
    });

    console.log('[Readers] Pending reader created:', pendingReader.id);

    // Generate story and images in background
    c.executionCtx.waitUntil(
      (async () => {
        try {
          // Generate the story
          const story = await generateStory(
            c.env.ANTHROPIC_API_KEY,
            vocabulary,
            topic,
            difficulty as DifficultyLevel
          );

          console.log('[Readers] Story generated:', story.title_english, 'with', story.pages.length, 'pages');

          // Update reader title now that we have the real title
          await c.env.DB.prepare(`
            UPDATE graded_readers SET title_chinese = ?, title_english = ? WHERE id = ?
          `).bind(story.title_chinese, story.title_english, pendingReader.id).run();

          // Add pages to the reader
          const pages = await db.addReaderPages(c.env.DB, pendingReader.id, story.pages.map(page => ({
            content_chinese: page.content_chinese,
            content_pinyin: page.content_pinyin,
            content_english: page.content_english,
            image_url: null,
            image_prompt: page.image_prompt,
          })));

          console.log('[Readers] Pages added:', pages.length);

          // Note: Images are generated on-demand when viewing pages to avoid timeout
          // Mark as ready
          await db.updateReaderStatus(c.env.DB, pendingReader.id, 'ready');
          console.log('[Readers] Reader ready:', pendingReader.id);
        } catch (err) {
          console.error('[Readers] Background generation failed:', err);
          // Mark as failed
          await db.updateReaderStatus(c.env.DB, pendingReader.id, 'failed');
        }
      })()
    );

    // Return immediately with the pending reader
    return c.json(pendingReader, 201);
  } catch (error) {
    console.error('Graded reader generation error:', error);
    return c.json({ error: 'Failed to generate graded reader' }, 500);
  }
});

// Delete a graded reader
app.delete('/api/readers/:id', async (c) => {
  const userId = c.get('user').id;
  const readerId = c.req.param('id');

  // Get the reader first to find image files to delete
  const reader = await db.getGradedReader(c.env.DB, readerId, userId);
  if (!reader) {
    return c.json({ error: 'Reader not found' }, 404);
  }

  // Delete images from R2
  for (const page of reader.pages) {
    if (page.image_url) {
      try {
        await c.env.AUDIO_BUCKET.delete(page.image_url);
      } catch (err) {
        console.error('Failed to delete image:', page.image_url, err);
      }
    }
  }

  // Delete from database
  await db.deleteGradedReader(c.env.DB, readerId, userId);

  return c.json({ success: true });
});

// Generate image for a reader page on-demand
app.post('/api/readers/:readerId/pages/:pageId/generate-image', async (c) => {
  const userId = c.get('user').id;
  const readerId = c.req.param('readerId');
  const pageId = c.req.param('pageId');

  if (!c.env.GEMINI_API_KEY) {
    return c.json({ error: 'Image generation is not configured' }, 500);
  }

  // Get the reader to verify ownership
  const reader = await db.getGradedReader(c.env.DB, readerId, userId);
  if (!reader) {
    return c.json({ error: 'Reader not found' }, 404);
  }

  // Find the page
  const page = reader.pages.find(p => p.id === pageId);
  if (!page) {
    return c.json({ error: 'Page not found' }, 404);
  }

  // If image already exists, return it
  if (page.image_url) {
    return c.json({ image_url: page.image_url });
  }

  // Check if image already exists in R2 (race condition protection)
  const possibleKey = `reader-images/${pageId}.png`;
  const existingImage = await c.env.AUDIO_BUCKET.head(possibleKey);
  if (existingImage) {
    // Update database and return
    await db.updateReaderPageImage(c.env.DB, pageId, possibleKey);
    return c.json({ image_url: possibleKey });
  }

  // Generate the image
  if (!page.image_prompt) {
    return c.json({ error: 'No image prompt for this page' }, 400);
  }

  try {
    console.log('[Image] On-demand generation for page:', pageId);
    const imageUrl = await generatePageImage(
      c.env.GEMINI_API_KEY,
      page.image_prompt,
      pageId,
      c.env.AUDIO_BUCKET
    );

    if (imageUrl) {
      await db.updateReaderPageImage(c.env.DB, pageId, imageUrl);
      console.log('[Image] On-demand image generated for page:', pageId);
      return c.json({ image_url: imageUrl });
    } else {
      return c.json({ error: 'Failed to generate image' }, 500);
    }
  } catch (err) {
    console.error('[Image] On-demand generation failed:', err);
    return c.json({ error: 'Image generation failed' }, 500);
  }
});

// ============ Relationships (Tutor-Student) ============

// List my relationships (tutors, students, pending)
app.get('/api/relationships', async (c) => {
  const userId = c.get('user').id;
  const relationships = await getMyRelationships(c.env.DB, userId);
  return c.json(relationships);
});

// Create a new relationship request (or pending invitation for non-users)
app.post('/api/relationships', async (c) => {
  const user = c.get('user');
  const userId = user.id;
  const { recipient_email, role } = await c.req.json<CreateRelationshipRequest>();

  if (!recipient_email || !role) {
    return c.json({ error: 'recipient_email and role are required' }, 400);
  }

  if (role !== 'tutor' && role !== 'student') {
    return c.json({ error: 'role must be "tutor" or "student"' }, 400);
  }

  try {
    const result = await createRelationship(c.env.DB, userId, recipient_email, role);

    // If it's a pending invitation (non-user), send an email
    if (result.type === 'invitation') {
      // Send invitation email in background
      if (c.env.SENDGRID_API_KEY) {
        c.executionCtx.waitUntil(
          sendInvitationEmail(c.env.SENDGRID_API_KEY, {
            recipientEmail: recipient_email,
            inviterName: user.name,
            inviterEmail: user.email,
            inviterRole: role,
          }).catch(err => {
            console.error('[Relationships] Failed to send invitation email:', err);
          })
        );
      }
      return c.json(result, 201);
    }

    // Regular relationship
    return c.json(result, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create relationship';
    return c.json({ error: message }, 400);
  }
});

// Get a specific relationship
app.get('/api/relationships/:id', async (c) => {
  const userId = c.get('user').id;
  const relId = c.req.param('id');

  const relationship = await getRelationshipById(c.env.DB, relId);
  if (!relationship) {
    return c.json({ error: 'Relationship not found' }, 404);
  }

  // Verify user is part of this relationship
  if (relationship.requester_id !== userId && relationship.recipient_id !== userId) {
    return c.json({ error: 'Not authorized' }, 403);
  }

  return c.json(relationship);
});

// Accept a pending relationship request
app.post('/api/relationships/:id/accept', async (c) => {
  const userId = c.get('user').id;
  const relId = c.req.param('id');

  try {
    const relationship = await acceptRelationship(c.env.DB, relId, userId);
    return c.json(relationship);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to accept relationship';
    return c.json({ error: message }, 400);
  }
});

// Remove a relationship
app.delete('/api/relationships/:id', async (c) => {
  const userId = c.get('user').id;
  const relId = c.req.param('id');

  try {
    await removeRelationship(c.env.DB, relId, userId);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to remove relationship';
    return c.json({ error: message }, 400);
  }
});

// Cancel a pending invitation (for non-users)
app.delete('/api/invitations/:id', async (c) => {
  const userId = c.get('user').id;
  const invitationId = c.req.param('id');

  try {
    await cancelPendingInvitation(c.env.DB, invitationId, userId);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to cancel invitation';
    return c.json({ error: message }, 400);
  }
});

// Get student progress (tutor only) - legacy endpoint
app.get('/api/relationships/:id/student-progress', async (c) => {
  const userId = c.get('user').id;
  const relId = c.req.param('id');

  try {
    const progress = await getStudentProgress(c.env.DB, relId, userId);
    return c.json(progress);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get student progress';
    return c.json({ error: message }, 400);
  }
});

// Get student daily activity summary (last 30 days)
app.get('/api/relationships/:id/student-progress/daily', async (c) => {
  const userId = c.get('user').id;
  const relId = c.req.param('id');

  try {
    const progress = await getStudentDailyProgress(c.env.DB, relId, userId);
    return c.json(progress);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get student progress';
    return c.json({ error: message }, 400);
  }
});

// Get cards reviewed on a specific day
app.get('/api/relationships/:id/student-progress/day/:date', async (c) => {
  const userId = c.get('user').id;
  const relId = c.req.param('id');
  const date = c.req.param('date');

  try {
    const dayCards = await getStudentDayCards(c.env.DB, relId, userId, date);
    return c.json(dayCards);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get day details';
    return c.json({ error: message }, 400);
  }
});

// Get review details for a specific card on a specific day
app.get('/api/relationships/:id/student-progress/day/:date/card/:cardId', async (c) => {
  const userId = c.get('user').id;
  const relId = c.req.param('id');
  const date = c.req.param('date');
  const cardId = c.req.param('cardId');

  try {
    const cardReviews = await getStudentCardReviews(c.env.DB, relId, userId, date, cardId);
    return c.json(cardReviews);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get card reviews';
    return c.json({ error: message }, 400);
  }
});

// ============ Conversations ============

// List conversations for a relationship
app.get('/api/relationships/:relId/conversations', async (c) => {
  const userId = c.get('user').id;
  const relId = c.req.param('relId');

  try {
    const conversations = await getConversations(c.env.DB, relId, userId);
    return c.json(conversations);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get conversations';
    return c.json({ error: message }, 400);
  }
});

// Create a new conversation
app.post('/api/relationships/:relId/conversations', async (c) => {
  const userId = c.get('user').id;
  const relId = c.req.param('relId');
  const body = await c.req.json<CreateConversationRequest>();

  try {
    const conversation = await createConversation(c.env.DB, relId, userId, body);
    return c.json(conversation, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create conversation';
    return c.json({ error: message }, 400);
  }
});

// Get messages for a conversation (supports polling with ?since=)
app.get('/api/conversations/:id/messages', async (c) => {
  const userId = c.get('user').id;
  const convId = c.req.param('id');
  const since = c.req.query('since');

  try {
    const result = await getMessages(c.env.DB, convId, userId, since);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get messages';
    return c.json({ error: message }, 400);
  }
});

// Send a message
app.post('/api/conversations/:id/messages', async (c) => {
  const userId = c.get('user').id;
  const convId = c.req.param('id');
  const { content } = await c.req.json<SendMessageRequest>();

  if (!content || content.trim() === '') {
    return c.json({ error: 'Message content is required' }, 400);
  }

  try {
    const message = await sendMessage(c.env.DB, convId, userId, content);

    // Send email notification to the other user (non-blocking)
    if (c.env.SENDGRID_API_KEY) {
      const conv = await getConversationById(c.env.DB, convId, userId);
      if (conv) {
        const relationship = await getRelationshipById(c.env.DB, conv.relationship_id);
        if (relationship) {
          const otherUserId = getOtherUserId(relationship, userId);
          const otherUser =
            relationship.requester.id === otherUserId
              ? relationship.requester
              : relationship.recipient;

          if (otherUser.email) {
            // Fire and forget - don't block the response
            sendNewMessageNotification(c.env.SENDGRID_API_KEY, {
              recipientEmail: otherUser.email,
              recipientName: otherUser.name,
              senderName: message.sender.name,
              messagePreview: content,
              conversationId: convId,
              relationshipId: conv.relationship_id,
            }).catch((err) => {
              console.error('Failed to send email notification:', err);
            });
          }
        }
      }
    }

    return c.json(message, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send message';
    return c.json({ error: message }, 400);
  }
});

// Generate flashcard from conversation
app.post('/api/conversations/:id/generate-flashcard', async (c) => {
  const userId = c.get('user').id;
  const convId = c.req.param('id');
  const { message_ids } = await c.req.json<GenerateFlashcardRequest>();

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI is not configured' }, 500);
  }

  try {
    // Get chat context
    const chatContext = await getChatContext(c.env.DB, convId, userId, message_ids);
    if (!chatContext || chatContext.trim() === '') {
      return c.json({ error: 'No messages found to generate flashcard from' }, 400);
    }

    // Build prompt and call AI
    const prompt = buildFlashcardPrompt(chatContext);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': c.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to generate flashcard');
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string }>;
    };

    const textContent = data.content.find((c) => c.type === 'text');
    if (!textContent || !textContent.text) {
      throw new Error('No response from AI');
    }

    // Parse the JSON response
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid AI response format');
    }

    const flashcard = JSON.parse(jsonMatch[0]) as {
      hanzi: string;
      pinyin: string;
      english: string;
      fun_facts?: string;
    };

    return c.json({ flashcard });
  } catch (error) {
    console.error('Generate flashcard error:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate flashcard';
    return c.json({ error: message }, 500);
  }
});

// Generate response options from conversation (help me respond / "I don't know" feature)
// Now includes conversation context in the generated cards
app.post('/api/conversations/:id/generate-response-options', async (c) => {
  const userId = c.get('user').id;
  const convId = c.req.param('id');

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI is not configured' }, 500);
  }

  try {
    // Get chat context
    const chatContext = await getChatContext(c.env.DB, convId, userId);
    if (!chatContext || chatContext.trim() === '') {
      return c.json({ error: 'No messages found to generate response options from' }, 400);
    }

    // Use the new function that includes context
    const options = await generateIDontKnowOptions(c.env.ANTHROPIC_API_KEY, chatContext);

    return c.json({ options });
  } catch (error) {
    console.error('Generate response options error:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate response options';
    return c.json({ error: message }, 500);
  }
});

// AI responds in conversation (Claude tutor)
app.post('/api/conversations/:id/ai-respond', async (c) => {
  const userId = c.get('user').id;
  const convId = c.req.param('id');

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI is not configured' }, 500);
  }

  try {
    // Get conversation details
    const conv = await getConversationById(c.env.DB, convId, userId);
    if (!conv) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    if (!conv.is_ai_conversation) {
      return c.json({ error: 'This is not an AI conversation' }, 400);
    }

    // Get chat context
    const chatContext = await getChatContext(c.env.DB, convId, userId);
    if (!chatContext || chatContext.trim() === '') {
      return c.json({ error: 'No messages found' }, 400);
    }

    // Get the latest user message
    const { messages } = await getMessages(c.env.DB, convId, userId);
    const latestUserMessage = messages.filter(m => m.sender_id !== CLAUDE_AI_USER_ID).pop();
    if (!latestUserMessage) {
      return c.json({ error: 'No user message found' }, 400);
    }

    // Generate AI response
    const aiResponse = await generateAIConversationResponse(
      c.env.ANTHROPIC_API_KEY,
      conv,
      chatContext,
      latestUserMessage.content
    );

    // Save AI message
    const aiMessage = await sendMessage(c.env.DB, convId, CLAUDE_AI_USER_ID, aiResponse);

    // Generate TTS audio
    let audioBase64: string | null = null;
    let audioContentType: string | null = null;

    const ttsResult = await generateConversationTTS(c.env, aiResponse, {
      voiceId: conv.voice_id || 'female-yujie',
      speed: conv.voice_speed || 0.5,
    });

    if (ttsResult) {
      audioBase64 = ttsResult.audioBase64;
      audioContentType = ttsResult.contentType;
    }

    const response: AIRespondResponse = {
      message: aiMessage,
      audio_base64: audioBase64,
      audio_content_type: audioContentType,
    };

    return c.json(response);
  } catch (error) {
    console.error('AI respond error:', error);
    const message = error instanceof Error ? error.message : 'Failed to get AI response';
    return c.json({ error: message }, 500);
  }
});

// Generate TTS for conversation messages (on-demand, not stored)
app.post('/api/conversations/:id/tts', async (c) => {
  const userId = c.get('user').id;
  const convId = c.req.param('id');
  const { text, voice_id, voice_speed } = await c.req.json<ConversationTTSRequest>();

  if (!text) {
    return c.json({ error: 'Text is required' }, 400);
  }

  try {
    // Verify access to conversation
    const conv = await getConversationById(c.env.DB, convId, userId);
    if (!conv) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    // Generate TTS
    const ttsResult = await generateConversationTTS(c.env, text, {
      voiceId: voice_id || conv.voice_id || 'female-yujie',
      speed: voice_speed || conv.voice_speed || 0.5,
    });

    if (!ttsResult) {
      return c.json({ error: 'Failed to generate audio' }, 500);
    }

    const response: ConversationTTSResponse = {
      audio_base64: ttsResult.audioBase64,
      content_type: ttsResult.contentType,
      provider: ttsResult.provider,
    };

    return c.json(response);
  } catch (error) {
    console.error('TTS error:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate TTS';
    return c.json({ error: message }, 500);
  }
});

// Check user's message for correctness
app.post('/api/messages/:id/check', async (c) => {
  const userId = c.get('user').id;
  const msgId = c.req.param('id');

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI is not configured' }, 500);
  }

  try {
    // Get the message
    const message = await c.env.DB
      .prepare('SELECT * FROM messages WHERE id = ?')
      .bind(msgId)
      .first<{ id: string; conversation_id: string; sender_id: string; content: string }>();

    if (!message) {
      return c.json({ error: 'Message not found' }, 404);
    }

    // Verify user owns this message
    if (message.sender_id !== userId) {
      return c.json({ error: 'Can only check your own messages' }, 403);
    }

    // Get conversation context
    const chatContext = await getChatContext(c.env.DB, message.conversation_id, userId);

    // Check the message
    const result = await checkUserMessage(
      c.env.ANTHROPIC_API_KEY,
      message.content,
      chatContext
    );

    // Update message with check status
    await c.env.DB
      .prepare('UPDATE messages SET check_status = ?, check_feedback = ? WHERE id = ?')
      .bind(result.status, result.feedback, msgId)
      .run();

    return c.json(result);
  } catch (error) {
    console.error('Check message error:', error);
    const message = error instanceof Error ? error.message : 'Failed to check message';
    return c.json({ error: message }, 500);
  }
});

// Upload recording for a message
app.post('/api/messages/:id/recording', async (c) => {
  const userId = c.get('user').id;
  const msgId = c.req.param('id');

  try {
    // Get the message
    const message = await c.env.DB
      .prepare('SELECT * FROM messages WHERE id = ? AND sender_id = ?')
      .bind(msgId, userId)
      .first<{ id: string; conversation_id: string }>();

    if (!message) {
      return c.json({ error: 'Message not found or not owned by user' }, 404);
    }

    // Get the audio data from request body
    const body = await c.req.arrayBuffer();
    if (!body || body.byteLength === 0) {
      return c.json({ error: 'No audio data provided' }, 400);
    }

    // Store the recording
    const key = `recordings/messages/${msgId}.webm`;
    await storeAudio(c.env.AUDIO_BUCKET, key, body, 'audio/webm');

    // Update message with recording URL
    await c.env.DB
      .prepare('UPDATE messages SET recording_url = ? WHERE id = ?')
      .bind(key, msgId)
      .run();

    return c.json({ recording_url: key });
  } catch (error) {
    console.error('Upload recording error:', error);
    const message = error instanceof Error ? error.message : 'Failed to upload recording';
    return c.json({ error: message }, 500);
  }
});

// Update conversation voice settings
app.patch('/api/conversations/:id/voice-settings', async (c) => {
  const userId = c.get('user').id;
  const convId = c.req.param('id');
  const { voice_id, voice_speed } = await c.req.json<{ voice_id?: string; voice_speed?: number }>();

  try {
    // Verify access to conversation
    const conv = await getConversationById(c.env.DB, convId, userId);
    if (!conv) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    // Update voice settings
    const updates: string[] = [];
    const params: (string | number)[] = [];

    if (voice_id !== undefined) {
      updates.push('voice_id = ?');
      params.push(voice_id);
    }
    if (voice_speed !== undefined) {
      updates.push('voice_speed = ?');
      params.push(voice_speed);
    }

    if (updates.length === 0) {
      return c.json({ error: 'No updates provided' }, 400);
    }

    params.push(convId);
    await c.env.DB
      .prepare(`UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...params)
      .run();

    const updated = await getConversationById(c.env.DB, convId, userId);
    return c.json(updated);
  } catch (error) {
    console.error('Update voice settings error:', error);
    const message = error instanceof Error ? error.message : 'Failed to update voice settings';
    return c.json({ error: message }, 500);
  }
});

// ============ Deck Sharing ============

// Share a deck with a student
app.post('/api/relationships/:relId/share-deck', async (c) => {
  const userId = c.get('user').id;
  const relId = c.req.param('relId');
  const { deck_id } = await c.req.json<ShareDeckRequest>();

  if (!deck_id) {
    return c.json({ error: 'deck_id is required' }, 400);
  }

  try {
    const shared = await shareDeck(c.env.DB, relId, userId, deck_id);
    return c.json(shared, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to share deck';
    return c.json({ error: message }, 400);
  }
});

// Get shared decks for a relationship
app.get('/api/relationships/:relId/shared-decks', async (c) => {
  const userId = c.get('user').id;
  const relId = c.req.param('relId');

  try {
    const sharedDecks = await getSharedDecks(c.env.DB, relId, userId);
    return c.json(sharedDecks);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get shared decks';
    return c.json({ error: message }, 400);
  }
});

// ============ Tutor Review Requests ============

// Create a new tutor review request (student flags a card for tutor review)
app.post('/api/tutor-review-requests', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json<CreateTutorReviewRequest>();

  if (!body.relationship_id || !body.note_id || !body.card_id || !body.message) {
    return c.json({ error: 'relationship_id, note_id, card_id, and message are required' }, 400);
  }

  try {
    const request = await createTutorReviewRequest(c.env.DB, userId, body);
    return c.json(request, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create review request';
    return c.json({ error: message }, 400);
  }
});

// Get tutor's inbox (review requests sent to them)
app.get('/api/tutor-review-requests/inbox', async (c) => {
  const userId = c.get('user').id;
  const status = c.req.query('status') as TutorReviewRequestStatus | undefined;

  try {
    const requests = await getTutorReviewInbox(c.env.DB, userId, status);
    return c.json(requests);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get review requests';
    return c.json({ error: message }, 400);
  }
});

// Get count of pending review requests (for badge/notification)
app.get('/api/tutor-review-requests/pending-count', async (c) => {
  const userId = c.get('user').id;

  try {
    const count = await getPendingReviewRequestCount(c.env.DB, userId);
    return c.json({ count });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get pending count';
    return c.json({ error: message }, 400);
  }
});

// Get student's sent review requests
app.get('/api/tutor-review-requests/sent', async (c) => {
  const userId = c.get('user').id;
  const status = c.req.query('status') as TutorReviewRequestStatus | undefined;

  try {
    const requests = await getStudentSentRequests(c.env.DB, userId, status);
    return c.json(requests);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get sent requests';
    return c.json({ error: message }, 400);
  }
});

// Get a specific tutor review request
app.get('/api/tutor-review-requests/:id', async (c) => {
  const userId = c.get('user').id;
  const requestId = c.req.param('id');

  try {
    const request = await getTutorReviewRequestById(c.env.DB, requestId, userId);
    if (!request) {
      return c.json({ error: 'Review request not found' }, 404);
    }
    return c.json(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get review request';
    return c.json({ error: message }, 400);
  }
});

// Respond to a tutor review request (tutor only)
app.post('/api/tutor-review-requests/:id/respond', async (c) => {
  const userId = c.get('user').id;
  const requestId = c.req.param('id');
  const { response } = await c.req.json<RespondToTutorReviewRequest>();

  if (!response || response.trim() === '') {
    return c.json({ error: 'Response is required' }, 400);
  }

  try {
    const request = await respondToTutorReviewRequest(c.env.DB, requestId, userId, response);
    return c.json(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to respond to request';
    return c.json({ error: message }, 400);
  }
});

// Archive a tutor review request
app.post('/api/tutor-review-requests/:id/archive', async (c) => {
  const userId = c.get('user').id;
  const requestId = c.req.param('id');

  try {
    await archiveTutorReviewRequest(c.env.DB, requestId, userId);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to archive request';
    return c.json({ error: message }, 400);
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

// ============ My Progress (Self-view) ============

// Get my daily activity summary (last 30 days)
app.get('/api/progress/daily', async (c) => {
  const userId = c.get('user').id;

  try {
    const progress = await getMyDailyProgress(c.env.DB, userId);
    return c.json(progress);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get progress';
    return c.json({ error: message }, 400);
  }
});

// Get cards I reviewed on a specific day
app.get('/api/progress/day/:date', async (c) => {
  const userId = c.get('user').id;
  const date = c.req.param('date');

  try {
    const dayCards = await getMyDayCards(c.env.DB, userId, date);
    return c.json(dayCards);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get day details';
    return c.json({ error: message }, 400);
  }
});

// Get review details for a specific card on a specific day
app.get('/api/progress/day/:date/card/:cardId', async (c) => {
  const userId = c.get('user').id;
  const date = c.req.param('date');
  const cardId = c.req.param('cardId');

  try {
    const cardReviews = await getMyCardReviews(c.env.DB, userId, date, cardId);
    return c.json(cardReviews);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get card reviews';
    return c.json({ error: message }, 400);
  }
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

// ============ Review Events (Event-Sourced Sync) ============

// Backfill endpoint - migrate card_reviews to review_events
app.post('/api/admin/backfill-events', async (c) => {
  const userId = c.get('user').id;

  // Only allow admin users
  const user = await c.env.DB.prepare('SELECT is_admin FROM users WHERE id = ?')
    .bind(userId)
    .first<{ is_admin: number }>();

  if (!user?.is_admin) {
    return c.json({ error: 'Admin access required' }, 403);
  }

  let eventsCreated = 0;
  let checkpointsCreated = 0;
  const errors: string[] = [];

  try {
    // Step 1: Get all card_reviews that don't have corresponding review_events
    const reviews = await c.env.DB.prepare(`
      SELECT cr.*, c.note_id, n.deck_id, ss.user_id
      FROM card_reviews cr
      JOIN cards c ON cr.card_id = c.id
      JOIN notes n ON c.note_id = n.id
      JOIN study_sessions ss ON cr.session_id = ss.id
      WHERE NOT EXISTS (
        SELECT 1 FROM review_events re
        WHERE re.card_id = cr.card_id
        AND re.reviewed_at = cr.reviewed_at
        AND re.rating = cr.rating
      )
      ORDER BY cr.reviewed_at ASC
    `).all();

    // Step 2: Insert review events
    for (const review of reviews.results as Array<{
      id: string;
      card_id: string;
      rating: number;
      time_spent_ms: number | null;
      user_answer: string | null;
      recording_url: string | null;
      reviewed_at: string;
      user_id: string;
    }>) {
      try {
        const eventId = `backfill-${review.id}`;
        await c.env.DB.prepare(`
          INSERT OR IGNORE INTO review_events (
            id, card_id, user_id, rating, time_spent_ms, user_answer,
            recording_url, reviewed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          eventId,
          review.card_id,
          review.user_id,
          review.rating,
          review.time_spent_ms,
          review.user_answer,
          review.recording_url,
          review.reviewed_at
        ).run();
        eventsCreated++;
      } catch (err) {
        errors.push(`Failed to create event for review ${review.id}: ${err}`);
      }
    }

    // Step 3: Create checkpoints from current card state
    const cards = await c.env.DB.prepare(`
      SELECT c.*, n.deck_id, d.user_id
      FROM cards c
      JOIN notes n ON c.note_id = n.id
      JOIN decks d ON n.deck_id = d.id
      WHERE c.queue > 0 OR c.repetitions > 0
    `).all();

    for (const card of cards.results as Array<{
      id: string;
      queue: number;
      learning_step: number;
      ease_factor: number;
      interval: number;
      repetitions: number;
      next_review_at: string | null;
      due_timestamp: number | null;
    }>) {
      try {
        // Count events for this card
        const eventCount = await c.env.DB.prepare(`
          SELECT COUNT(*) as count FROM review_events WHERE card_id = ?
        `).bind(card.id).first<{ count: number }>();

        if (eventCount && eventCount.count > 0) {
          // Get the latest event timestamp
          const latestEvent = await c.env.DB.prepare(`
            SELECT reviewed_at FROM review_events
            WHERE card_id = ?
            ORDER BY reviewed_at DESC
            LIMIT 1
          `).bind(card.id).first<{ reviewed_at: string }>();

          await c.env.DB.prepare(`
            INSERT OR REPLACE INTO card_checkpoints (
              card_id, checkpoint_at, event_count, queue, learning_step,
              ease_factor, interval, repetitions, next_review_at, due_timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            card.id,
            latestEvent?.reviewed_at || new Date().toISOString(),
            eventCount.count,
            card.queue,
            card.learning_step,
            card.ease_factor,
            card.interval,
            card.repetitions,
            card.next_review_at,
            card.due_timestamp
          ).run();
          checkpointsCreated++;
        }
      } catch (err) {
        errors.push(`Failed to create checkpoint for card ${card.id}: ${err}`);
      }
    }

    return c.json({
      success: true,
      events_created: eventsCreated,
      checkpoints_created: checkpointsCreated,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    return c.json({
      success: false,
      error: String(err),
      events_created: eventsCreated,
      checkpoints_created: checkpointsCreated,
    }, 500);
  }
});

// Upload batch of review events (from offline sync)
app.post('/api/reviews', async (c) => {
  const userId = c.get('user').id;
  const { events } = await c.req.json<{
    events: Array<{
      id: string;
      card_id: string;
      rating: Rating;
      reviewed_at: string;
      time_spent_ms?: number;
      user_answer?: string;
    }>;
  }>();

  if (!events || !Array.isArray(events)) {
    return c.json({ error: 'events array is required' }, 400);
  }

  if (events.length === 0) {
    return c.json({ created: 0, skipped: 0 });
  }

  // Validate all events have required fields
  for (const event of events) {
    if (!event.id || !event.card_id || event.rating === undefined || !event.reviewed_at) {
      return c.json({ error: 'Each event must have id, card_id, rating, and reviewed_at' }, 400);
    }
  }

  // Verify all cards belong to this user
  const cardIds = [...new Set(events.map(e => e.card_id))];
  const verificationPromises = cardIds.map(cardId =>
    db.getCardById(c.env.DB, cardId, userId)
  );
  const cards = await Promise.all(verificationPromises);

  if (cards.some(card => !card)) {
    return c.json({ error: 'One or more cards not found or not owned by user' }, 404);
  }

  // Create events with user_id added
  const eventsWithUser = events.map(e => ({
    ...e,
    user_id: userId,
  }));

  const result = await db.createReviewEventsBatch(c.env.DB, eventsWithUser);

  // Update sync metadata with the latest event timestamp
  if (events.length > 0) {
    const latestEvent = events.reduce((latest, e) =>
      e.reviewed_at > latest.reviewed_at ? e : latest
    );
    await db.updateSyncMetadata(c.env.DB, userId, latestEvent.reviewed_at);
  }

  return c.json(result);
});

// Get review events since a timestamp (for sync)
app.get('/api/reviews', async (c) => {
  const userId = c.get('user').id;
  const since = c.req.query('since');
  const limit = parseInt(c.req.query('limit') || '1000', 10);

  if (!since) {
    return c.json({ error: 'since parameter is required (ISO timestamp)' }, 400);
  }

  const events = await db.getReviewEventsSince(c.env.DB, userId, since, limit);

  // Get sync metadata
  const metadata = await db.getSyncMetadata(c.env.DB, userId);

  return c.json({
    events,
    has_more: events.length >= limit,
    server_time: new Date().toISOString(),
    last_sync_at: metadata?.last_sync_at || null,
  });
});

// Get review events for a specific card
app.get('/api/cards/:id/events', async (c) => {
  const userId = c.get('user').id;
  const cardId = c.req.param('id');

  // Verify card ownership
  const card = await db.getCardById(c.env.DB, cardId, userId);
  if (!card) {
    return c.json({ error: 'Card not found' }, 404);
  }

  const events = await db.getCardReviewEvents(c.env.DB, cardId, userId);

  return c.json({ events });
});

// ============ Sync (for offline PWA) ============

app.get('/api/sync/changes', async (c) => {
  const userId = c.get('user').id;
  const sinceParam = c.req.query('since');

  console.log('[API sync/changes] userId:', userId, 'sinceParam:', sinceParam);

  if (!sinceParam) {
    return c.json({ error: 'since parameter is required' }, 400);
  }

  const since = parseInt(sinceParam, 10);
  if (isNaN(since)) {
    return c.json({ error: 'since must be a valid timestamp' }, 400);
  }

  const sinceDate = new Date(since).toISOString();
  console.log('[API sync/changes] sinceDate:', sinceDate);

  // Get updated decks
  const decksResult = await c.env.DB.prepare(`
    SELECT * FROM decks
    WHERE user_id = ? AND updated_at > ?
  `).bind(userId, sinceDate).all();
  console.log('[API sync/changes] decks found:', decksResult.results?.length || 0);
  for (const deck of (decksResult.results || []) as any[]) {
    console.log('[API sync/changes] deck:', deck.id, deck.name, 'updated_at:', deck.updated_at);
  }

  // Get updated notes (across all user's decks)
  const notesResult = await c.env.DB.prepare(`
    SELECT n.* FROM notes n
    JOIN decks d ON n.deck_id = d.id
    WHERE d.user_id = ? AND n.updated_at > ?
  `).bind(userId, sinceDate).all();
  console.log('[API sync/changes] notes found:', notesResult.results?.length || 0);
  for (const note of (notesResult.results || []) as any[]) {
    console.log('[API sync/changes] note:', note.id, note.hanzi, 'deck_id:', note.deck_id, 'updated_at:', note.updated_at);
  }

  // Get updated cards (across all user's notes)
  // IMPORTANT: Only select identity/structure fields, NOT scheduling fields!
  // Card scheduling state is computed from review events, not synced from server.
  // This prevents stale server state from overwriting correct local state.
  const cardsResult = await c.env.DB.prepare(`
    SELECT c.id, c.note_id, c.card_type, c.created_at, c.updated_at FROM cards c
    JOIN notes n ON c.note_id = n.id
    JOIN decks d ON n.deck_id = d.id
    WHERE d.user_id = ? AND c.updated_at > ?
  `).bind(userId, sinceDate).all();
  console.log('[API sync/changes] cards found:', cardsResult.results?.length || 0);
  for (const card of (cardsResult.results || []) as any[]) {
    console.log('[API sync/changes] card:', card.id, 'note_id:', card.note_id, 'queue:', card.queue, 'updated_at:', card.updated_at);
  }

  // For deletions, we'd need a deleted_items table (not implemented yet)
  // For now, return empty arrays for deleted items
  const deleted = {
    deck_ids: [] as string[],
    note_ids: [] as string[],
    card_ids: [] as string[],
  };

  console.log('[API sync/changes] Returning:', {
    decks: decksResult.results?.length || 0,
    notes: notesResult.results?.length || 0,
    cards: cardsResult.results?.length || 0,
  });

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
