import { Hono } from 'hono';
import { cors } from 'hono/cors';
import Anthropic from '@anthropic-ai/sdk';
import { Env, Rating, User, CardQueue, CreateConversationRequest, CLAUDE_AI_USER_ID, AIRespondResponse, ConversationTTSRequest, ConversationTTSResponse, CheckMessageResponse, GenerateReaderRequest, DifficultyLevel, ImageGenerationMessage, StoryGenerationMessage } from './types';
import * as db from './db/queries';
import { calculateSM2 } from './services/sm2';
import {
  scheduleCard,
  getIntervalPreview,
  DEFAULT_DECK_SETTINGS,
  parseLearningSteps,
} from './services/anki-scheduler';
import { generateDeck, suggestCards, askAboutNoteWithTools, generateAIConversationResponse, generateAIConversationOpener, checkUserMessage, generateIDontKnowOptions, discussMessage } from './services/ai';
import type { ToolAction } from './services/ai';
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
import { notifyNewUser, notifyHomeworkAssigned, notifyHomeworkSubmitted, notifyHomeworkReviewed, notifyTutorReviewFlagged, notifyNewChatMessage } from './services/notifications';
import { authMiddleware, adminMiddleware } from './middleware/auth';
import testAuth from './routes/test-auth';
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
import { sendNewMessageNotification, sendInvitationEmail, sendConnectionRequestEmail } from './services/email';
import {
  getConversations,
  createConversation,
  getConversationById,
  getMessages,
  sendMessage,
  shareDeck,
  getSharedDecks,
  studentShareDeck,
  getStudentSharedDecks,
  unshareStudentDeck,
  getDeckTutorShares,
  getChatContext,
  buildFlashcardPrompt,
  buildResponseOptionsPrompt,
  toggleReaction,
  getMessageDiscussion,
  saveMessageDiscussion,
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
import { getSharedDeckProgress, getStudentSharedDeckProgress, getOwnDeckProgress } from './services/shared-deck-progress';
import { CreateRelationshipRequest, SendMessageRequest, ShareDeckRequest, StudentShareDeckRequest, GenerateFlashcardRequest, CreateTutorReviewRequest, RespondToTutorReviewRequest, TutorReviewRequestStatus } from './types';
import {
  computeCardState,
  DEFAULT_DECK_SETTINGS as FSRS_DEFAULT_SETTINGS,
  type ReviewEvent as SchedulerReviewEvent,
} from '../../shared/scheduler';

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

    // Process pending invitations on every login (auto-connect with inviters)
    // This handles: new signups, existing users who were invited later,
    // and re-invites where a new pending_invitation was created after the user already existed.
    c.executionCtx.waitUntil(
      processPendingInvitations(c.env.DB, user).then(count => {
        if (count > 0) {
          console.log(`[Auth Callback] Created ${count} relationship(s) from pending invitations for user ${user.id}`);
        }
      }).catch(err => {
        console.error('[Auth Callback] Failed to process pending invitations:', err);
      })
    );

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
    bio: user.bio || null,
  });
});

// E2E test auth routes (only enabled when E2E_TEST_MODE=true)
app.route('/api/test', testAuth);

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

// ============ User Profile ============

app.get('/api/profile/bio', async (c) => {
  const userId = c.get('user').id;
  const row = await c.env.DB.prepare('SELECT bio FROM users WHERE id = ?').bind(userId).first<{ bio: string | null }>();
  return c.json({ bio: row?.bio || null });
});

app.put('/api/profile/bio', async (c) => {
  const userId = c.get('user').id;
  const { bio } = await c.req.json<{ bio: string | null }>();

  // Limit bio length
  const trimmed = bio?.trim().slice(0, 500) || null;

  await c.env.DB.prepare('UPDATE users SET bio = ? WHERE id = ?').bind(trimmed, userId).run();
  return c.json({ bio: trimmed });
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

// Get progress for a user's own deck
app.get('/api/decks/:deckId/progress', async (c) => {
  const userId = c.get('user').id;
  const deckId = c.req.param('deckId');

  try {
    const progress = await getOwnDeckProgress(c.env.DB, deckId, userId);
    return c.json(progress);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get deck progress';
    return c.json({ error: message }, 400);
  }
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
    sentence_clue?: string | null;
    sentence_clue_pinyin?: string | null;
    sentence_clue_translation?: string | null;
    sentence_clue_audio_url?: string | null;
    pinyin_only?: number;
  }>();

  const note = await db.updateNote(c.env.DB, id, userId, {
    hanzi: updates.hanzi,
    pinyin: updates.pinyin,
    english: updates.english,
    funFacts: updates.fun_facts,
    sentenceClue: updates.sentence_clue ?? undefined,
    sentenceCluePinyin: updates.sentence_clue_pinyin ?? undefined,
    sentenceClueTranslation: updates.sentence_clue_translation ?? undefined,
    sentenceClueAudioUrl: updates.sentence_clue_audio_url ?? undefined,
    pinyinOnly: updates.pinyin_only,
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
  const { question, context, conversationHistory } = await c.req.json<{
    question: string;
    context?: { userAnswer?: string; correctAnswer?: string; cardType?: string };
    conversationHistory?: { question: string; answer: string }[];
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
    const { answer, toolActions, readOnlyToolCalls } = await askAboutNoteWithTools(
      c.env.ANTHROPIC_API_KEY, note, question, context, conversationHistory,
      { db: c.env.DB, userId, deckId: note.deck_id }
    );

    // Process tool actions and collect results
    const toolResults: Array<{
      tool: string;
      success: boolean;
      data?: Record<string, unknown>;
      error?: string;
    }> = [];

    for (const action of toolActions) {
      try {
        switch (action.tool) {
          case 'edit_current_card': {
            const updates: { hanzi?: string; pinyin?: string; english?: string; funFacts?: string; sentenceClue?: string; sentenceCluePinyin?: string; sentenceClueTranslation?: string } = {};
            const input = action.input as { hanzi?: string; pinyin?: string; english?: string; fun_facts?: string; sentence_clue?: string; sentence_clue_pinyin?: string; sentence_clue_translation?: string };
            if (input.hanzi) updates.hanzi = input.hanzi;
            if (input.pinyin) updates.pinyin = input.pinyin;
            if (input.english) updates.english = input.english;
            if (input.fun_facts !== undefined) updates.funFacts = input.fun_facts;
            if (input.sentence_clue !== undefined) updates.sentenceClue = input.sentence_clue;
            if (input.sentence_clue_pinyin !== undefined) updates.sentenceCluePinyin = input.sentence_clue_pinyin;
            if (input.sentence_clue_translation !== undefined) updates.sentenceClueTranslation = input.sentence_clue_translation;

            const updatedNote = await db.updateNote(c.env.DB, id, userId, updates);
            if (updatedNote) {
              toolResults.push({
                tool: 'edit_current_card',
                success: true,
                data: {
                  note: updatedNote,
                  changes: input,
                },
              });
            } else {
              toolResults.push({ tool: 'edit_current_card', success: false, error: 'Failed to update note' });
            }
            break;
          }

          case 'create_flashcards': {
            const input = action.input as { deck_id?: string; flashcards: Array<{ hanzi: string; pinyin: string; english: string; fun_facts?: string }> };
            // Determine target deck — use provided deck_id if valid, otherwise current deck
            let targetDeckId = note.deck_id;
            if (input.deck_id && input.deck_id !== note.deck_id) {
              const targetDeck = await db.getDeckById(c.env.DB, input.deck_id, userId);
              if (targetDeck) {
                targetDeckId = input.deck_id;
              } else {
                toolResults.push({ tool: 'create_flashcards', success: false, error: 'Target deck not found or not owned by user' });
                break;
              }
            }
            const createdNotes = [];
            for (const fc of input.flashcards) {
              const newNote = await db.createNote(
                c.env.DB,
                targetDeckId,
                fc.hanzi,
                fc.pinyin,
                fc.english,
                undefined,
                fc.fun_facts
              );
              createdNotes.push(newNote);
            }
            toolResults.push({
              tool: 'create_flashcards',
              success: true,
              data: {
                created: createdNotes,
                count: createdNotes.length,
                targetDeckId,
              },
            });
            break;
          }

          case 'delete_current_card': {
            await db.deleteNote(c.env.DB, id, userId);
            toolResults.push({
              tool: 'delete_current_card',
              success: true,
              data: {
                deletedNoteId: id,
                reason: (action.input as { reason?: string }).reason || 'Deleted by user request',
              },
            });
            break;
          }
        }
      } catch (toolError) {
        console.error(`Tool ${action.tool} error:`, toolError);
        toolResults.push({
          tool: action.tool,
          success: false,
          error: `Failed to execute ${action.tool}`,
        });
      }
    }

    const noteQuestion = await db.createNoteQuestion(c.env.DB, id, question, answer);

    // Return extended response with tool results and read-only tool calls
    return c.json({
      ...noteQuestion,
      toolResults: toolResults.length > 0 ? toolResults : undefined,
      readOnlyToolCalls: readOnlyToolCalls.length > 0 ? readOnlyToolCalls : undefined,
    }, 201);
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
  let voiceId: string | undefined;
  try {
    const body = await c.req.json() as { speed?: number; provider?: string; voiceId?: string } | null;
    if (body?.speed !== undefined) {
      speed = Math.max(0.3, Math.min(1.5, body.speed));
    }
    if (body?.provider === 'minimax' || body?.provider === 'gtts') {
      preferProvider = body.provider;
    }
    if (body?.voiceId && typeof body.voiceId === 'string') {
      voiceId = body.voiceId;
    }
  } catch {
    // No body or invalid JSON - use defaults
  }

  try {
    const result = await generateTTS(c.env, note.hanzi, note.id, { speed, preferProvider, voiceId });
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

// Regenerate a single note's audio with MiniMax
app.post('/api/notes/:id/regenerate-audio', async (c) => {
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
        console.error('[Regenerate Audio] Failed to delete old audio:', err);
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

// Generate sentence clue for a note
app.post('/api/notes/:id/generate-sentence-clue', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');

  const note = await db.getNoteById(c.env.DB, id, userId);
  if (!note) {
    return c.json({ error: 'Note not found' }, 404);
  }

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI service is not configured' }, 500);
  }

  try {
    // Generate a simple example sentence using the note's hanzi
    const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });

    // Fetch user's bio for personalized context
    const userRow = await c.env.DB.prepare('SELECT bio FROM users WHERE id = ?').bind(userId).first<{ bio: string | null }>();
    const bioContext = userRow?.bio ? ` The learner describes themselves as: "${userRow.bio}". Try to make the sentence relevant to their life or interests when possible.` : '';

    // Read optional modifier from request body
    let modifier = '';
    try {
      const body = await c.req.json<{ modifier?: string; customPrompt?: string }>();
      if (body?.modifier === 'simple') {
        modifier = ' Make the sentence as simple as possible, using basic vocabulary suitable for a beginner.';
      } else if (body?.modifier === 'complex') {
        modifier = ' Make the sentence more complex, using intermediate/advanced grammar and vocabulary.';
      } else if (body?.modifier === 'variation') {
        modifier = note.sentence_clue
          ? ` The current sentence is "${note.sentence_clue}". Create a different variation with slightly different grammar or vocabulary, but keep the same target word.`
          : '';
      } else if (body?.modifier === 'custom' && body?.customPrompt) {
        modifier = ` Additional instructions from the learner: "${body.customPrompt}"`;
      }
    } catch {
      // No body or invalid JSON — that's fine, use default
    }

    const prompt = `Create a short, simple Chinese example sentence (5-10 characters) that uses the word/character "${note.hanzi}" (${note.pinyin}, meaning: ${note.english}) in a natural context. The sentence should help disambiguate this word from homophones. IMPORTANT: Do NOT use commas or semicolons in the sentence — write a single clause with no internal punctuation breaks (only a final period/question mark is OK). This is critical because the text-to-speech system may cut off at commas.${bioContext}${modifier}`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 400,
      tools: [{
        name: 'create_sentence_clue',
        description: 'Create an example Chinese sentence that uses a given word in natural context',
        input_schema: {
          type: 'object' as const,
          properties: {
            sentence: {
              type: 'string',
              description: 'A short Chinese example sentence (5-10 characters) using the target word',
            },
            pinyin: {
              type: 'string',
              description: 'Pinyin with tone marks for the sentence (e.g. "Wǒ hěn gāoxìng")',
            },
            translation: {
              type: 'string',
              description: 'English translation of the sentence',
            },
          },
          required: ['sentence', 'pinyin', 'translation'],
        },
      }],
      tool_choice: { type: 'tool', name: 'create_sentence_clue' },
      messages: [{ role: 'user', content: prompt }],
    });

    const toolUseBlock = response.content.find(c => c.type === 'tool_use');
    if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
      return c.json({ error: 'Failed to generate sentence' }, 500);
    }

    const input = toolUseBlock.input as { sentence: string; pinyin: string; translation: string };
    const sentenceClue = input.sentence;
    const sentenceCluePinyin = input.pinyin || null;
    const sentenceClueTranslation = input.translation || null;

    // Generate TTS for the sentence clue
    let sentenceClueAudioUrl: string | null = null;
    if (c.env.GOOGLE_TTS_API_KEY || c.env.MINIMAX_API_KEY) {
      try {
        const audioResult = await generateTTS(c.env, sentenceClue, `${id}-sentence`, { speed: 0.65 });
        if (audioResult) {
          sentenceClueAudioUrl = audioResult.audioKey;
        }
      } catch (error) {
        console.error('Failed to generate sentence clue audio:', error);
        // Continue without audio
      }
    }

    // Update the note with sentence clue
    await db.updateNote(c.env.DB, id, userId, {
      sentenceClue,
      sentenceCluePinyin: sentenceCluePinyin ?? undefined,
      sentenceClueTranslation: sentenceClueTranslation ?? undefined,
      sentenceClueAudioUrl: sentenceClueAudioUrl ?? undefined,
    });

    const updatedNote = await db.getNoteById(c.env.DB, id, userId);
    return c.json(updatedNote);
  } catch (error) {
    console.error('Sentence clue generation error:', error);
    return c.json({ error: 'Failed to generate sentence clue' }, 500);
  }
});

// Generate a fun fact for a note that doesn't have one
app.post('/api/notes/:id/generate-fun-fact', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');

  const note = await db.getNoteById(c.env.DB, id, userId);
  if (!note) {
    return c.json({ error: 'Note not found' }, 404);
  }

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI service is not configured' }, 500);
  }

  try {
    const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });

    const prompt = `Write a brief fun fact about the Chinese word "${note.hanzi}" (${note.pinyin}: ${note.english}).

Pick ONE of: character breakdown, cultural context, common usage, or a mnemonic.
1-2 sentences max. Be punchy and memorable. Use tone marks for pinyin (nǐ hǎo) NOT tone numbers.`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }],
    });

    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return c.json({ error: 'Failed to generate fun fact' }, 500);
    }

    // Save the fun fact to the note
    await db.updateNote(c.env.DB, id, userId, { funFacts: textContent.text });

    const updatedNote = await db.getNoteById(c.env.DB, id, userId);
    return c.json(updatedNote);
  } catch (error) {
    console.error('Fun fact generation error:', error);
    return c.json({ error: 'Failed to generate fun fact' }, 500);
  }
});

// Generate per-character multiple choice options for meaning_to_hanzi cards
app.post('/api/notes/:id/generate-multiple-choice', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');

  const note = await db.getNoteById(c.env.DB, id, userId);
  if (!note) {
    return c.json({ error: 'Note not found' }, 404);
  }

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI service is not configured' }, 500);
  }

  try {
    const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
    const allCharacters = [...note.hanzi];
    // Filter out punctuation - only generate MC options for actual Chinese characters
    const punctuationRegex = /[\u3000-\u303F\uFF00-\uFFEF\u2000-\u206F\u0020-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E]/;
    const characters = allCharacters.filter(ch => !punctuationRegex.test(ch));

    if (characters.length === 0) {
      return c.json({ error: 'No characters to generate options for' }, 400);
    }

    const prompt = `For each Chinese character below, generate exactly 4 tricky alternative characters that a learner might confuse with the correct one. Choose alternatives that are:
- Visually similar (same radical, similar stroke count, similar shape)
- Similar sounding (homophones or near-homophones)
- Commonly confused with the correct character

Characters to generate alternatives for:
${characters.map((char, i) => `${i + 1}. ${char}`).join('\n')}

The word is "${note.hanzi}" (${note.pinyin}, meaning: ${note.english}).`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 400,
      tools: [{
        name: 'generate_character_alternatives',
        description: 'Generate tricky alternative characters for a multiple choice quiz',
        input_schema: {
          type: 'object' as const,
          properties: {
            characters: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  correct: { type: 'string', description: 'The correct character' },
                  alternatives: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '4 tricky alternative characters that could be mistaken for the correct one',
                  },
                },
                required: ['correct', 'alternatives'],
              },
            },
          },
          required: ['characters'],
        },
      }],
      tool_choice: { type: 'tool', name: 'generate_character_alternatives' },
      messages: [{ role: 'user', content: prompt }],
    });

    const toolUseBlock = response.content.find(b => b.type === 'tool_use');
    if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
      return c.json({ error: 'Failed to generate alternatives' }, 500);
    }

    const input = toolUseBlock.input as { characters: Array<{ correct: string; alternatives: string[] }> };

    // Build options arrays with correct answer shuffled in, deduplicating
    // Re-insert punctuation characters as pass-through (correct only, no alternatives)
    let aiCharIndex = 0;
    const multipleChoiceOptions = allCharacters.map((originalChar) => {
      if (punctuationRegex.test(originalChar)) {
        // Punctuation: no MC options, just the character itself
        return { correct: originalChar, options: [originalChar] };
      }
      const charData = input.characters[aiCharIndex++];
      // Filter out duplicates and the correct character from alternatives
      const seen = new Set<string>([charData.correct]);
      const uniqueAlts: string[] = [];
      for (const alt of charData.alternatives) {
        if (!seen.has(alt)) {
          seen.add(alt);
          uniqueAlts.push(alt);
        }
        if (uniqueAlts.length >= 4) break;
      }
      const options = [...uniqueAlts];
      // Insert correct character at a random position
      const insertPos = Math.floor(Math.random() * (options.length + 1));
      options.splice(insertPos, 0, charData.correct);
      return {
        correct: charData.correct,
        options,
      };
    });

    const optionsJson = JSON.stringify(multipleChoiceOptions);

    await db.updateNote(c.env.DB, id, userId, {
      multipleChoiceOptions: optionsJson,
    });

    const updatedNote = await db.getNoteById(c.env.DB, id, userId);
    return c.json(updatedNote);
  } catch (error) {
    console.error('Multiple choice generation error:', error);
    return c.json({ error: 'Failed to generate multiple choice options' }, 500);
  }
});

// Regenerate all audio in a deck with MiniMax
app.post('/api/decks/:id/regenerate-all-audio', async (c) => {
  const userId = c.get('user').id;
  const deckId = c.req.param('id');

  const deck = await db.getDeckWithNotes(c.env.DB, deckId, userId);
  if (!deck) {
    return c.json({ error: 'Deck not found' }, 404);
  }

  if (!c.env.MINIMAX_API_KEY) {
    return c.json({ error: 'MiniMax TTS is not configured' }, 500);
  }

  // Get optional note IDs from request body for selective regeneration
  let body: { noteIds?: string[] } = {};
  try {
    body = await c.req.json();
  } catch {
    // No body, regenerate all eligible notes
  }

  // Find notes to regenerate
  let notesToRegenerate = deck.notes;

  if (body.noteIds && body.noteIds.length > 0) {
    // Regenerate only selected notes
    const selectedIds = new Set(body.noteIds);
    notesToRegenerate = deck.notes.filter(note => selectedIds.has(note.id));
  } else {
    // Regenerate notes with gtts or null audio_provider (legacy behavior)
    notesToRegenerate = deck.notes.filter(note =>
      note.audio_url && (!note.audio_provider || note.audio_provider === 'gtts')
    );
  }

  if (notesToRegenerate.length === 0) {
    return c.json({ regenerating: 0, message: 'No notes to regenerate' });
  }

  // Process regeneration in background
  let regenerated = 0;
  const errors: string[] = [];

  c.executionCtx.waitUntil((async () => {
    for (const note of notesToRegenerate) {
      try {
        // Delete old audio
        if (note.audio_url) {
          try {
            await deleteAudio(c.env.AUDIO_BUCKET, note.audio_url);
          } catch (err) {
            console.error('[Regenerate All] Failed to delete old audio for', note.hanzi, err);
          }
        }

        // Generate new audio with MiniMax
        const audioKey = await generateMiniMaxTTS(c.env, note.hanzi, note.id);
        if (audioKey) {
          await db.updateNote(c.env.DB, note.id, { audioUrl: audioKey, audioProvider: 'minimax' });
          regenerated++;
          console.log('[Regenerate All] Regenerated', note.hanzi, 'with MiniMax');
        } else {
          errors.push(`Failed to generate audio for ${note.hanzi}`);
        }
      } catch (err) {
        console.error('[Regenerate All] Failed to regenerate', note.hanzi, err);
        errors.push(`Error regenerating ${note.hanzi}: ${err}`);
      }
    }
    console.log(`[Regenerate All] Completed: ${regenerated}/${notesToRegenerate.length} regenerated`);
  })());

  // Return immediately with count of notes being processed
  return c.json({
    regenerating: notesToRegenerate.length,
    message: `Regenerating ${notesToRegenerate.length} notes with MiniMax audio in background. Refresh to see progress.`,
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
  const localDate = c.req.query('local_date');

  const counts = await db.getQueueCounts(c.env.DB, userId, deckId, localDate);
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
  const localDate = c.req.query('local_date');

  const excludeNoteIds = excludeNotes ? excludeNotes.split(',').filter(Boolean) : [];

  const card = await db.getNextStudyCard(c.env.DB, userId, deckId, excludeNoteIds, ignoreDailyLimit, localDate);
  const counts = await db.getQueueCounts(c.env.DB, userId, deckId, localDate);

  if (!card) {
    // Check if there are more new cards beyond the daily limit
    const hasMoreNewCards = await db.getNextStudyCard(c.env.DB, userId, deckId, excludeNoteIds, true, localDate);
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
  const { card_id, rating, time_spent_ms, user_answer, session_id, reviewed_at, offline_result, event_id, local_date } = await c.req.json<{
    card_id: string;
    rating: Rating;
    time_spent_ms?: number;
    user_answer?: string;
    session_id?: string;
    reviewed_at?: string; // ISO timestamp from client (for offline sync)
    event_id?: string; // Client-generated event ID for idempotency
    local_date?: string; // Client's local date YYYY-MM-DD (for timezone-correct daily limits)
    offline_result?: {
      queue: number;
      learning_step: number;
      ease_factor: number;
      interval: number;
      repetitions: number;
      next_review_at: string | null;
      due_timestamp: number | null;
      // FSRS fields
      stability?: number;
      difficulty?: number;
      lapses?: number;
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
    await db.incrementDailyNewCount(c.env.DB, userId, card.note.deck_id, local_date);
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
      // FSRS fields
      stability: offline_result.stability || card.stability || 0,
      difficulty: offline_result.difficulty || card.difficulty || 5,
      lapses: offline_result.lapses || card.lapses || 0,
    };
  } else {
    // Calculate new scheduling values using FSRS algorithm
    result = scheduleCard(
      rating,
      card.queue,
      card.learning_step,
      card.ease_factor,
      card.interval,
      card.repetitions,
      settings,
      card.stability,
      card.difficulty,
      card.lapses
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
  const counts = await db.getQueueCounts(c.env.DB, userId, card.note.deck_id, local_date);

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

// ============ Note Audio Recordings ============

app.get('/api/notes/:id/audio', async (c) => {
  const userId = c.get('user').id;
  const noteId = c.req.param('id');

  const note = await db.getNoteById(c.env.DB, noteId, userId);
  if (!note) {
    return c.json({ error: 'Note not found' }, 404);
  }

  const recordings = await db.getNoteAudioRecordings(c.env.DB, noteId);
  return c.json(recordings);
});

app.post('/api/notes/:id/audio', async (c) => {
  const user = c.get('user');
  const userId = user.id;
  const noteId = c.req.param('id');

  const note = await db.getNoteById(c.env.DB, noteId, userId);
  if (!note) {
    return c.json({ error: 'Note not found' }, 404);
  }

  const contentType = c.req.header('Content-Type') || '';

  if (contentType.includes('multipart/form-data')) {
    // File upload (user/tutor recording)
    const formData = await c.req.formData();
    const file = formData.get('file') as unknown;
    const speakerName = (formData.get('speaker_name') as string) || 'My Recording';

    if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
      return c.json({ error: 'file is required' }, 400);
    }

    const blob = file as Blob;
    const { generateId: genId } = await import('./services/cards');
    const recordingId = genId();
    const key = `recordings/${noteId}/${recordingId}.webm`;
    const arrayBuffer = await blob.arrayBuffer();
    await storeAudio(c.env.AUDIO_BUCKET, key, arrayBuffer, blob.type);

    const recording = await db.addNoteAudioRecording(
      c.env.DB, noteId, key, 'user', speakerName, userId
    );

    return c.json(recording, 201);
  } else {
    // JSON request - generate TTS audio
    let provider: 'minimax' | 'gtts' = 'gtts';
    let speed: number | undefined;
    let voiceId: string | undefined;
    let speakerName: string | undefined;
    try {
      const body = await c.req.json() as { generate?: boolean; provider?: string; speed?: number; voiceId?: string; speakerName?: string };
      if (body.provider === 'minimax' || body.provider === 'gtts') {
        provider = body.provider;
      }
      if (body.speed !== undefined) {
        speed = Math.max(0.3, Math.min(1.5, body.speed));
      }
      if (body.voiceId && typeof body.voiceId === 'string') {
        voiceId = body.voiceId;
      }
      if (body.speakerName && typeof body.speakerName === 'string') {
        speakerName = body.speakerName;
      }
    } catch {
      // Default to gtts
    }

    if (!c.env.GOOGLE_TTS_API_KEY && !c.env.MINIMAX_API_KEY) {
      return c.json({ error: 'TTS is not configured' }, 500);
    }

    try {
      const result = await generateTTS(c.env, note.hanzi, noteId, { preferProvider: provider, speed, voiceId });
      if (!result) {
        return c.json({ error: 'Failed to generate audio' }, 500);
      }

      const recording = await db.addNoteAudioRecording(
        c.env.DB, noteId, result.audioKey, result.provider, speakerName || 'AI Generated', null
      );

      return c.json(recording, 201);
    } catch (error) {
      console.error('TTS generation error:', error);
      return c.json({ error: 'Failed to generate audio' }, 500);
    }
  }
});

app.put('/api/notes/:id/audio/:recordingId/primary', async (c) => {
  const userId = c.get('user').id;
  const noteId = c.req.param('id');
  const recordingId = c.req.param('recordingId');

  const note = await db.getNoteById(c.env.DB, noteId, userId);
  if (!note) {
    return c.json({ error: 'Note not found' }, 404);
  }

  await db.setAudioRecordingPrimary(c.env.DB, noteId, recordingId);
  return c.json({ success: true });
});

app.delete('/api/notes/:id/audio/:recordingId', async (c) => {
  const userId = c.get('user').id;
  const noteId = c.req.param('id');
  const recordingId = c.req.param('recordingId');

  const note = await db.getNoteById(c.env.DB, noteId, userId);
  if (!note) {
    return c.json({ error: 'Note not found' }, 404);
  }

  const result = await db.deleteAudioRecording(c.env.DB, recordingId);
  if (!result) {
    return c.json({ error: 'Recording not found' }, 404);
  }

  // Delete the audio file from R2
  try {
    await deleteAudio(c.env.AUDIO_BUCKET, result.audio_url);
  } catch (err) {
    console.error('[Delete Audio Recording] Failed to delete from R2:', err);
  }

  return c.json({ success: true });
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

// ============ Transcription (Workers AI Whisper) ============

app.post('/api/transcribe', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const formData = await c.req.formData();
  const file = formData.get('file') as unknown;

  if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
    return c.json({ error: 'file is required' }, 400);
  }

  const blob = file as Blob;
  const arrayBuffer = await blob.arrayBuffer();

  try {
    // Use whisper-large-v3-turbo for better accuracy and Chinese language support
    // It supports language, initial_prompt, and prefix parameters unlike basic whisper
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
    const base64 = btoa(binary);
    const result = await c.env.AI.run('@cf/openai/whisper-large-v3-turbo' as any, {
      audio: base64,
      language: 'zh',
      initial_prompt: '以下是普通话的句子。',
    });

    const res = result as Record<string, any>;
    return c.json({
      text: res.text || '',
      language: res.transcription_info?.language || res.detected_language || 'zh',
    });
  } catch (err) {
    console.error('[transcribe] Whisper error:', err);
    return c.json({ error: 'Transcription failed' }, 500);
  }
});

// ============ Azure Speech Pronunciation Assessment ============

app.post('/api/pronunciation-assessment', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  if (!c.env.AZURE_SPEECH_KEY || !c.env.AZURE_SPEECH_REGION) {
    return c.json({ error: 'Azure Speech is not configured' }, 501);
  }

  const formData = await c.req.formData();
  const file = formData.get('file') as unknown;
  const referenceText = formData.get('referenceText') as string;

  if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
    return c.json({ error: 'file is required' }, 400);
  }
  if (!referenceText) {
    return c.json({ error: 'referenceText is required' }, 400);
  }

  const blob = file as Blob;
  const arrayBuffer = await blob.arrayBuffer();

  try {
    // Build pronunciation assessment params
    const pronParams = JSON.stringify({
      ReferenceText: referenceText,
      GradingSystem: 'HundredMark',
      Granularity: 'Phoneme',
      Dimension: 'Comprehensive',
    });
    const pronHeader = btoa(pronParams);

    const region = c.env.AZURE_SPEECH_REGION;
    const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=zh-CN&format=detailed`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': c.env.AZURE_SPEECH_KEY,
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        'Pronunciation-Assessment': pronHeader,
        'Accept': 'application/json',
      },
      body: arrayBuffer,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[pronunciation-assessment] Azure error:', response.status, errorText);
      return c.json({ error: 'Pronunciation assessment failed', details: errorText }, 500);
    }

    const result = await response.json() as Record<string, any>;
    return c.json(result);
  } catch (err) {
    console.error('[pronunciation-assessment] Error:', err);
    return c.json({ error: 'Pronunciation assessment failed' }, 500);
  }
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

    // Queue story generation (runs in background with 15 min timeout)
    await c.env.STORY_QUEUE.send({
      readerId: pendingReader.id,
      vocabulary,
      topic,
      difficulty: difficulty as DifficultyLevel,
    });

    console.log('[Readers] Story generation queued:', pendingReader.id);

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

// ============ Reader Editor ============

app.post('/api/readers', async (c) => {
  const userId = c.get('user').id;
  const { title_chinese, title_english, difficulty_level, topic } = await c.req.json<{ title_chinese: string; title_english: string; difficulty_level: DifficultyLevel; topic?: string }>();
  const reader = await db.createBlankReader(c.env.DB, userId, { title_chinese, title_english, difficulty_level, topic: topic || null });
  return c.json(reader);
});

app.put('/api/readers/:id', async (c) => {
  const userId = c.get('user').id;
  const readerId = c.req.param('id');
  const data = await c.req.json<{ title_chinese?: string; title_english?: string; difficulty_level?: DifficultyLevel; topic?: string | null }>();
  await db.updateGradedReader(c.env.DB, readerId, userId, data);
  const updated = await db.getGradedReader(c.env.DB, readerId, userId);
  return c.json(updated);
});

app.post('/api/readers/:id/pages', async (c) => {
  const userId = c.get('user').id;
  const readerId = c.req.param('id');
  const pageData = await c.req.json<{ content_chinese: string; content_pinyin: string; content_english: string; image_prompt?: string | null }>();
  const page = await db.addReaderPage(c.env.DB, readerId, userId, { ...pageData, image_prompt: pageData.image_prompt || null });
  return c.json(page);
});

app.put('/api/readers/:readerId/pages/:pageId', async (c) => {
  const userId = c.get('user').id;
  const readerId = c.req.param('readerId');
  const pageId = c.req.param('pageId');
  const data = await c.req.json<{ content_chinese?: string; content_pinyin?: string; content_english?: string; image_prompt?: string | null }>();
  await db.updateReaderPage(c.env.DB, pageId, readerId, userId, data);
  return c.json({ success: true });
});

app.delete('/api/readers/:readerId/pages/:pageId', async (c) => {
  const userId = c.get('user').id;
  const readerId = c.req.param('readerId');
  const pageId = c.req.param('pageId');
  await db.deleteReaderPage(c.env.DB, pageId, readerId, userId);
  return c.json({ success: true });
});

app.post('/api/readers/:id/pages/reorder', async (c) => {
  const userId = c.get('user').id;
  const readerId = c.req.param('id');
  const { pageIds } = await c.req.json<{ pageIds: string[] }>();
  await db.reorderReaderPages(c.env.DB, readerId, userId, pageIds);
  return c.json({ success: true });
});

app.post('/api/readers/:id/publish', async (c) => {
  const userId = c.get('user').id;
  const readerId = c.req.param('id');
  const stmt = c.env.DB.prepare('UPDATE graded_readers SET is_published = 1 WHERE id = ? AND user_id = ?');
  await stmt.bind(readerId, userId).run();
  return c.json({ success: true });
});

app.post('/api/readers/:readerId/pages/:pageId/generate-text', async (c) => {
  const userId = c.get('user').id;
  const readerId = c.req.param('readerId');
  const pageId = c.req.param('pageId');
  const { field, context } = await c.req.json<{ field: 'chinese' | 'pinyin' | 'english' | 'image_prompt'; context?: string }>();

  const reader = await db.getGradedReader(c.env.DB, readerId, userId);
  if (!reader) return c.json({ error: 'Reader not found' }, 404);
  const page = reader.pages.find(p => p.id === pageId);
  if (!page) return c.json({ error: 'Page not found' }, 404);

  const anthropic = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
  let systemPrompt = '';
  let userPrompt = '';

  if (field === 'chinese') {
    systemPrompt = `You are a Chinese language expert creating graded reader content at ${reader.difficulty_level} level. Write a short paragraph (2-4 sentences) of Chinese text for a story page. Only output the Chinese text, nothing else.`;
    userPrompt = context || `Story: "${reader.title_chinese}" (${reader.title_english}). Topic: ${reader.topic || 'general'}. Page ${page.page_number}. Write the next page in Chinese.`;
  } else if (field === 'pinyin') {
    systemPrompt = 'You are a Chinese language expert. Convert the given Chinese text to pinyin with tone marks. Only output the pinyin, nothing else.';
    userPrompt = page.content_chinese || 'No Chinese text provided yet.';
  } else if (field === 'english') {
    systemPrompt = 'You are a Chinese-English translator. Translate the given Chinese text into natural English. Only output the English translation, nothing else.';
    userPrompt = page.content_chinese || 'No Chinese text provided yet.';
  } else if (field === 'image_prompt') {
    systemPrompt = 'You create image generation prompts for children\'s storybook illustrations. Create a vivid, descriptive prompt. Output only the image prompt, nothing else.';
    userPrompt = `Chinese text: ${page.content_chinese || 'N/A'}\nEnglish: ${page.content_english || 'N/A'}\nStory: ${reader.title_english}`;
  }

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  return c.json({ text });
});

// ============ Homework Assignments ============

// Assign a reader as homework to a student
// Authorization: user must have an active tutor relationship with the student (checked below)
app.post('/api/homework', async (c) => {
  const user = c.get('user');

  const { reader_id, student_id, notes } = await c.req.json<{ reader_id: string; student_id: string; notes?: string }>();
  if (!reader_id || !student_id) {
    return c.json({ error: 'reader_id and student_id are required' }, 400);
  }

  // Verify the reader exists
  const reader = await db.getGradedReader(c.env.DB, reader_id, user.id);
  if (!reader) {
    return c.json({ error: 'Reader not found' }, 404);
  }

  // Verify tutor-student relationship exists
  const relationships = await getMyRelationships(c.env.DB, user.id);
  const hasRelationship = relationships.students.some(
    (r) => r.requester_id === student_id || r.recipient_id === student_id
  );
  if (!hasRelationship) {
    return c.json({ error: 'No active relationship with this student' }, 403);
  }

  const assignment = await db.createHomeworkAssignment(
    c.env.DB, user.id, student_id, reader_id, notes || null
  );

  // Notify student of new homework assignment
  const readerTitle = reader.title_english || reader.title_chinese;
  c.executionCtx.waitUntil(
    db.createNotification(
      c.env.DB,
      student_id,
      'homework_assigned',
      'New Homework Assigned',
      `${user.name || 'Your tutor'} assigned you "${readerTitle}"`,
      assignment.id,
    ).catch(err => console.error('[Notifications] Failed to create assignment notification:', err))
  );
  c.executionCtx.waitUntil(
    notifyHomeworkAssigned(c.env.NTFY_TOPIC, user.name || 'Tutor', readerTitle)
  );

  return c.json(assignment, 201);
});

// List homework for the current user
app.get('/api/homework', async (c) => {
  const userId = c.get('user').id;
  const assignments = await db.getHomeworkAssignments(c.env.DB, userId);
  return c.json(assignments);
});

// Get homework details
app.get('/api/homework/:id', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const assignment = await db.getHomeworkAssignment(c.env.DB, id, userId);
  if (!assignment) {
    return c.json({ error: 'Homework not found' }, 404);
  }
  return c.json(assignment);
});

// Update homework status (student only)
app.patch('/api/homework/:id/status', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const { status } = await c.req.json<{ status: string }>();

  if (status !== 'in_progress' && status !== 'completed') {
    return c.json({ error: 'Status must be "in_progress" or "completed"' }, 400);
  }

  const updated = await db.updateHomeworkStatus(c.env.DB, id, userId, status);
  if (!updated) {
    return c.json({ error: 'Homework not found or not authorized' }, 404);
  }

  const assignment = await db.getHomeworkAssignment(c.env.DB, id, userId);
  return c.json(assignment);
});

// Delete homework (tutor only)
app.delete('/api/homework/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const deleted = await db.deleteHomeworkAssignment(c.env.DB, id, user.id);
  if (!deleted) {
    return c.json({ error: 'Homework not found or not authorized' }, 404);
  }
  return c.json({ success: true });
});

// Upload a recording for a homework assignment page or voice note
app.post('/api/homework/:id/recordings', async (c) => {
  const userId = c.get('user').id;
  const homeworkId = c.req.param('id');

  // Verify homework belongs to this student
  const hw = await db.getHomeworkAssignment(c.env.DB, homeworkId, userId);
  if (!hw || hw.student_id !== userId) {
    return c.json({ error: 'Homework not found or not authorized' }, 404);
  }
  if (hw.status === 'completed') {
    return c.json({ error: 'Cannot add recordings to completed homework' }, 400);
  }

  const formData = await c.req.formData();
  const file = formData.get('file') as unknown;
  const pageId = formData.get('page_id') as string | null;
  const type = (formData.get('type') as string) || 'page_reading';
  const durationMs = formData.get('duration_ms') ? parseInt(formData.get('duration_ms') as string, 10) : null;

  if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
    return c.json({ error: 'file is required' }, 400);
  }
  if (type !== 'page_reading' && type !== 'voice_note') {
    return c.json({ error: 'type must be "page_reading" or "voice_note"' }, 400);
  }
  if (type === 'page_reading' && !pageId) {
    return c.json({ error: 'page_id is required for page recordings' }, 400);
  }

  // If replacing an existing recording for this page, delete the old one
  if (pageId) {
    const existing = await db.getHomeworkRecordings(c.env.DB, homeworkId);
    const old = existing.find((r) => r.page_id === pageId && r.type === 'page_reading');
    if (old) {
      await deleteAudio(c.env.AUDIO_BUCKET, old.audio_url);
      await db.deleteHomeworkRecording(c.env.DB, old.id, homeworkId);
    }
  }
  // For voice notes, also replace existing
  if (type === 'voice_note') {
    const existing = await db.getHomeworkRecordings(c.env.DB, homeworkId);
    const old = existing.find((r) => r.type === 'voice_note');
    if (old) {
      await deleteAudio(c.env.AUDIO_BUCKET, old.audio_url);
      await db.deleteHomeworkRecording(c.env.DB, old.id, homeworkId);
    }
  }

  const blob = file as Blob;
  const recordingId = crypto.randomUUID().split('-')[0];
  const key = `recordings/homework/${homeworkId}/${recordingId}.webm`;
  const arrayBuffer = await blob.arrayBuffer();
  await storeAudio(c.env.AUDIO_BUCKET, key, arrayBuffer, blob.type || 'audio/webm');

  // Auto-transition from 'assigned' to 'in_progress'
  if (hw.status === 'assigned') {
    await db.updateHomeworkStatus(c.env.DB, homeworkId, userId, 'in_progress');
  }

  const recording = await db.createHomeworkRecording(
    c.env.DB, homeworkId, key, type as 'page_reading' | 'voice_note', pageId, durationMs
  );
  return c.json(recording, 201);
});

// List recordings for a homework assignment
app.get('/api/homework/:id/recordings', async (c) => {
  const userId = c.get('user').id;
  const homeworkId = c.req.param('id');

  // Verify user has access (student or tutor)
  const hw = await db.getHomeworkAssignment(c.env.DB, homeworkId, userId);
  if (!hw) {
    return c.json({ error: 'Homework not found' }, 404);
  }

  const recordings = await db.getHomeworkRecordings(c.env.DB, homeworkId);
  return c.json(recordings);
});

// Delete a specific recording
app.delete('/api/homework/:id/recordings/:recordingId', async (c) => {
  const userId = c.get('user').id;
  const homeworkId = c.req.param('id');
  const recordingId = c.req.param('recordingId');

  const hw = await db.getHomeworkAssignment(c.env.DB, homeworkId, userId);
  if (!hw || hw.student_id !== userId) {
    return c.json({ error: 'Homework not found or not authorized' }, 404);
  }
  if (hw.status === 'completed') {
    return c.json({ error: 'Cannot modify completed homework' }, 400);
  }

  const deleted = await db.deleteHomeworkRecording(c.env.DB, recordingId, homeworkId);
  if (!deleted) {
    return c.json({ error: 'Recording not found' }, 404);
  }
  await deleteAudio(c.env.AUDIO_BUCKET, deleted.audio_url);
  return c.json({ success: true });
});

// Submit homework (student only)
app.post('/api/homework/:id/submit', async (c) => {
  const userId = c.get('user').id;
  const homeworkId = c.req.param('id');

  const hw = await db.getHomeworkAssignment(c.env.DB, homeworkId, userId);
  if (!hw || hw.student_id !== userId) {
    return c.json({ error: 'Homework not found or not authorized' }, 404);
  }
  if (hw.status === 'completed') {
    return c.json({ error: 'Homework already submitted' }, 400);
  }

  const submitted = await db.submitHomework(c.env.DB, homeworkId, userId);
  if (!submitted) {
    return c.json({ error: 'Failed to submit homework' }, 500);
  }

  // Notify tutor that student submitted homework
  const submitReaderTitle = hw.reader_title_english || hw.reader_title_chinese;
  c.executionCtx.waitUntil(
    db.createNotification(
      c.env.DB,
      hw.tutor_id,
      'homework_submitted',
      'Homework Submitted',
      `${hw.student_name || 'Your student'} submitted "${submitReaderTitle}"`,
      homeworkId,
    ).catch(err => console.error('[Notifications] Failed to create submission notification:', err))
  );
  c.executionCtx.waitUntil(
    notifyHomeworkSubmitted(c.env.NTFY_TOPIC, hw.student_name || 'Student', submitReaderTitle)
  );

  const updated = await db.getHomeworkAssignment(c.env.DB, homeworkId, userId);
  return c.json(updated);
});

// ============ Homework Feedback ============

// Submit feedback on a homework assignment (tutor for this assignment)
app.post('/api/homework/:id/feedback', async (c) => {
  const user = c.get('user');

  const homeworkId = c.req.param('id');
  const hw = await db.getHomeworkAssignment(c.env.DB, homeworkId, user.id);
  if (!hw || hw.tutor_id !== user.id) {
    return c.json({ error: 'Homework not found or not authorized' }, 404);
  }
  if (hw.status !== 'completed' && hw.status !== 'reviewed') {
    return c.json({ error: 'Can only give feedback on completed homework' }, 400);
  }

  const formData = await c.req.formData();
  const textFeedback = formData.get('text_feedback') as string | null;
  const pageId = formData.get('page_id') as string | null;
  const type = (formData.get('type') as string) || 'page_feedback';
  const ratingStr = formData.get('rating') as string | null;
  const rating = ratingStr ? parseInt(ratingStr, 10) : null;
  const file = formData.get('file') as unknown;

  if (type !== 'page_feedback' && type !== 'overall') {
    return c.json({ error: 'type must be "page_feedback" or "overall"' }, 400);
  }
  if (type === 'page_feedback' && !pageId) {
    return c.json({ error: 'page_id is required for page feedback' }, 400);
  }
  if (rating !== null && (rating < 1 || rating > 5)) {
    return c.json({ error: 'rating must be between 1 and 5' }, 400);
  }
  if (!textFeedback && !file) {
    return c.json({ error: 'Either text_feedback or audio file is required' }, 400);
  }

  let audioFeedbackUrl: string | null = null;

  // If replacing existing feedback for same page/overall, delete old audio
  const existing = await db.getHomeworkFeedback(c.env.DB, homeworkId);
  const old = type === 'page_feedback'
    ? existing.find((f) => f.page_id === pageId && f.type === 'page_feedback')
    : existing.find((f) => f.type === 'overall');
  if (old) {
    if (old.audio_feedback_url) {
      await deleteAudio(c.env.AUDIO_BUCKET, old.audio_feedback_url);
    }
    await db.deleteHomeworkFeedback(c.env.DB, old.id, user.id);
  }

  if (file && typeof file === 'object' && 'arrayBuffer' in file) {
    const blob = file as Blob;
    const feedbackId = crypto.randomUUID().split('-')[0];
    const key = `recordings/feedback/${homeworkId}/${feedbackId}.webm`;
    const arrayBuffer = await blob.arrayBuffer();
    await storeAudio(c.env.AUDIO_BUCKET, key, arrayBuffer, blob.type || 'audio/webm');
    audioFeedbackUrl = key;
  }

  const feedback = await db.createHomeworkFeedback(
    c.env.DB, homeworkId, user.id, type as 'page_feedback' | 'overall',
    pageId, textFeedback, audioFeedbackUrl, rating
  );
  return c.json(feedback, 201);
});

// Get all feedback for a homework assignment
app.get('/api/homework/:id/feedback', async (c) => {
  const userId = c.get('user').id;
  const homeworkId = c.req.param('id');

  const hw = await db.getHomeworkAssignment(c.env.DB, homeworkId, userId);
  if (!hw) {
    return c.json({ error: 'Homework not found' }, 404);
  }

  const feedback = await db.getHomeworkFeedback(c.env.DB, homeworkId);
  return c.json(feedback);
});

// Update feedback
app.put('/api/homework/:id/feedback/:feedbackId', async (c) => {
  const user = c.get('user');

  const homeworkId = c.req.param('id');
  const feedbackId = c.req.param('feedbackId');

  const hw = await db.getHomeworkAssignment(c.env.DB, homeworkId, user.id);
  if (!hw || hw.tutor_id !== user.id) {
    return c.json({ error: 'Homework not found or not authorized' }, 404);
  }

  const formData = await c.req.formData();
  const textFeedback = formData.get('text_feedback') as string | null;
  const ratingStr = formData.get('rating') as string | null;
  const rating = ratingStr ? parseInt(ratingStr, 10) : null;
  const file = formData.get('file') as unknown;

  if (rating !== null && (rating < 1 || rating > 5)) {
    return c.json({ error: 'rating must be between 1 and 5' }, 400);
  }

  // Get existing feedback to handle audio replacement
  const existingFeedback = await db.getHomeworkFeedback(c.env.DB, homeworkId);
  const existing = existingFeedback.find((f) => f.id === feedbackId);
  if (!existing) {
    return c.json({ error: 'Feedback not found' }, 404);
  }

  let audioFeedbackUrl = existing.audio_feedback_url;
  if (file && typeof file === 'object' && 'arrayBuffer' in file) {
    // Delete old audio if present
    if (existing.audio_feedback_url) {
      await deleteAudio(c.env.AUDIO_BUCKET, existing.audio_feedback_url);
    }
    const blob = file as Blob;
    const newId = crypto.randomUUID().split('-')[0];
    const key = `recordings/feedback/${homeworkId}/${newId}.webm`;
    const arrayBuffer = await blob.arrayBuffer();
    await storeAudio(c.env.AUDIO_BUCKET, key, arrayBuffer, blob.type || 'audio/webm');
    audioFeedbackUrl = key;
  }

  const updated = await db.updateHomeworkFeedback(
    c.env.DB, feedbackId, user.id, textFeedback, audioFeedbackUrl, rating
  );
  if (!updated) {
    return c.json({ error: 'Feedback not found or not authorized' }, 404);
  }
  return c.json(updated);
});

// Delete feedback
app.delete('/api/homework/:id/feedback/:feedbackId', async (c) => {
  const user = c.get('user');

  const feedbackId = c.req.param('feedbackId');
  const deleted = await db.deleteHomeworkFeedback(c.env.DB, feedbackId, user.id);
  if (!deleted) {
    return c.json({ error: 'Feedback not found or not authorized' }, 404);
  }
  if (deleted.audio_feedback_url) {
    await deleteAudio(c.env.AUDIO_BUCKET, deleted.audio_feedback_url);
  }
  return c.json({ success: true });
});

// Mark review as complete (tutor for this assignment)
app.post('/api/homework/:id/review-complete', async (c) => {
  const user = c.get('user');

  const homeworkId = c.req.param('id');
  const hw = await db.getHomeworkAssignment(c.env.DB, homeworkId, user.id);
  if (!hw || hw.tutor_id !== user.id) {
    return c.json({ error: 'Homework not found or not authorized' }, 404);
  }

  const marked = await db.markHomeworkReviewed(c.env.DB, homeworkId, user.id);
  if (!marked) {
    return c.json({ error: 'Homework must be completed before review' }, 400);
  }

  // Notify student that tutor completed review
  const reviewReaderTitle = hw.reader_title_english || hw.reader_title_chinese;
  c.executionCtx.waitUntil(
    db.createNotification(
      c.env.DB,
      hw.student_id,
      'homework_reviewed',
      'Homework Reviewed',
      `${user.name || 'Your tutor'} reviewed "${reviewReaderTitle}"`,
      homeworkId,
    ).catch(err => console.error('[Notifications] Failed to create review notification:', err))
  );
  c.executionCtx.waitUntil(
    notifyHomeworkReviewed(c.env.NTFY_TOPIC, user.name || 'Tutor', reviewReaderTitle)
  );

  const updated = await db.getHomeworkAssignment(c.env.DB, homeworkId, user.id);
  return c.json(updated);
});

// ============ Notifications ============

// List notifications for the current user
app.get('/api/notifications', async (c) => {
  const userId = c.get('user').id;
  const notifications = await db.getNotifications(c.env.DB, userId);
  return c.json(notifications);
});

// Get unread notification count
app.get('/api/notifications/unread-count', async (c) => {
  const userId = c.get('user').id;
  const count = await db.getUnreadNotificationCount(c.env.DB, userId);
  return c.json({ count });
});

// Mark all notifications as read
app.patch('/api/notifications/read-all', async (c) => {
  const userId = c.get('user').id;
  const updated = await db.markAllNotificationsRead(c.env.DB, userId);
  return c.json({ updated });
});

// Mark notifications as read for a specific conversation
app.patch('/api/notifications/read-by-conversation/:conversationId', async (c) => {
  const userId = c.get('user').id;
  const conversationId = c.req.param('conversationId');
  const updated = await db.markNotificationsReadByConversation(c.env.DB, userId, conversationId);
  return c.json({ updated });
});

// Mark a single notification as read
app.patch('/api/notifications/:id/read', async (c) => {
  const userId = c.get('user').id;
  const notificationId = c.req.param('id');
  const success = await db.markNotificationRead(c.env.DB, notificationId, userId);
  if (!success) {
    return c.json({ error: 'Notification not found' }, 404);
  }
  return c.json({ success: true });
});

// ============ Relationships (Tutor-Student) ============

// List my relationships (tutors, students, pending)
app.get('/api/relationships', async (c) => {
  const user = c.get('user');
  // Process any pending invitations for this user's email before returning relationships.
  // This handles the case where an existing user was invited while already logged in.
  await processPendingInvitations(c.env.DB, user);
  const relationships = await getMyRelationships(c.env.DB, user.id);
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

    // Regular relationship — notify the recipient via email
    if (result.type === 'relationship' && result.data.status === 'pending') {
      if (c.env.SENDGRID_API_KEY) {
        const recipient = result.data.requester.id === userId
          ? result.data.recipient : result.data.requester;
        if (recipient.email) {
          c.executionCtx.waitUntil(
            sendConnectionRequestEmail(c.env.SENDGRID_API_KEY, {
              recipientEmail: recipient.email,
              recipientName: recipient.name,
              requesterName: user.name,
              requesterRole: role,
            }).catch(err => {
              console.error('[Relationships] Failed to send connection request email:', err);
            })
          );
        }
      }
    }

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
  const { content, reply_to_message_id } = await c.req.json<SendMessageRequest>();

  if (!content || content.trim() === '') {
    return c.json({ error: 'Message content is required' }, 400);
  }

  try {
    const message = await sendMessage(c.env.DB, convId, userId, content, reply_to_message_id);

    // Send email + in-app notification to the other user (non-blocking)
    // Must use waitUntil() so the worker stays alive for the SendGrid fetch
    c.executionCtx.waitUntil((async () => {
      try {
        const conv = await getConversationById(c.env.DB, convId, userId);
        if (!conv) return;
        const relationship = await getRelationshipById(c.env.DB, conv.relationship_id);
        if (!relationship) return;
        const otherUserId = getOtherUserId(relationship, userId);
        const otherUser =
          relationship.requester.id === otherUserId
            ? relationship.requester
            : relationship.recipient;
        const senderName = message.sender.name || 'Someone';
        const truncatedContent = content.length > 100 ? content.slice(0, 100) + '...' : content;

        // Send email notification
        if (c.env.SENDGRID_API_KEY && otherUser.email) {
          const sent = await sendNewMessageNotification(c.env.SENDGRID_API_KEY, {
            recipientEmail: otherUser.email,
            recipientName: otherUser.name,
            senderName: message.sender.name,
            messagePreview: content,
            conversationId: convId,
            relationshipId: conv.relationship_id,
          });
          console.log('[Email] Message notification to', otherUser.email, sent ? 'sent' : 'FAILED');
        }

        // Create in-app notification (with deduplication)
        const existing = await db.getRecentUnreadChatNotification(c.env.DB, otherUserId, convId);
        if (existing) {
          // Count existing messages from the title (e.g., "2 new messages from X")
          const countMatch = existing.title.match(/^(\d+) new messages from/);
          const currentCount = countMatch ? parseInt(countMatch[1], 10) : 1;
          const newCount = currentCount + 1;
          await db.updateNotificationMessage(
            c.env.DB,
            existing.id,
            `${newCount} new messages from ${senderName}`,
            truncatedContent,
          );
        } else {
          await db.createNotification(
            c.env.DB,
            otherUserId,
            'new_chat_message',
            `New message from ${senderName}`,
            truncatedContent,
            null,
            { conversation_id: convId, relationship_id: conv.relationship_id },
          );
        }

        // Send push notification via ntfy
        await notifyNewChatMessage(c.env.NTFY_TOPIC, senderName, truncatedContent);
      } catch (err) {
        console.error('[Notifications] Failed to send message notification:', err);
      }
    })());

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
        'anthropic-version': '2024-10-22',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
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
    const body = await c.req.json<{
      intendedMeaning?: string;
      guess?: string;
    }>().catch(() => ({} as { intendedMeaning?: string; guess?: string }));

    // Get chat context
    const chatContext = await getChatContext(c.env.DB, convId, userId);
    if (!chatContext || chatContext.trim() === '') {
      return c.json({ error: 'No messages found to generate response options from' }, 400);
    }

    const result = await generateIDontKnowOptions(
      c.env.ANTHROPIC_API_KEY,
      chatContext,
      body.intendedMeaning,
      body.guess,
    );

    return c.json({ explanation: result.explanation, options: result.options });
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

// Generate Claude's opening message for a new AI conversation (e.g. from study card)
app.post('/api/conversations/:id/ai-initiate', async (c) => {
  const userId = c.get('user').id;
  const convId = c.req.param('id');

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI is not configured' }, 500);
  }

  try {
    const conv = await getConversationById(c.env.DB, convId, userId);
    if (!conv) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    if (!conv.is_ai_conversation) {
      return c.json({ error: 'This is not an AI conversation' }, 400);
    }

    // Check conversation has no messages yet (this is for initiating only)
    const { messages } = await getMessages(c.env.DB, convId, userId);
    if (messages.length > 0) {
      return c.json({ error: 'Conversation already has messages' }, 400);
    }

    // Generate Claude's opening message
    const aiResponse = await generateAIConversationOpener(
      c.env.ANTHROPIC_API_KEY,
      conv,
    );

    // Save AI message
    const aiMessage = await sendMessage(c.env.DB, convId, CLAUDE_AI_USER_ID, aiResponse);

    // Generate TTS audio
    let audioBase64: string | null = null;
    let audioContentType: string | null = null;

    const ttsResult = await generateConversationTTS(c.env, aiResponse, {
      voiceId: conv.voice_id || 'Chinese (Mandarin)_Gentleman',
      speed: conv.voice_speed || 0.8,
    });

    if (ttsResult) {
      audioBase64 = ttsResult.audioBase64;
      audioContentType = ttsResult.contentType;
    }

    return c.json({
      message: aiMessage,
      audio_base64: audioBase64,
      audio_content_type: audioContentType,
    });
  } catch (error) {
    console.error('AI initiate error:', error);
    const message = error instanceof Error ? error.message : 'Failed to initiate AI conversation';
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

// Discuss a message with Claude (with flashcard creation tool)
app.post('/api/messages/:id/discuss', async (c) => {
  const userId = c.get('user').id;
  const msgId = c.req.param('id');
  const { question, conversationHistory } = await c.req.json<{
    question: string;
    conversationHistory?: { role: 'user' | 'assistant'; content: string }[];
  }>();

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI is not configured' }, 500);
  }

  if (!question || !question.trim()) {
    return c.json({ error: 'Question is required' }, 400);
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

    // Verify user has access to this conversation
    const conv = await c.env.DB
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .bind(message.conversation_id)
      .first<{ id: string; relationship_id: string }>();

    if (!conv) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    // Verify relationship access
    const rel = await c.env.DB
      .prepare('SELECT * FROM tutor_relationships WHERE id = ? AND status = ? AND (requester_id = ? OR recipient_id = ?)')
      .bind(conv.relationship_id, 'active', userId, userId)
      .first();

    if (!rel) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // Get chat context (surrounding messages)
    const chatContext = await getChatContext(c.env.DB, message.conversation_id, userId);

    // Call AI discussion with DB context for read-only tools
    const result = await discussMessage(
      c.env.ANTHROPIC_API_KEY,
      message.content,
      question.trim(),
      chatContext,
      conversationHistory,
      { db: c.env.DB, userId }
    );

    return c.json(result);
  } catch (error) {
    console.error('Discuss message error:', error);
    const errMsg = error instanceof Error ? error.message : 'Failed to discuss message';
    return c.json({ error: errMsg }, 500);
  }
});

// Toggle a reaction on a message
app.post('/api/messages/:id/reactions', async (c) => {
  const userId = c.get('user').id;
  const msgId = c.req.param('id');
  const { emoji } = await c.req.json<{ emoji: string }>();

  if (!emoji) {
    return c.json({ error: 'Emoji is required' }, 400);
  }

  try {
    // Verify message exists and user has access
    const message = await c.env.DB
      .prepare('SELECT conversation_id FROM messages WHERE id = ?')
      .bind(msgId)
      .first<{ conversation_id: string }>();

    if (!message) {
      return c.json({ error: 'Message not found' }, 404);
    }

    const conv = await c.env.DB
      .prepare('SELECT relationship_id FROM conversations WHERE id = ?')
      .bind(message.conversation_id)
      .first<{ relationship_id: string }>();

    if (!conv) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    const rel = await c.env.DB
      .prepare('SELECT id FROM tutor_relationships WHERE id = ? AND status = ? AND (requester_id = ? OR recipient_id = ?)')
      .bind(conv.relationship_id, 'active', userId, userId)
      .first();

    if (!rel) {
      return c.json({ error: 'Access denied' }, 403);
    }

    const result = await toggleReaction(c.env.DB, msgId, userId, emoji);
    return c.json(result);
  } catch (error) {
    console.error('Toggle reaction error:', error);
    const errMsg = error instanceof Error ? error.message : 'Failed to toggle reaction';
    return c.json({ error: errMsg }, 500);
  }
});

// Get persistent discussion for a message
app.get('/api/messages/:id/discussion', async (c) => {
  const userId = c.get('user').id;
  const msgId = c.req.param('id');

  try {
    const discussion = await getMessageDiscussion(c.env.DB, msgId, userId);
    return c.json(discussion);
  } catch (error) {
    console.error('Get discussion error:', error);
    const errMsg = error instanceof Error ? error.message : 'Failed to get discussion';
    return c.json({ error: errMsg }, 500);
  }
});

// Save persistent discussion for a message
app.put('/api/messages/:id/discussion', async (c) => {
  const userId = c.get('user').id;
  const msgId = c.req.param('id');
  const { messages } = await c.req.json<{ messages: Array<{ role: string; content: string }> }>();

  try {
    await saveMessageDiscussion(c.env.DB, msgId, userId, messages);
    return c.json({ success: true });
  } catch (error) {
    console.error('Save discussion error:', error);
    const errMsg = error instanceof Error ? error.message : 'Failed to save discussion';
    return c.json({ error: errMsg }, 500);
  }
});

// Translate a message and generate a flashcard from it
app.post('/api/messages/:id/translate-flashcard', async (c) => {
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

    // Verify user has access to this conversation
    const conv = await c.env.DB
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .bind(message.conversation_id)
      .first<{ id: string; relationship_id: string }>();

    if (!conv) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    const rel = await c.env.DB
      .prepare('SELECT * FROM tutor_relationships WHERE id = ? AND status = ? AND (requester_id = ? OR recipient_id = ?)')
      .bind(conv.relationship_id, 'active', userId, userId)
      .first();

    if (!rel) {
      return c.json({ error: 'Access denied' }, 403);
    }

    const prompt = `You are a Mandarin Chinese language expert. A student received this message in a conversation:

"${message.content}"

Please:
1. Translate the message to English
2. Identify the key vocabulary word or phrase from this message that would be most valuable to learn as a flashcard

IMPORTANT: Use tone marks for pinyin (nǐ hǎo) NOT tone numbers (ni3 hao3).

Respond with ONLY a JSON object in this exact format:
{
  "translation": "The full English translation of the message",
  "flashcard": {
    "hanzi": "汉字",
    "pinyin": "hànzì",
    "english": "Chinese characters",
    "fun_facts": "A helpful tip or interesting fact about this word or phrase",
    "context": "The original sentence this appeared in"
  }
}`;

    const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });
    const aiResponse = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    const textContent = aiResponse.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No response from AI');
    }

    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Invalid AI response format');
    }

    const result = JSON.parse(jsonMatch[0]) as {
      translation: string;
      flashcard: {
        hanzi: string;
        pinyin: string;
        english: string;
        fun_facts?: string;
        context?: string;
      };
    };

    return c.json(result);
  } catch (error) {
    console.error('Translate flashcard error:', error);
    const errMsg = error instanceof Error ? error.message : 'Failed to translate message';
    return c.json({ error: errMsg }, 500);
  }
});

// Translate and segment a message for interactive translation
app.post('/api/messages/:id/translate-segmented', async (c) => {
  const userId = c.get('user').id;
  const msgId = c.req.param('id');

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI is not configured' }, 500);
  }

  try {
    // Get message and verify access (same auth as translate-flashcard)
    const message = await c.env.DB
      .prepare('SELECT * FROM messages WHERE id = ?')
      .bind(msgId)
      .first<{ id: string; conversation_id: string; content: string; translation: string | null; segmentation: string | null }>();

    if (!message) {
      return c.json({ error: 'Message not found' }, 404);
    }

    // Check conversation access
    const conv = await c.env.DB
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .bind(message.conversation_id)
      .first<{ id: string; relationship_id: string }>();

    if (!conv) {
      return c.json({ error: 'Conversation not found' }, 404);
    }

    const rel = await c.env.DB
      .prepare('SELECT * FROM tutor_relationships WHERE id = ? AND status = ? AND (requester_id = ? OR recipient_id = ?)')
      .bind(conv.relationship_id, 'active', userId, userId)
      .first();

    if (!rel) {
      return c.json({ error: 'Access denied' }, 403);
    }

    // Return cached if already translated
    if (message.translation && message.segmentation) {
      return c.json({
        translation: message.translation,
        segmentation: JSON.parse(message.segmentation)
      });
    }

    // Translate and segment
    const { translateAndSegment } = await import('./services/translation');
    const result = await translateAndSegment(c.env.ANTHROPIC_API_KEY, message.content);

    // Update message with translation
    await c.env.DB
      .prepare('UPDATE messages SET translation = ?, segmentation = ? WHERE id = ?')
      .bind(result.translation, JSON.stringify(result.segmentation), msgId)
      .run();

    return c.json(result);
  } catch (error) {
    console.error('Translate segmented error:', error);
    const errMsg = error instanceof Error ? error.message : 'Failed to translate message';
    return c.json({ error: errMsg }, 500);
  }
});

// Helper: fetch a character definition from Claude AI and cache it in D1
async function fetchAndCacheDefinition(
  db: D1Database,
  hanzi: string,
  context: string | undefined,
  apiKey: string,
): Promise<{ hanzi: string; pinyin: string; english: string; fun_facts?: string; example?: string }> {
  const prompt = `You are a Mandarin Chinese language expert. Define this Chinese word/phrase: "${hanzi}"
${context ? `\nContext sentence: "${context}"` : ''}

IMPORTANT: Use tone marks for pinyin (nǐ hǎo) NOT tone numbers (ni3 hao3).

Provide:
1. Hanzi (the word/phrase itself)
2. Pinyin with tone marks
3. English definition
4. A fun fact or usage note about the word
5. An example sentence using the word (if not provided in context)

Respond with ONLY a JSON object in this exact format:
{
  "hanzi": "...",
  "pinyin": "...",
  "english": "...",
  "fun_facts": "...",
  "example": "..."
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.statusText}`);
  }

  const data = await response.json<any>();
  const text = data.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse AI response');
  }

  const result = JSON.parse(jsonMatch[0]);

  // Cache in D1 (fire-and-forget, don't block response)
  try {
    await db.prepare(
      `INSERT OR REPLACE INTO character_definitions (hanzi, pinyin, english, fun_facts, example, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).bind(result.hanzi, result.pinyin, result.english, result.fun_facts || null, result.example || null).run();
  } catch (e) {
    console.error('Failed to cache definition:', e);
  }

  return result;
}

// Define a vocabulary word with context
app.post('/api/vocabulary/define', async (c) => {
  const userId = c.get('user').id;
  const { hanzi, context, skipCache } = await c.req.json<{ hanzi: string; context?: string; skipCache?: boolean }>();

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI is not configured' }, 500);
  }

  if (!hanzi || hanzi.trim() === '') {
    return c.json({ error: 'Hanzi is required' }, 400);
  }

  try {
    // Check global D1 cache first (unless skipCache is set for refresh)
    if (!skipCache) {
      const cached = await c.env.DB.prepare(
        'SELECT hanzi, pinyin, english, fun_facts, example FROM character_definitions WHERE hanzi = ?'
      ).bind(hanzi.trim()).first<{ hanzi: string; pinyin: string; english: string; fun_facts: string | null; example: string | null }>();

      if (cached) {
        return c.json({ ...cached, cached: true });
      }
    }

    const result = await fetchAndCacheDefinition(c.env.DB, hanzi.trim(), context, c.env.ANTHROPIC_API_KEY);
    return c.json(result);
  } catch (error) {
    console.error('Define vocabulary error:', error);
    const errMsg = error instanceof Error ? error.message : 'Failed to define word';
    return c.json({ error: errMsg }, 500);
  }
});

// Pre-populate character definitions for a user's learned vocabulary
app.post('/api/vocabulary/populate', async (c) => {
  const userId = c.get('user').id;

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI is not configured' }, 500);
  }

  try {
    // Get all unique hanzi from the user's notes
    const notes = await c.env.DB.prepare(
      `SELECT DISTINCT n.hanzi FROM notes n
       JOIN decks d ON n.deck_id = d.id
       WHERE d.user_id = ? AND n.hanzi IS NOT NULL AND n.hanzi != ''`
    ).bind(userId).all<{ hanzi: string }>();

    if (!notes.results || notes.results.length === 0) {
      return c.json({ message: 'No vocabulary to populate', populated: 0, skipped: 0 });
    }

    // Extract individual characters from all hanzi phrases
    const allChars = new Set<string>();
    for (const note of notes.results) {
      for (const ch of note.hanzi) {
        if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(ch)) {
          allChars.add(ch);
        }
      }
    }

    // Check which ones are already cached
    const charArray = Array.from(allChars);
    const placeholders = charArray.map(() => '?').join(',');
    const existing = await c.env.DB.prepare(
      `SELECT hanzi FROM character_definitions WHERE hanzi IN (${placeholders})`
    ).bind(...charArray).all<{ hanzi: string }>();

    const existingSet = new Set((existing.results || []).map(r => r.hanzi));
    const uncached = charArray.filter(ch => !existingSet.has(ch));

    if (uncached.length === 0) {
      return c.json({ message: 'All characters already cached', populated: 0, skipped: charArray.length });
    }

    // Populate in batches of 10 (to avoid timeout)
    const batchSize = 10;
    const batch = uncached.slice(0, batchSize);
    let populated = 0;

    for (const ch of batch) {
      try {
        await fetchAndCacheDefinition(c.env.DB, ch, undefined, c.env.ANTHROPIC_API_KEY);
        populated++;
      } catch (e) {
        console.error(`Failed to populate definition for ${ch}:`, e);
      }
    }

    return c.json({
      message: `Populated ${populated} definitions`,
      populated,
      skipped: existingSet.size,
      remaining: uncached.length - populated,
      total: charArray.length,
    });
  } catch (error) {
    console.error('Populate vocabulary error:', error);
    const errMsg = error instanceof Error ? error.message : 'Failed to populate vocabulary';
    return c.json({ error: errMsg }, 500);
  }
});

// Convert arbitrary text into a flashcard (for Ask Claude messages)
app.post('/api/text-to-flashcard', async (c) => {
  const userId = c.get('user').id;
  const { text } = await c.req.json<{ text: string }>();

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI is not configured' }, 500);
  }

  if (!text || text.trim() === '') {
    return c.json({ error: 'Text is required' }, 400);
  }

  try {
    const prompt = `You are a Mandarin Chinese language expert. A student typed this message while studying Chinese:

"${text}"

Create a flashcard that helps them learn the Chinese way to express this. If the text is already in Chinese, use it directly. If it's in English or a question about Chinese, create a flashcard for the key Chinese word/phrase they should learn.

IMPORTANT: Use tone marks for pinyin (nǐ hǎo) NOT tone numbers (ni3 hao3).

Respond with ONLY a JSON object in this exact format:
{
  "hanzi": "The Chinese word or phrase",
  "pinyin": "pīnyīn with tone marks",
  "english": "English definition",
  "fun_facts": "A helpful tip about this word"
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': c.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.statusText}`);
    }

    const data = await response.json<any>();
    const aiText = data.content[0].text;
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to parse AI response');
    }

    const result = JSON.parse(jsonMatch[0]);
    return c.json(result);
  } catch (error) {
    console.error('Text to flashcard error:', error);
    const errMsg = error instanceof Error ? error.message : 'Failed to create flashcard';
    return c.json({ error: errMsg }, 500);
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

// Get progress for a specific shared deck (tutor view)
app.get('/api/relationships/:relId/shared-decks/:sharedDeckId/progress', async (c) => {
  const userId = c.get('user').id;
  const relId = c.req.param('relId');
  const sharedDeckId = c.req.param('sharedDeckId');

  try {
    const progress = await getSharedDeckProgress(c.env.DB, relId, sharedDeckId, userId);
    return c.json(progress);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get shared deck progress';
    return c.json({ error: message }, 400);
  }
});

// ============ Student Deck Sharing (student shares deck with tutor) ============

// Student shares their deck with tutor (grants view access, no copy)
app.post('/api/relationships/:relId/student-share-deck', async (c) => {
  const userId = c.get('user').id;
  const relId = c.req.param('relId');
  const { deck_id } = await c.req.json<StudentShareDeckRequest>();

  if (!deck_id) {
    return c.json({ error: 'deck_id is required' }, 400);
  }

  try {
    const shared = await studentShareDeck(c.env.DB, relId, userId, deck_id);
    return c.json(shared, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to share deck';
    return c.json({ error: message }, 400);
  }
});

// Get student-shared decks for a relationship
app.get('/api/relationships/:relId/student-shared-decks', async (c) => {
  const userId = c.get('user').id;
  const relId = c.req.param('relId');

  try {
    const sharedDecks = await getStudentSharedDecks(c.env.DB, relId, userId);
    return c.json(sharedDecks);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get student shared decks';
    return c.json({ error: message }, 400);
  }
});

// Unshare a student deck
app.delete('/api/relationships/:relId/student-shared-decks/:deckId', async (c) => {
  const userId = c.get('user').id;
  const relId = c.req.param('relId');
  const deckId = c.req.param('deckId');

  try {
    await unshareStudentDeck(c.env.DB, relId, userId, deckId);
    return c.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to unshare deck';
    return c.json({ error: message }, 400);
  }
});

// Get progress for a student-shared deck (tutor view)
app.get('/api/relationships/:relId/student-shared-decks/:studentSharedDeckId/progress', async (c) => {
  const userId = c.get('user').id;
  const relId = c.req.param('relId');
  const studentSharedDeckId = c.req.param('studentSharedDeckId');

  try {
    const progress = await getStudentSharedDeckProgress(c.env.DB, relId, studentSharedDeckId, userId);
    return c.json(progress);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get student shared deck progress';
    return c.json({ error: message }, 400);
  }
});

// Get which tutors a deck has been shared with (for DeckDetailPage)
app.get('/api/decks/:deckId/tutor-shares', async (c) => {
  const userId = c.get('user').id;
  const deckId = c.req.param('deckId');

  try {
    const shares = await getDeckTutorShares(c.env.DB, deckId, userId);
    return c.json(shares);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get deck tutor shares';
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

    // Notify the tutor about the flagged card
    const studentName = request.student.name || 'Your student';
    const noteHanzi = request.note.hanzi;
    const notifMessage = `${studentName} flagged 「${noteHanzi}」 for review: ${request.message}`;
    c.executionCtx.waitUntil(
      db.createNotification(
        c.env.DB,
        request.tutor_id,
        'tutor_review_flagged',
        'New card flagged for review',
        notifMessage,
        null,
        { note_id: request.note_id, relationship_id: request.relationship_id },
      ).catch(err => console.error('[Notifications] Failed to create tutor review notification:', err))
    );
    c.executionCtx.waitUntil(
      notifyTutorReviewFlagged(c.env.NTFY_TOPIC, studentName, noteHanzi, request.message)
    );

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

// ============ Data Export ============

app.get('/api/export', async (c) => {
  const user = c.get('user');
  const userId = user.id;

  try {
    // Query all user data in parallel
    const [decksResult, notesResult, cardsResult, reviewEventsResult] = await Promise.all([
      c.env.DB.prepare(
        'SELECT id, name, description, new_cards_per_day, created_at, updated_at FROM decks WHERE user_id = ? ORDER BY created_at'
      ).bind(userId).all(),
      c.env.DB.prepare(
        `SELECT n.id, n.deck_id, n.hanzi, n.pinyin, n.english, n.fun_facts, n.audio_url, n.created_at, n.updated_at
         FROM notes n
         JOIN decks d ON n.deck_id = d.id
         WHERE d.user_id = ?
         ORDER BY n.created_at`
      ).bind(userId).all(),
      c.env.DB.prepare(
        `SELECT c.id, c.note_id, c.card_type, c.queue, c.stability, c.difficulty, c.lapses,
                c.ease_factor, c.interval, c.repetitions, c.next_review_at, c.created_at, c.updated_at
         FROM cards c
         JOIN notes n ON c.note_id = n.id
         JOIN decks d ON n.deck_id = d.id
         WHERE d.user_id = ?
         ORDER BY c.created_at`
      ).bind(userId).all(),
      c.env.DB.prepare(
        `SELECT re.id, re.card_id, re.rating, re.time_spent_ms, re.user_answer,
                re.recording_url, re.reviewed_at, re.created_at
         FROM review_events re
         WHERE re.user_id = ?
         ORDER BY re.reviewed_at`
      ).bind(userId).all(),
    ]);

    const exportData = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      decks: decksResult.results,
      notes: notesResult.results,
      cards: cardsResult.results,
      review_events: reviewEventsResult.results,
    };

    const today = new Date().toISOString().slice(0, 10);
    return new Response(JSON.stringify(exportData, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="chinese-learning-backup-${today}.json"`,
      },
    });
  } catch (error) {
    console.error('Export failed:', error);
    return c.json({ error: 'Failed to export data' }, 500);
  }
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

  // Verify which cards belong to this user
  const cardIds = [...new Set(events.map(e => e.card_id))];
  const verificationPromises = cardIds.map(cardId =>
    db.getCardById(c.env.DB, cardId, userId)
  );
  const cards = await Promise.all(verificationPromises);

  // Build set of valid card IDs (cards that exist and belong to user)
  const validCardIds = new Set<string>();
  cardIds.forEach((cardId, index) => {
    if (cards[index]) {
      validCardIds.add(cardId);
    }
  });

  // Filter events to only include valid cards, skip orphaned events
  const validEvents = events.filter(e => validCardIds.has(e.card_id));
  const skippedOrphans = events.length - validEvents.length;

  if (skippedOrphans > 0) {
    console.log(`[API reviews] Skipping ${skippedOrphans} events for deleted/missing cards`);
  }

  // Create events with user_id added
  const eventsWithUser = validEvents.map(e => ({
    ...e,
    user_id: userId,
  }));

  const result = eventsWithUser.length > 0
    ? await db.createReviewEventsBatch(c.env.DB, eventsWithUser)
    : { created: 0, skipped: 0 };

  // Update sync metadata with the latest event timestamp
  if (events.length > 0) {
    const latestEvent = events.reduce((latest, e) =>
      e.reviewed_at > latest.reviewed_at ? e : latest
    );
    await db.updateSyncMetadata(c.env.DB, userId, latestEvent.reviewed_at);
  }

  // Recompute card state for all affected cards
  // This ensures the cards table reflects the latest state after sync
  if (result.created > 0) {
    const affectedCardIds = [...new Set(validEvents.map(e => e.card_id))];
    console.log(`[API reviews] Recomputing state for ${affectedCardIds.length} cards`);

    for (const cardId of affectedCardIds) {
      try {
        // Get all review events for this card
        const cardEvents = await db.getCardReviewEvents(c.env.DB, cardId, userId);

        // Convert to scheduler format
        const schedulerEvents: SchedulerReviewEvent[] = cardEvents.map(e => ({
          id: e.id,
          card_id: e.card_id,
          rating: e.rating as 0 | 1 | 2 | 3,
          reviewed_at: e.reviewed_at,
        }));

        // Compute new state from all events
        const newState = computeCardState(schedulerEvents, FSRS_DEFAULT_SETTINGS);

        // Update the card with the computed state
        // Note: The cards table has legacy columns (ease_factor, interval, repetitions)
        // but not all FSRS columns (scheduled_days, reps). Map accordingly.
        await c.env.DB.prepare(`
          UPDATE cards SET
            queue = ?,
            stability = ?,
            difficulty = ?,
            lapses = ?,
            ease_factor = ?,
            interval = ?,
            repetitions = ?,
            next_review_at = ?,
            due_timestamp = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).bind(
          newState.queue,
          newState.stability,
          newState.difficulty,
          newState.lapses,
          newState.ease_factor,
          newState.interval,        // same as scheduled_days
          newState.repetitions,     // same as reps
          newState.next_review_at,
          newState.due_timestamp,
          cardId
        ).run();
      } catch (err) {
        console.error(`[API reviews] Failed to recompute state for card ${cardId}:`, err);
        // Continue with other cards even if one fails
      }
    }
  }

  // Return result including skipped orphans so client can mark all events as synced
  return c.json({
    ...result,
    skipped_orphans: skippedOrphans,
  });
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

// Recompute all card states from review events (for fixing stale card data)
app.post('/api/cards/recompute-states', async (c) => {
  const userId = c.get('user').id;

  // Get all cards belonging to this user that have review events
  const cardsWithEvents = await c.env.DB.prepare(`
    SELECT DISTINCT c.id
    FROM cards c
    JOIN notes n ON c.note_id = n.id
    JOIN decks d ON n.deck_id = d.id
    WHERE d.user_id = ?
    AND EXISTS (SELECT 1 FROM review_events re WHERE re.card_id = c.id AND re.user_id = ?)
  `).bind(userId, userId).all<{ id: string }>();

  const cardIds = cardsWithEvents.results.map(c => c.id);
  console.log(`[API recompute-states] Recomputing state for ${cardIds.length} cards for user ${userId}`);

  let updated = 0;
  let errors = 0;

  for (const cardId of cardIds) {
    try {
      // Get all review events for this card
      const cardEvents = await db.getCardReviewEvents(c.env.DB, cardId, userId);

      if (cardEvents.length === 0) continue;

      // Convert to scheduler format
      const schedulerEvents: SchedulerReviewEvent[] = cardEvents.map(e => ({
        id: e.id,
        card_id: e.card_id,
        rating: e.rating as 0 | 1 | 2 | 3,
        reviewed_at: e.reviewed_at,
      }));

      // Compute new state from all events
      const newState = computeCardState(schedulerEvents, FSRS_DEFAULT_SETTINGS);

      // Update the card with the computed state
      // Note: The cards table has legacy columns (ease_factor, interval, repetitions)
      // but not all FSRS columns (scheduled_days, reps). Map accordingly.
      await c.env.DB.prepare(`
        UPDATE cards SET
          queue = ?,
          stability = ?,
          difficulty = ?,
          lapses = ?,
          ease_factor = ?,
          interval = ?,
          repetitions = ?,
          next_review_at = ?,
          due_timestamp = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).bind(
        newState.queue,
        newState.stability,
        newState.difficulty,
        newState.lapses,
        newState.ease_factor,
        newState.interval,        // same as scheduled_days
        newState.repetitions,     // same as reps
        newState.next_review_at,
        newState.due_timestamp,
        cardId
      ).run();

      updated++;
    } catch (err) {
      console.error(`[API recompute-states] Failed to recompute state for card ${cardId}:`, err);
      errors++;
    }
  }

  return c.json({
    total_cards: cardIds.length,
    updated,
    errors,
  });
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

  // Convert to SQLite datetime format (YYYY-MM-DD HH:MM:SS) to match datetime('now') values
  const sinceDate = new Date(since).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
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

// ============ Feature Requests ============

// List feature requests (own for regular users, all for admins)
app.get('/api/feature-requests', async (c) => {
  const user = c.get('user');
  const status = c.req.query('status');
  const all = c.req.query('all') === 'true' && user.is_admin;

  let query: string;
  const params: unknown[] = [];

  if (all) {
    query = `
      SELECT fr.*, u.name as user_name, u.email as user_email,
        (SELECT COUNT(*) FROM feature_request_comments WHERE request_id = fr.id) as comment_count
      FROM feature_requests fr
      JOIN users u ON fr.user_id = u.id
      ${status ? 'WHERE fr.status = ?' : ''}
      ORDER BY fr.created_at DESC
    `;
    if (status) params.push(status);
  } else {
    query = `
      SELECT fr.*,
        (SELECT COUNT(*) FROM feature_request_comments WHERE request_id = fr.id) as comment_count
      FROM feature_requests fr
      WHERE fr.user_id = ?
      ${status ? 'AND fr.status = ?' : ''}
      ORDER BY fr.created_at DESC
    `;
    params.push(user.id);
    if (status) params.push(status);
  }

  const results = await c.env.DB.prepare(query).bind(...params).all();
  return c.json({ requests: results.results || [] });
});

// Upload a screenshot for a feature request
app.post('/api/feature-requests/screenshot', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const formData = await c.req.formData();
  const file = formData.get('file') as unknown;

  if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
    return c.json({ error: 'file is required' }, 400);
  }

  const blob = file as Blob;
  const screenshotId = crypto.randomUUID();
  const key = `screenshots/${user.id}/${screenshotId}.png`;
  const arrayBuffer = await blob.arrayBuffer();
  await storeAudio(c.env.AUDIO_BUCKET, key, arrayBuffer, blob.type || 'image/png');

  return c.json({ key, url: `/api/feature-requests/screenshot/${key}` }, 201);
});

// Serve a feature request screenshot
app.get('/api/feature-requests/screenshot/*', async (c) => {
  const key = c.req.path.replace('/api/feature-requests/screenshot/', '');
  const object = await getAudio(c.env.AUDIO_BUCKET, key);

  if (!object) {
    return c.json({ error: 'Screenshot not found' }, 404);
  }

  const origin = c.req.header('Origin') || '*';

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/png');
  headers.set('Cache-Control', 'public, max-age=31536000');
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Credentials', 'true');

  return new Response(object.body, { headers });
});

// Create a feature request
app.post('/api/feature-requests', async (c) => {
  const { content, pageContext, consoleLogs, screenshotUrl } = await c.req.json<{
    content: string;
    pageContext?: string;
    consoleLogs?: string;
    screenshotUrl?: string;
  }>();

  if (!content || !content.trim()) {
    return c.json({ error: 'Content is required' }, 400);
  }

  const user = c.get('user');
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const approvalStatus = user.is_admin ? 'approved' : 'pending';

  await c.env.DB.prepare(`
    INSERT INTO feature_requests (id, user_id, content, page_context, console_logs, screenshot_url, status, approval_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)
  `).bind(id, user.id, content.trim(), pageContext || null, consoleLogs || null, screenshotUrl || null, approvalStatus, now, now).run();

  return c.json({ id, status: 'new', approval_status: approvalStatus, created_at: now });
});

// Get count of pending feature requests (admin only)
app.get('/api/feature-requests/pending-count', async (c) => {
  const user = c.get('user');
  if (!user.is_admin) {
    return c.json({ count: 0 });
  }

  const result = await c.env.DB.prepare(
    "SELECT COUNT(*) as count FROM feature_requests WHERE approval_status = 'pending'"
  ).first<{ count: number }>();

  return c.json({ count: result?.count || 0 });
});

// Get a single feature request with comments
app.get('/api/feature-requests/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');

  const request = await c.env.DB.prepare(`
    SELECT fr.*, u.name as user_name
    FROM feature_requests fr
    JOIN users u ON fr.user_id = u.id
    WHERE fr.id = ?
  `).bind(id).first();

  if (!request) {
    return c.json({ error: 'Not found' }, 404);
  }

  // Only allow owner or admin to view
  if (request.user_id !== user.id && !user.is_admin) {
    return c.json({ error: 'Access denied' }, 403);
  }

  const comments = await c.env.DB.prepare(`
    SELECT * FROM feature_request_comments
    WHERE request_id = ?
    ORDER BY created_at ASC
  `).bind(id).all();

  return c.json({ request, comments: comments.results || [] });
});

// Update feature request status (admin only)
app.patch('/api/feature-requests/:id', async (c) => {
  const user = c.get('user');
  if (!user.is_admin) {
    return c.json({ error: 'Admin only' }, 403);
  }

  const id = c.req.param('id');
  const { status } = await c.req.json<{ status: string }>();

  const validStatuses = ['new', 'in_progress', 'done', 'declined'];
  if (!validStatuses.includes(status)) {
    return c.json({ error: `Invalid status. Valid: ${validStatuses.join(', ')}` }, 400);
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(`
    UPDATE feature_requests SET status = ?, updated_at = ? WHERE id = ?
  `).bind(status, now, id).run();

  return c.json({ success: true, status });
});

// Approve or decline a feature request (admin only)
app.patch('/api/feature-requests/:id/approval', async (c) => {
  const user = c.get('user');
  if (!user.is_admin) {
    return c.json({ error: 'Admin only' }, 403);
  }

  const id = c.req.param('id');
  const { approval_status } = await c.req.json<{ approval_status: string }>();

  if (!['approved', 'declined'].includes(approval_status)) {
    return c.json({ error: 'Invalid approval_status. Valid: approved, declined' }, 400);
  }

  const now = new Date().toISOString();
  await c.env.DB.prepare(`
    UPDATE feature_requests SET approval_status = ?, updated_at = ? WHERE id = ?
  `).bind(approval_status, now, id).run();

  return c.json({ success: true, approval_status });
});

// Add comment to a feature request
app.post('/api/feature-requests/:id/comments', async (c) => {
  const user = c.get('user');
  const requestId = c.req.param('id');
  const { content, authorName } = await c.req.json<{
    content: string;
    authorName?: string;
  }>();

  if (!content || !content.trim()) {
    return c.json({ error: 'Content is required' }, 400);
  }

  // Verify request exists and user has access
  const request = await c.env.DB.prepare(
    'SELECT * FROM feature_requests WHERE id = ?'
  ).bind(requestId).first();

  if (!request) {
    return c.json({ error: 'Not found' }, 404);
  }

  if (request.user_id !== user.id && !user.is_admin) {
    return c.json({ error: 'Access denied' }, 403);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const name = authorName || user.name || 'User';
  const authorType = user.is_admin ? 'admin' : 'user';

  await c.env.DB.prepare(`
    INSERT INTO feature_request_comments (id, request_id, author_name, author_type, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, requestId, name, authorType, content.trim(), now).run();

  return c.json({ id, created_at: now });
});

// Serve static files (frontend) for non-API routes
app.get('*', async (c) => {
  // In production, this would serve from c.env.ASSETS
  // For development, the frontend runs separately on port 3000
  return c.text('API server running. Frontend served separately in development.', 200);
});

// Export worker with fetch and queue handlers
export default {
  fetch: app.fetch,

  // Queue handler for background processing (story and image generation)
  async queue(batch: MessageBatch<StoryGenerationMessage | ImageGenerationMessage>, env: Env): Promise<void> {
    const queueName = batch.queue;
    console.log('[Queue] Processing batch from queue:', queueName, 'with', batch.messages.length, 'messages');

    if (queueName === 'story-generation-queue') {
      // Handle story generation
      for (const message of batch.messages) {
        const { readerId, vocabulary, topic, difficulty } = message.body as StoryGenerationMessage;
        console.log('[Queue] Processing story generation for reader:', readerId);

        try {
          // Generate the story using Claude with tool use
          const story = await generateStory(
            env.ANTHROPIC_API_KEY,
            vocabulary,
            topic,
            difficulty
          );

          console.log('[Queue] Story generated:', story.title_english, 'with', story.pages.length, 'pages');

          // Update reader title now that we have the real title
          await env.DB.prepare(`
            UPDATE graded_readers SET title_chinese = ?, title_english = ? WHERE id = ?
          `).bind(story.title_chinese, story.title_english, readerId).run();

          // Add pages to the reader
          const pages = await db.addReaderPages(env.DB, readerId, story.pages.map(page => ({
            content_chinese: page.content_chinese,
            content_pinyin: page.content_pinyin,
            content_english: page.content_english,
            image_url: null,
            image_prompt: page.image_prompt,
          })));

          console.log('[Queue] Pages added:', pages.length);

          // Queue image generation for each page
          if (env.GEMINI_API_KEY && env.IMAGE_QUEUE) {
            const pagesWithPrompts = pages.filter(p => p.image_prompt);
            console.log('[Queue] Queueing', pagesWithPrompts.length, 'images for generation');

            const imageMessages = pagesWithPrompts.map(page => ({
              body: {
                readerId: readerId,
                pageId: page.id,
                imagePrompt: page.image_prompt!,
                totalPages: pagesWithPrompts.length,
              }
            }));
            await env.IMAGE_QUEUE.sendBatch(imageMessages);
            console.log('[Queue] Image generation queued for reader:', readerId);
          } else {
            // No image generation configured, mark as ready immediately
            await db.updateReaderStatus(env.DB, readerId, 'ready');
            console.log('[Queue] Reader ready (no image generation):', readerId);
          }

          message.ack();
        } catch (err) {
          console.error('[Queue] Story generation failed for reader:', readerId, err);
          // Mark as failed and don't retry (story generation is expensive)
          await db.updateReaderStatus(env.DB, readerId, 'failed');
          message.ack(); // Don't retry, mark as failed instead
        }
      }
    } else if (queueName === 'image-generation-queue') {
      // Handle image generation
      for (const message of batch.messages) {
        const { readerId, pageId, imagePrompt } = message.body as ImageGenerationMessage;
        console.log('[Queue] Processing image for page:', pageId, 'reader:', readerId);

        try {
          // Generate the image
          const imageUrl = await generatePageImage(
            env.GEMINI_API_KEY,
            imagePrompt,
            pageId,
            env.AUDIO_BUCKET
          );

          if (imageUrl) {
            // Update the page with the image URL
            await db.updateReaderPageImage(env.DB, pageId, imageUrl);
            console.log('[Queue] Image generated for page:', pageId);
          } else {
            console.error('[Queue] Image generation returned null for page:', pageId);
          }

          // Check if all images are done for this reader
          const reader = await db.getGradedReaderById(env.DB, readerId);
          if (reader) {
            const pagesWithImages = reader.pages.filter(p => p.image_url).length;
            const pagesNeedingImages = reader.pages.filter(p => p.image_prompt).length;

            console.log('[Queue] Progress for reader', readerId, ':', pagesWithImages, '/', pagesNeedingImages);

            if (pagesWithImages >= pagesNeedingImages) {
              // All images done, mark reader as ready
              await db.updateReaderStatus(env.DB, readerId, 'ready');
              console.log('[Queue] Reader ready:', readerId);
            }
          }

          message.ack();
        } catch (err) {
          console.error('[Queue] Image generation failed for page:', pageId, err);
          // Retry the message
          message.retry();
        }
      }
    } else {
      console.error('[Queue] Unknown queue:', queueName);
      // Ack all messages to avoid infinite retries
      for (const message of batch.messages) {
        message.ack();
      }
    }
  },
};
