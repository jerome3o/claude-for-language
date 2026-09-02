import { Hono } from 'hono';
import { cors } from 'hono/cors';
import Anthropic from '@anthropic-ai/sdk';
import { Env, Rating, User, CardQueue, SentenceBriefExplanation, SentenceSetMessage, QuestGenerationMessage, CreateConversationRequest, CLAUDE_AI_USER_ID, AIRespondResponse, ConversationTTSRequest, ConversationTTSResponse, CheckMessageResponse, GenerateReaderRequest, DifficultyLevel, ImageGenerationMessage, CustomLessonImageMessage, StoryGenerationMessage, VocabularyItem } from './types';
import * as db from './db/queries';
import { calculateSM2 } from './services/sm2';
import {
  scheduleCard,
  getIntervalPreview,
  DEFAULT_DECK_SETTINGS,
  parseLearningSteps,
} from './services/anki-scheduler';
import { generateDeck, suggestCards, askAboutNoteWithTools, coachChatWithTools, generateAIConversationResponse, generateAIConversationOpener, checkUserMessage, generateIDontKnowOptions, discussMessage } from './services/ai';
import type { ToolAction, CoachChatTurn } from './services/ai';
import { analyzeSentence } from './services/sentence';
import { coachSentence } from './services/sentence-coach';
import { explainSentence } from './services/sentence-explain';
import { translateSentence } from './services/sentence-translate';
import { generateSentenceSet } from './services/sentence-set';
import { generateQuestWorld } from './services/quest';
import type { QuestDifficulty } from './services/quest';
import type { QuestWorld } from '@shared/quest';
import { explainSentenceBriefly } from './services/sentence-explain-brief';
import { generatePracticeSession } from './services/practice';
import type { PracticeSessionContent, GrammarPoint } from './services/practice';
import { generateStory, generatePageImage, getDailyStoryLens } from './services/graded-reader';
import { createCustomLessonFromSpec } from './services/custom-lesson';
import { storeAudio, getAudio, deleteAudio, getRecordingKey, generateTTS, generateConversationTTS, bytesToBase64, parseByteRange, resolveServedRange, classifyMp3, DEFAULT_TTS_SPEED, DEFAULT_MINIMAX_VOICE } from './services/audio';
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
import { notifyNewUser, notifyNewChatMessage } from './services/notifications';
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
import { getSharedDeckProgress, getStudentSharedDeckProgress, getOwnDeckProgress } from './services/shared-deck-progress';
import { CreateRelationshipRequest, SendMessageRequest, ShareDeckRequest, StudentShareDeckRequest, GenerateFlashcardRequest } from './types';
import {
  computeCardState,
  initialCardState,
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

  // Start the sentence set now so the card already has one by the time it
  // comes up in study.
  c.executionCtx.waitUntil(enqueueSentenceSet(c.env, note.id));

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
  const before = await db.getNoteById(c.env.DB, id, userId);
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
    alternatives?: string | null;
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
    alternatives: updates.alternatives,
  });

  if (!note) {
    return c.json({ error: 'Note not found' }, 404);
  }

  // A changed example sentence needs new audio: the old clip is of the old
  // sentence, and an edit that adds a clue for the first time has none at all.
  // Skipped when the caller supplied the audio itself.
  const clueChanged =
    updates.sentence_clue_audio_url === undefined &&
    !!note.sentence_clue &&
    note.sentence_clue !== before?.sentence_clue;
  if (clueChanged || (note.sentence_clue && !note.sentence_clue_audio_url)) {
    c.executionCtx.waitUntil(
      ensureSentenceClueAudio(c.env, note.id, { force: clueChanged })
    );
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
              // A clue Claude just wrote has no audio yet — give it one.
              if (updates.sentenceClue) {
                c.executionCtx.waitUntil(
                  ensureSentenceClueAudio(c.env, id, { force: true })
                );
              }
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

          case 'create_custom_lesson': {
            const result = await createCustomLessonFromSpec(c.env, userId, action.input, 'chat');
            if (result.ok) {
              toolResults.push({
                tool: 'create_custom_lesson',
                success: true,
                data: {
                  lesson_id: result.lesson.id,
                  title: result.lesson.title,
                  image_jobs: result.imageJobs,
                },
              });
            } else {
              toolResults.push({
                tool: 'create_custom_lesson',
                success: false,
                error: `Invalid lesson spec: ${result.errors.join('; ')}`,
              });
            }
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
      // The note's example sentence needs audio too — this is the path the MCP
      // add_note tools call, and they save a clue without ever generating one.
      c.executionCtx.waitUntil(ensureSentenceClueAudio(c.env, note.id));
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

    const result = await generateTTS(c.env, note.hanzi, note.id, { preferProvider: 'minimax' });
    if (result) {
      await db.updateNote(c.env.DB, note.id, { audioUrl: result.audioKey, audioProvider: result.provider });
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
    let sentenceClueAudioProvider: 'minimax' | 'gtts' | undefined;
    if (c.env.GOOGLE_TTS_API_KEY || c.env.MINIMAX_API_KEY) {
      try {
        const audioResult = await generateTTS(c.env, sentenceClue, `${id}-sentence`);
        if (audioResult) {
          sentenceClueAudioUrl = audioResult.audioKey;
          sentenceClueAudioProvider = audioResult.provider;
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
      sentenceClueAudioProvider,
    });

    const updatedNote = await db.getNoteById(c.env.DB, id, userId);
    return c.json(updatedNote);
  } catch (error) {
    console.error('Sentence clue generation error:', error);
    return c.json({ error: 'Failed to generate sentence clue' }, 500);
  }
});

// ============ Sentence sets (a graded list of examples per note) ============

/**
 * Queue a note for background sentence-set generation.
 * Best-effort: a failure here just means the set gets made on demand instead.
 */
async function enqueueSentenceSet(env: Env, noteId: string, count?: number): Promise<void> {
  try {
    // Send first, mark second: a job marked 'queued' is skipped by future
    // sweeps, so marking a send that never happened would starve the note.
    await env.SENTENCE_SET_QUEUE.send({ noteId, count });
    await db.markSentenceSetJobQueued(env.DB, noteId);
  } catch (error) {
    console.error('[sentence-set] Failed to enqueue note', noteId, error);
  }
}

/**
 * Give a note's own example sentence its audio.
 *
 * The clue is written by several paths that don't generate TTS (the MCP
 * add_note tools, a plain note edit, Claude's edit_note), which leaves the ▶
 * next to that sentence with nothing to play. Best-effort: returns whether it
 * stored anything.
 */
async function ensureSentenceClueAudio(
  env: Env,
  noteId: string,
  options: { force?: boolean } = {}
): Promise<boolean> {
  if (!env.GOOGLE_TTS_API_KEY && !env.MINIMAX_API_KEY) return false;

  try {
    const note = await db.getNoteByIdUnscoped(env.DB, noteId);
    if (!note?.sentence_clue) return false;
    if (note.sentence_clue_audio_url && !options.force) return false;

    const result = await generateTTS(env, note.sentence_clue, `${noteId}-sentence`);
    if (!result) return false;

    await db.updateNote(env.DB, noteId, {
      sentenceClueAudioUrl: result.audioKey,
      sentenceClueAudioProvider: result.provider,
    });
    // Only once the replacement is stored and pointed at — a failed
    // regeneration must leave the old clip playable.
    if (options.force && note.sentence_clue_audio_url) {
      await deleteAudio(env.AUDIO_BUCKET, note.sentence_clue_audio_url).catch(() => {});
    }
    return true;
  } catch (error) {
    console.error('[clue-audio] Failed for note', noteId, error);
    return false;
  }
}

/** Queue a note for background clue-audio generation. Best-effort. */
async function enqueueClueAudio(env: Env, noteId: string): Promise<void> {
  try {
    await env.SENTENCE_SET_QUEUE.send({ noteId, kind: 'clue_audio' });
  } catch (error) {
    console.error('[clue-audio] Failed to enqueue note', noteId, error);
  }
}

/** Generate TTS for a list of sentences, a few at a time, and store the keys. */
async function attachSentenceSetAudio(
  env: Env,
  sentences: Array<{ id: string; hanzi: string }>
): Promise<Map<string, string>> {
  const audioByIdMap = new Map<string, string>();
  if (!env.GOOGLE_TTS_API_KEY && !env.MINIMAX_API_KEY) return audioByIdMap;

  const CONCURRENCY = 4;
  let next = 0;
  const worker = async () => {
    while (next < sentences.length) {
      const sentence = sentences[next++];
      try {
        const result = await generateTTS(env, sentence.hanzi, `${sentence.id}-sentence`);
        if (result) {
          await db.setNoteSentenceAudio(env.DB, sentence.id, result.audioKey, result.provider);
          audioByIdMap.set(sentence.id, result.audioKey);
        }
      } catch (error) {
        console.error('[sentence-set] TTS failed for', sentence.id, error);
        // Sentence stays usable without audio; the next generate can retry.
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, sentences.length) }, worker));
  return audioByIdMap;
}

// List a note's sentence set
app.get('/api/notes/:id/sentences', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');

  const note = await db.getNoteById(c.env.DB, id, userId);
  if (!note) return c.json({ error: 'Note not found' }, 404);

  const sentences = await db.getNoteSentences(c.env.DB, id);
  return c.json({ sentences });
});

// Generate (or regenerate) a whole sentence set for a note
app.post('/api/notes/:id/sentences/generate', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');

  const note = await db.getNoteById(c.env.DB, id, userId);
  if (!note) return c.json({ error: 'Note not found' }, 404);

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI service is not configured' }, 500);
  }

  let count: number | undefined;
  let customPrompt: string | null = null;
  let keepExisting = false;
  try {
    const body = await c.req.json<{ count?: number; customPrompt?: string; keepExisting?: boolean }>();
    count = body?.count;
    customPrompt = body?.customPrompt?.trim() || null;
    keepExisting = body?.keepExisting === true;
  } catch {
    // No body — use defaults
  }

  try {
    const existingRows = await db.getNoteSentences(c.env.DB, id);
    // The note's inline sentence clue counts as "already seen" so the set
    // doesn't just repeat it back.
    const seen = [
      ...(note.sentence_clue ? [note.sentence_clue] : []),
      ...existingRows.map((s) => s.hanzi),
    ];

    const userRow = await c.env.DB.prepare('SELECT bio FROM users WHERE id = ?')
      .bind(userId)
      .first<{ bio: string | null }>();

    const generated = await generateSentenceSet(
      c.env.ANTHROPIC_API_KEY,
      {
        hanzi: note.hanzi,
        pinyin: note.pinyin,
        english: note.english,
        existing: seen,
        bio: userRow?.bio ?? null,
        customPrompt,
      },
      count
    );

    // "Keep existing" appends the new batch after what's already there; the
    // default replaces the set so difficulty stays monotonic across it.
    const kept = keepExisting
      ? existingRows.map((s) => ({
          hanzi: s.hanzi,
          pinyin: s.pinyin,
          translation: s.translation,
          audioUrl: s.audio_url,
          focus: s.focus,
          focusNote: s.focus_note,
        }))
      : [];

    const stored = await db.replaceNoteSentences(c.env.DB, id, [
      ...kept,
      ...generated.map((s) => ({
        hanzi: s.hanzi,
        pinyin: s.pinyin,
        translation: s.translation,
        audioUrl: null,
        focus: s.focus,
        focusNote: s.focusNote,
      })),
    ]);

    const needAudio = stored.filter((s) => !s.audio_url);
    const audioById = await attachSentenceSetAudio(c.env, needAudio);

    const sentences = stored.map((s) => ({
      ...s,
      audio_url: s.audio_url ?? audioById.get(s.id) ?? null,
    }));

    return c.json({ sentences });
  } catch (error) {
    console.error('Sentence set generation error:', error);
    return c.json({ error: 'Failed to generate sentence set' }, 500);
  }
});

// Delete a note's sentence set
app.delete('/api/notes/:id/sentences', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');

  const note = await db.getNoteById(c.env.DB, id, userId);
  if (!note) return c.json({ error: 'Note not found' }, 404);

  await db.deleteNoteSentences(c.env.DB, id);
  return c.json({ success: true });
});

/**
 * Offline sync: every sentence the user owns that changed since `since`.
 * Sets are always written whole, so the client can safely replace all local
 * rows for each note_id that appears in the response.
 */
app.get('/api/sentences/changes', async (c) => {
  const userId = c.get('user').id;
  const since = c.req.query('since') || null;
  const sentences = await db.getNoteSentencesForUser(c.env.DB, userId, since);
  return c.json({ sentences, server_time: new Date().toISOString() });
});

/**
 * Coverage overview for the settings screen: how many words have an example
 * sentence, how many have a full generated set, and what the background
 * generation is doing (including the jobs that failed).
 */
app.get('/api/sentences/stats', async (c) => {
  const userId = c.get('user').id;
  const stats = await db.getSentenceCoverageStats(c.env.DB, userId);
  return c.json(stats);
});

/** Default number of card sentences one backfill call gives audio to. */
const CLUE_AUDIO_BATCH = 50;
const CLUE_AUDIO_MAX_BATCH = 250;

/**
 * Backfill audio for card sentences that don't have any.
 *
 * TTS is cheap and quick, but a few hundred clips is more than one request
 * should do, so this queues them one per message and returns immediately —
 * the coverage page watches the number come down.
 */
app.post('/api/sentences/clue-audio', async (c) => {
  const userId = c.get('user').id;

  if (!c.env.GOOGLE_TTS_API_KEY && !c.env.MINIMAX_API_KEY) {
    return c.json({ error: 'TTS is not configured' }, 500);
  }

  let limit = CLUE_AUDIO_BATCH;
  try {
    const body = await c.req.json<{ limit?: number }>();
    if (typeof body?.limit === 'number' && Number.isFinite(body.limit)) {
      limit = Math.min(CLUE_AUDIO_MAX_BATCH, Math.max(1, Math.round(body.limit)));
    }
  } catch {
    // No body — use the default
  }

  const notes = await db.getNotesMissingClueAudio(c.env.DB, userId, limit);
  for (const note of notes) {
    await enqueueClueAudio(c.env, note.id);
  }

  const remaining = await db.countNotesMissingClueAudio(c.env.DB, userId);
  console.log('[clue-audio] Queued', notes.length, 'notes;', remaining, 'still missing audio');
  return c.json({ queued: notes.length, remaining });
});

/** Default number of notes a single prefetch sweep will enqueue. */
const SENTENCE_PREFETCH_BATCH = 20;
const SENTENCE_PREFETCH_MAX_BATCH = 100;

/**
 * Top up the backlog of notes without a sentence set.
 *
 * The client calls this on sync, passing the notes in the current study queue
 * as `note_ids` so what the learner is about to see gets generated first;
 * whatever budget is left goes to the due-soonest notes overall. Bounded per
 * call so a large collection fills in steadily instead of all at once.
 */
app.post('/api/sentences/prefetch', async (c) => {
  const userId = c.get('user').id;

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI service is not configured' }, 500);
  }

  let noteIds: string[] = [];
  let limit = SENTENCE_PREFETCH_BATCH;
  try {
    const body = await c.req.json<{ note_ids?: string[]; limit?: number }>();
    if (Array.isArray(body?.note_ids)) noteIds = body.note_ids.filter((id) => typeof id === 'string');
    if (typeof body?.limit === 'number' && Number.isFinite(body.limit)) {
      limit = Math.min(SENTENCE_PREFETCH_MAX_BATCH, Math.max(1, Math.round(body.limit)));
    }
  } catch {
    // No body — use defaults
  }

  const notes = await db.getNotesNeedingSentenceSets(c.env.DB, userId, limit, noteIds);
  for (const note of notes) {
    await enqueueSentenceSet(c.env, note.id);
  }

  const remaining = await db.countNotesWithoutSentenceSets(c.env.DB, userId);
  console.log('[sentence-set] Prefetch queued', notes.length, 'notes;', remaining, 'still without a set');
  return c.json({ queued: notes.length, remaining });
});

/**
 * The same brief breakdown, for a sentence that isn't a stored set row — the
 * card's own example sentence, which lives on the note rather than in
 * note_sentences. There's no row to cache it on, so the client caches it.
 */
app.post('/api/sentences/explain-text', async (c) => {
  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI service is not configured' }, 500);
  }

  let body: { hanzi?: string; pinyin?: string | null; translation?: string | null };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'hanzi is required' }, 400);
  }

  const hanzi = body?.hanzi?.trim();
  if (!hanzi) {
    return c.json({ error: 'hanzi is required' }, 400);
  }

  try {
    const explanation = await explainSentenceBriefly(c.env.ANTHROPIC_API_KEY, {
      hanzi,
      pinyin: body.pinyin ?? null,
      translation: body.translation ?? null,
    });
    return c.json({ explanation });
  } catch (error) {
    console.error('Sentence text explanation error:', error);
    return c.json({ error: 'Failed to explain sentence' }, 500);
  }
});

/**
 * A brief breakdown of one sentence — what each word is doing and how the
 * sentence is built. Generated on demand with Haiku (this is a mid-study tap,
 * so speed wins), then cached on the row so it is instant and offline after.
 */
app.post('/api/sentences/:id/explain', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');

  const sentence = await db.getNoteSentenceById(c.env.DB, id, userId);
  if (!sentence) {
    return c.json({ error: 'Sentence not found' }, 404);
  }

  if (sentence.explanation) {
    try {
      return c.json({
        explanation: JSON.parse(sentence.explanation) as SentenceBriefExplanation,
        cached: true,
      });
    } catch {
      // Corrupt cache — fall through and regenerate
    }
  }

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI service is not configured' }, 500);
  }

  try {
    const explanation = await explainSentenceBriefly(c.env.ANTHROPIC_API_KEY, {
      hanzi: sentence.hanzi,
      pinyin: sentence.pinyin,
      translation: sentence.translation,
    });
    await db.setNoteSentenceExplanation(
      c.env.DB,
      sentence.id,
      sentence.note_id,
      JSON.stringify(explanation)
    );
    return c.json({ explanation, cached: false });
  } catch (error) {
    console.error('Sentence explanation error:', error);
    return c.json({ error: 'Failed to explain sentence' }, 500);
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

IMPORTANT: Only use characters from modern everyday simplified Chinese. Do NOT use classical, archaic, traditional-only, or rare characters that a modern Mandarin learner would not encounter in daily life or standard courses (HSK 1-6 vocabulary is a good reference). Every alternative must be a character a learner would plausibly see in modern contexts.

Characters to generate alternatives for:
${characters.map((char, i) => `${i + 1}. ${char}`).join('\n')}

The word is "${note.hanzi}" (${note.pinyin}, meaning: ${note.english}).`;

    console.log(`[MC Generation] Starting for note ${id}, hanzi="${note.hanzi}", ${characters.length} characters`);
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
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

    console.log(`[MC Generation] Response stop_reason=${response.stop_reason}, content blocks=${response.content.length}`);

    if (response.stop_reason === 'max_tokens') {
      console.error(`[MC Generation] Response truncated by max_tokens for note ${id}`);
      return c.json({ error: 'Response was truncated - word may be too long' }, 500);
    }

    const toolUseBlock = response.content.find(b => b.type === 'tool_use');
    if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
      console.error(`[MC Generation] No tool_use block in response for note ${id}. Content types: ${response.content.map(b => b.type).join(', ')}`);
      return c.json({ error: 'Failed to generate alternatives' }, 500);
    }

    const input = toolUseBlock.input as { characters: Array<{ correct: string; alternatives: string[] }> };
    console.log(`[MC Generation] Got ${input.characters?.length ?? 0} character alternatives from AI (expected ${characters.length})`);

    // Build options arrays with correct answer shuffled in, deduplicating
    // Re-insert punctuation characters as pass-through (correct only, no alternatives)
    let aiCharIndex = 0;
    const multipleChoiceOptions = allCharacters.map((originalChar) => {
      if (punctuationRegex.test(originalChar)) {
        // Punctuation: no MC options, just the character itself
        return { correct: originalChar, options: [originalChar] };
      }
      const charData = input.characters[aiCharIndex++];
      if (!charData) {
        console.error(`[MC Generation] AI returned fewer characters than expected at index ${aiCharIndex - 1} for note ${id}`);
        // Fallback: just show the correct character
        return { correct: originalChar, options: [originalChar] };
      }
      // Filter out duplicates and the correct character from alternatives
      const seen = new Set<string>([charData.correct]);
      const uniqueAlts: string[] = [];
      for (const alt of (charData.alternatives ?? [])) {
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
    const errMsg = error instanceof Error ? error.message : String(error);
    const errName = error instanceof Error ? error.constructor.name : 'Unknown';
    console.error(`[MC Generation] Error for note ${id}: [${errName}] ${errMsg}`);
    if (error instanceof Error && error.stack) {
      console.error(`[MC Generation] Stack: ${error.stack}`);
    }
    // Pass through a more descriptive error for debugging
    return c.json({ error: `Failed to generate multiple choice options: ${errMsg}` }, 500);
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

        const result = await generateTTS(c.env, note.hanzi, note.id, { preferProvider: 'minimax' });
        if (result) {
          await db.updateNote(c.env.DB, note.id, { audioUrl: result.audioKey, audioProvider: result.provider });
          regenerated++;
          console.log('[Regenerate All] Regenerated', note.hanzi, 'with', result.provider);
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
    secondary_cards_per_day?: number;
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

// All audio URLs the user owns, for offline prefetch. Distinct path so it
// can't collide with the /api/audio/* file-serving wildcard below.
app.get('/api/audio-manifest', async (c) => {
  const userId = c.get('user').id;
  const urls = await db.getAudioManifest(c.env.DB, userId);
  return c.json({ urls });
});

/** Regenerate a note's word audio with MiniMax; keeps the old clip on failure. */
async function regenerateNoteAudio(env: Env, noteId: string): Promise<boolean> {
  const note = await db.getNoteByIdUnscoped(env.DB, noteId);
  if (!note) return false;
  const result = await generateTTS(env, note.hanzi, noteId);
  if (!result || result.provider !== 'minimax') return false;
  await db.updateNote(env.DB, noteId, { audioUrl: result.audioKey, audioProvider: result.provider });
  if (note.audio_url) await deleteAudio(env.AUDIO_BUCKET, note.audio_url).catch(() => {});
  return true;
}

/** Regenerate one sentence-set clip with MiniMax; keeps the old clip on failure. */
async function regenerateSentenceAudio(env: Env, sentenceId: string): Promise<boolean> {
  const sentence = await db.getNoteSentenceByIdUnscoped(env.DB, sentenceId);
  if (!sentence) return false;
  const result = await generateTTS(env, sentence.hanzi, `${sentenceId}-sentence`);
  if (!result || result.provider !== 'minimax') return false;
  await db.setNoteSentenceAudio(env.DB, sentenceId, result.audioKey, result.provider);
  if (sentence.audio_url) await deleteAudio(env.AUDIO_BUCKET, sentence.audio_url).catch(() => {});
  return true;
}

// ============ Audio quality ============
//
// Every clip records which provider made it. The Google fallback produces a
// different voice at half the bitrate with time-stretched slow speech — the
// "crunchy" audio — so these routes exist to count those clips, find the ones
// stored before the provider was recorded, and replace them.

app.get('/api/audio/quality', async (c) => {
  const userId = c.get('user').id;
  const stats = await db.getAudioQualityStats(c.env.DB, userId);
  return c.json(stats);
});

const AUDIO_CLASSIFY_BATCH = 100;
const AUDIO_CLASSIFY_MAX_BATCH = 300;

/**
 * Work out the provider of clips stored before it was recorded, by reading the
 * first frame header of each from R2 (a 2 KB range read, no download). Bounded
 * per call; the client loops until nothing is left.
 */
app.post('/api/audio/classify', async (c) => {
  const userId = c.get('user').id;
  let limit = AUDIO_CLASSIFY_BATCH;
  try {
    const body = await c.req.json<{ limit?: number }>();
    if (typeof body?.limit === 'number' && Number.isFinite(body.limit)) {
      limit = Math.min(AUDIO_CLASSIFY_MAX_BATCH, Math.max(1, Math.round(body.limit)));
    }
  } catch {
    // No body — default batch
  }

  const pending = await db.getUnclassifiedAudio(c.env.DB, userId, limit);
  const classify = async (key: string): Promise<string> => {
    const object = await getAudio(c.env.AUDIO_BUCKET, key, { offset: 0, length: 2048 });
    if (!object) return 'missing';
    return classifyMp3(new Uint8Array(await object.arrayBuffer()));
  };

  let classified = 0;
  let found = 0;
  const jobs: Array<() => Promise<void>> = [
    ...pending.notes.map(n => async () => {
      const provider = await classify(n.audio_url);
      await db.setNoteAudioProvider(c.env.DB, n.id, provider);
      classified++;
      if (provider === 'gtts') found++;
    }),
    ...pending.clues.map(n => async () => {
      const provider = await classify(n.audio_url);
      await db.setClueAudioProvider(c.env.DB, n.id, provider);
      classified++;
      if (provider === 'gtts') found++;
    }),
    ...pending.sentences.map(sn => async () => {
      const provider = await classify(sn.audio_url);
      await db.setSentenceAudioProvider(c.env.DB, sn.id, provider);
      classified++;
      if (provider === 'gtts') found++;
    }),
  ];
  // A few at a time: each is one small R2 read plus one D1 write.
  const CONCURRENCY = 8;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        try {
          await job();
        } catch (error) {
          console.error('[audio-classify] failed', error);
        }
      }
    })
  );

  const remaining = await db.getUnclassifiedAudio(c.env.DB, userId, 1);
  const remainingCount = remaining.notes.length + remaining.clues.length + remaining.sentences.length;
  console.log('[audio-classify] Classified', classified, 'clips,', found, 'from Google fallback');
  return c.json({ classified, found_fallback: found, remaining: remainingCount > 0 });
});

const AUDIO_REGEN_BATCH = 50;
const AUDIO_REGEN_MAX_BATCH = 250;

/** Queue replacement of known Google-fallback clips with MiniMax. */
app.post('/api/audio/regenerate-fallback', async (c) => {
  const userId = c.get('user').id;
  if (!c.env.MINIMAX_API_KEY) {
    return c.json({ error: 'MiniMax is not configured' }, 500);
  }
  let limit = AUDIO_REGEN_BATCH;
  try {
    const body = await c.req.json<{ limit?: number }>();
    if (typeof body?.limit === 'number' && Number.isFinite(body.limit)) {
      limit = Math.min(AUDIO_REGEN_MAX_BATCH, Math.max(1, Math.round(body.limit)));
    }
  } catch {
    // No body — default batch
  }

  const targets = await db.getFallbackAudioTargets(c.env.DB, userId, limit);
  let queued = 0;
  for (const noteId of targets.notes) {
    await c.env.SENTENCE_SET_QUEUE.send({ noteId, kind: 'note_audio' });
    queued++;
  }
  for (const noteId of targets.clues) {
    await c.env.SENTENCE_SET_QUEUE.send({ noteId, kind: 'clue_audio', force: true });
    queued++;
  }
  for (const sentenceId of targets.sentences) {
    // noteId is required by the message shape but unused for this kind.
    await c.env.SENTENCE_SET_QUEUE.send({ noteId: '', kind: 'sentence_audio', sentenceId });
    queued++;
  }

  const stats = await db.getAudioQualityStats(c.env.DB, userId);
  const remaining = stats.notes.gtts + stats.clues.gtts + stats.sentences.gtts;
  console.log('[audio-regen] Queued', queued, 'fallback clips;', remaining, 'still recorded as gtts');
  return c.json({ queued, remaining });
});

app.get('/api/audio/*', async (c) => {
  const key = c.req.path.replace('/api/audio/', '');

  // <audio> streams media with Range requests. Answering every one with the
  // full body (200) forces the element to re-buffer from zero whenever it
  // seeks or recovers from a stall, which on a weak connection sounds like the
  // clip cutting out. Serve real 206 partials instead.
  const rangeHeader = c.req.header('Range');
  const range = parseByteRange(rangeHeader);
  const object = await getAudio(c.env.AUDIO_BUCKET, key, range);

  if (!object) {
    return c.json({ error: 'Audio not found' }, 404);
  }

  // Get origin for CORS
  const origin = c.req.header('Origin') || '*';

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'audio/mpeg');
  headers.set('Cache-Control', 'public, max-age=31536000');
  headers.set('Accept-Ranges', 'bytes');
  if (object.httpEtag) {
    headers.set('ETag', object.httpEtag);
  }
  // Explicit CORS headers for audio element cross-origin playback
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  // Range is not a CORS-safelisted response header, so the media element can
  // only see the partial-content headers if we expose them.
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, ETag');

  const served = range ? resolveServedRange(object.range, object.size) : null;
  if (served && served.length < object.size) {
    const { offset, length } = served;
    headers.set('Content-Length', String(length));
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    return new Response(object.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(object.size));
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
    const base64 = bytesToBase64(new Uint8Array(arrayBuffer));
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

// ============ Sentence Coach (correct & critique) ============

app.post('/api/sentence/coach', async (c) => {
  const { sentence } = await c.req.json<{ sentence: string }>();

  if (!sentence || typeof sentence !== 'string' || !sentence.trim()) {
    return c.json({ error: 'sentence is required' }, 400);
  }

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI coaching is not configured' }, 500);
  }

  try {
    const result = await coachSentence(c.env.ANTHROPIC_API_KEY, sentence.trim());
    return c.json(result);
  } catch (error) {
    console.error('Sentence coach error:', error);
    return c.json({ error: 'Failed to coach sentence' }, 500);
  }
});

// Thorough explanation of a sentence (Sentence Coach "Explain" mode)
app.post('/api/sentence/explain', async (c) => {
  const { sentence } = await c.req.json<{ sentence: string }>();

  if (!sentence || typeof sentence !== 'string' || !sentence.trim()) {
    return c.json({ error: 'sentence is required' }, 400);
  }

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI explanation is not configured' }, 500);
  }

  try {
    const result = await explainSentence(c.env.ANTHROPIC_API_KEY, sentence.trim());
    return c.json(result);
  } catch (error) {
    console.error('Sentence explain error:', error);
    return c.json({ error: 'Failed to explain sentence' }, 500);
  }
});

// ============ Sentence Coach Conversations ============

// Any Han character means the input is (at least partly) Chinese — treat it
// as a sentence to coach/explain. Pure English gets translated instead.
function containsChinese(text: string): boolean {
  return /[㐀-䶿一-鿿豈-﫿]/.test(text);
}

// Start a conversation from a sentence: detect the language, run the right
// analysis, persist the thread. Chinese → coach + explain; English → translate.
app.post('/api/coach/conversations', async (c) => {
  const userId = c.get('user').id;
  const { text } = await c.req.json<{ text: string }>();

  if (!text || typeof text !== 'string' || !text.trim()) {
    return c.json({ error: 'text is required' }, 400);
  }
  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI coaching is not configured' }, 500);
  }

  const input = text.trim();
  const isChinese = containsChinese(input);

  try {
    let analysis: import('./types').CoachAnalysis;
    if (isChinese) {
      // Keep the initial analysis short and fast: just the correction, a brief
      // critique, and a couple of example phrasings. The heavy word-by-word /
      // grammar breakdown (explainSentence) is available on demand via
      // /api/sentence/explain and by asking a follow-up, so we no longer block
      // the first response on it.
      const coach = await coachSentence(c.env.ANTHROPIC_API_KEY, input);
      analysis = { kind: 'chinese', coach };
    } else {
      const translation = await translateSentence(c.env.ANTHROPIC_API_KEY, input);
      analysis = { kind: 'english', translation };
    }

    const conversation = await db.createCoachConversation(
      c.env.DB, userId, input.slice(0, 120), isChinese ? 'zh' : 'en'
    );
    const userMsg = await db.addCoachMessage(c.env.DB, conversation.id, 'user', 'text', input);
    const assistantMsg = await db.addCoachMessage(
      c.env.DB, conversation.id, 'assistant', 'analysis', JSON.stringify(analysis)
    );

    return c.json({ conversation, messages: [userMsg, assistantMsg] });
  } catch (error) {
    console.error('Coach conversation start error:', error);
    return c.json({ error: 'Failed to analyze the sentence' }, 500);
  }
});

app.get('/api/coach/conversations', async (c) => {
  const userId = c.get('user').id;
  const conversations = await db.getCoachConversations(c.env.DB, userId);
  return c.json(conversations);
});

app.get('/api/coach/conversations/:id', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const conversation = await db.getCoachConversation(c.env.DB, id, userId);
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }
  const messages = await db.getCoachMessages(c.env.DB, id);
  return c.json({ conversation, messages });
});

app.delete('/api/coach/conversations/:id', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const deleted = await db.deleteCoachConversation(c.env.DB, id, userId);
  if (!deleted) {
    return c.json({ error: 'Conversation not found' }, 404);
  }
  return c.json({ success: true });
});

// Follow-up message in a coach conversation (agent loop with tools)
app.post('/api/coach/conversations/:id/messages', async (c) => {
  const userId = c.get('user').id;
  const id = c.req.param('id');
  const { message } = await c.req.json<{ message: string }>();

  if (!message || typeof message !== 'string' || !message.trim()) {
    return c.json({ error: 'message is required' }, 400);
  }
  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI coaching is not configured' }, 500);
  }

  const conversation = await db.getCoachConversation(c.env.DB, id, userId);
  if (!conversation) {
    return c.json({ error: 'Conversation not found' }, 404);
  }

  try {
    const stored = await db.getCoachMessages(c.env.DB, id);
    const decks = await db.getAllDecks(c.env.DB, userId);
    const deckList = decks.length > 0
      ? decks.map(d => `${d.name} (id: ${d.id})`).join(', ')
      : 'none';

    // Rebuild the model conversation: context header on the first user turn,
    // the stored analysis JSON as the first assistant turn, then follow-ups.
    const history: CoachChatTurn[] = [];
    for (const m of stored) {
      if (m.role === 'user' && history.length === 0) {
        history.push({
          role: 'user',
          content: [
            `The user's decks: ${deckList}`,
            '',
            `The user submitted this sentence to the Sentence Coach: "${m.content}"`,
          ].join('\n'),
        });
      } else if (m.content_type === 'analysis') {
        history.push({
          role: 'assistant',
          content: `Here is the structured analysis I gave the user (rendered as rich UI):\n${m.content}`,
        });
      } else {
        history.push({ role: m.role, content: m.content });
      }
    }
    history.push({ role: 'user', content: message.trim() });

    const { answer, toolActions } = await coachChatWithTools(
      c.env.ANTHROPIC_API_KEY, history, { db: c.env.DB, userId }
    );

    // Execute mutating tool actions (create_flashcards, create_custom_lesson)
    const toolResults: Array<{
      tool: string;
      success: boolean;
      data?: Record<string, unknown>;
      error?: string;
    }> = [];

    for (const action of toolActions) {
      if (action.tool === 'create_custom_lesson') {
        const result = await createCustomLessonFromSpec(c.env, userId, action.input, 'chat');
        toolResults.push(
          result.ok
            ? { tool: 'create_custom_lesson', success: true, data: { lesson_id: result.lesson.id, title: result.lesson.title, image_jobs: result.imageJobs } }
            : { tool: 'create_custom_lesson', success: false, error: `Invalid lesson spec: ${result.errors.join('; ')}` }
        );
        continue;
      }
      if (action.tool !== 'create_flashcards') {
        toolResults.push({ tool: action.tool, success: false, error: 'Unsupported tool' });
        continue;
      }
      try {
        const input = action.input as { deck_id?: string; flashcards: Array<{ hanzi: string; pinyin: string; english: string; fun_facts?: string }> };
        const targetDeck = input.deck_id ? await db.getDeckById(c.env.DB, input.deck_id, userId) : null;
        if (!targetDeck) {
          toolResults.push({ tool: 'create_flashcards', success: false, error: 'Target deck not found' });
          continue;
        }
        const createdNotes = [];
        for (const fc of input.flashcards || []) {
          const newNote = await db.createNote(
            c.env.DB, targetDeck.id, fc.hanzi, fc.pinyin, fc.english, undefined, fc.fun_facts
          );
          createdNotes.push(newNote);
        }
        toolResults.push({
          tool: 'create_flashcards',
          success: true,
          data: { deck_name: targetDeck.name, notes: createdNotes.map(n => ({ hanzi: n.hanzi, pinyin: n.pinyin, english: n.english })) },
        });
      } catch (err) {
        console.error('Coach create_flashcards error:', err);
        toolResults.push({ tool: 'create_flashcards', success: false, error: 'Failed to create flashcards' });
      }
    }

    const userMsg = await db.addCoachMessage(c.env.DB, id, 'user', 'text', message.trim());
    const assistantMsg = await db.addCoachMessage(
      c.env.DB, id, 'assistant', 'text', answer,
      toolResults.length > 0 ? JSON.stringify(toolResults) : null
    );

    return c.json({ messages: [userMsg, assistantMsg], toolResults });
  } catch (error) {
    console.error('Coach conversation message error:', error);
    return c.json({ error: 'Failed to get a response' }, 500);
  }
});

// ============ Graded Readers ============

// List all graded readers for the user.
// ?include_pages=true returns each reader with its pages (used by offline sync).
app.get('/api/readers', async (c) => {
  const userId = c.get('user').id;
  if (c.req.query('include_pages') === 'true') {
    const readers = await db.getGradedReadersWithPages(c.env.DB, userId);
    return c.json(readers);
  }
  const readers = await db.getGradedReaders(c.env.DB, userId);
  return c.json(readers);
});

// ============ Reader Review Events (Event-Sourced Sync) ============
// Readers are scheduled with FSRS like cards. Events are the source of truth;
// the client computes reader state from them. These endpoints mirror
// POST/GET /api/reviews.

// Upload batch of reader review events (from offline sync)
app.post('/api/reader-reviews', async (c) => {
  const userId = c.get('user').id;
  const { events } = await c.req.json<{
    events: Array<{
      id: string;
      reader_id: string;
      rating: Rating;
      reviewed_at: string;
      time_spent_ms?: number | null;
    }>;
  }>();

  if (!events || !Array.isArray(events)) {
    return c.json({ error: 'events array is required' }, 400);
  }
  if (events.length === 0) {
    return c.json({ created: 0, skipped: 0, skipped_orphans: 0 });
  }
  for (const event of events) {
    if (!event.id || !event.reader_id || event.rating === undefined || !event.reviewed_at) {
      return c.json({ error: 'Each event must have id, reader_id, rating, and reviewed_at' }, 400);
    }
  }

  // Verify which readers belong to this user; skip orphans (deleted readers)
  const readerIds = [...new Set(events.map(e => e.reader_id))];
  const validReaderIds = new Set<string>();
  const CHECK_CHUNK = 90;
  for (let i = 0; i < readerIds.length; i += CHECK_CHUNK) {
    const chunk = readerIds.slice(i, i + CHECK_CHUNK);
    const rows = await c.env.DB.prepare(`
      SELECT id FROM graded_readers
      WHERE user_id = ? AND id IN (${chunk.map(() => '?').join(',')})
    `).bind(userId, ...chunk).all<{ id: string }>();
    for (const row of rows.results) {
      validReaderIds.add(row.id);
    }
  }

  const validEvents = events.filter(e => validReaderIds.has(e.reader_id));
  const skippedOrphans = events.length - validEvents.length;
  if (skippedOrphans > 0) {
    console.log(`[API reader-reviews] Skipping ${skippedOrphans} events for deleted/missing readers`);
  }

  const result = validEvents.length > 0
    ? await db.createReaderReviewEventsBatch(
        c.env.DB,
        validEvents.map(e => ({ ...e, user_id: userId }))
      )
    : { created: 0, skipped: 0 };

  return c.json({ ...result, skipped_orphans: skippedOrphans });
});

// Get reader review events since a timestamp (for sync)
app.get('/api/reader-reviews', async (c) => {
  const userId = c.get('user').id;
  const since = c.req.query('since');
  const afterId = c.req.query('after_id') || '';
  const limit = parseInt(c.req.query('limit') || '1000', 10);

  if (!since) {
    return c.json({ error: 'since parameter is required (ISO timestamp)' }, 400);
  }

  const events = await db.getReaderReviewEventsSince(c.env.DB, userId, since, limit, afterId);

  return c.json({
    events,
    has_more: events.length >= limit,
    server_time: new Date().toISOString(),
  });
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

// Generate a new graded reader (async - returns immediately with status='generating').
// Two sources:
// - 'decks' (default): story restricted to learned vocabulary of the given decks
// - 'due_cards': the client sends note_ids of today's due cards; the story is
//   written from the learner's full vocabulary and features the due words
//   best-effort (natural story > full coverage)
app.post('/api/readers/generate', async (c) => {
  const userId = c.get('user').id;
  const { source = 'decks', deck_ids, note_ids, topic, difficulty = 'beginner' } = await c.req.json<GenerateReaderRequest>();

  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI generation is not configured' }, 500);
  }

  try {
    let vocabulary: VocabularyItem[];
    let sourceDeckIds: string[];
    let mode: StoryGenerationMessage['mode'];

    if (source === 'due_cards') {
      if (!note_ids || !Array.isArray(note_ids) || note_ids.length === 0) {
        return c.json({ error: 'note_ids is required for source "due_cards"' }, 400);
      }
      // Cap the target list so the prompt stays focused on a workable set
      const MAX_TARGET_WORDS = 80;
      vocabulary = await db.getVocabularyForNotes(c.env.DB, userId, note_ids.slice(0, 300));
      vocabulary = vocabulary.slice(0, MAX_TARGET_WORDS);
      sourceDeckIds = [];
      mode = 'due_cards';

      if (vocabulary.length < 3) {
        return c.json({
          error: 'Not enough due words to build a story from.',
          vocabulary_count: vocabulary.length,
          minimum_required: 3,
        }, 400);
      }
    } else {
      if (!deck_ids || !Array.isArray(deck_ids) || deck_ids.length === 0) {
        return c.json({ error: 'deck_ids is required and must be a non-empty array' }, 400);
      }
      // Get learned vocabulary from the specified decks
      vocabulary = await db.getLearnedVocabulary(c.env.DB, userId, deck_ids);
      sourceDeckIds = deck_ids;
      mode = undefined;

      if (vocabulary.length < 5) {
        return c.json({
          error: 'Not enough learned vocabulary. Please study more cards first.',
          vocabulary_count: vocabulary.length,
          minimum_required: 5
        }, 400);
      }
    }

    console.log('[Readers] Creating pending reader with', vocabulary.length, 'vocabulary items (source:', source, ')');

    // Create a pending reader immediately with status='generating'
    const pendingReader = await db.createPendingReader(c.env.DB, userId, {
      title_chinese: '生成中...',
      title_english: topic
        ? `Story about: ${topic}`
        : source === 'due_cards'
          ? "Story from today's due words..."
          : 'Generating story...',
      difficulty_level: difficulty as DifficultyLevel,
      topic: topic || null,
      source_deck_ids: sourceDeckIds,
      vocabulary_used: vocabulary,
    });

    console.log('[Readers] Pending reader created:', pendingReader.id);

    // Queue story generation (runs in background with 15 min timeout).
    // Only the readerId is sent — the consumer loads vocabulary_used from the
    // reader record to stay under the 128 KB Queues message limit.
    await c.env.STORY_QUEUE.send({
      readerId: pendingReader.id,
      topic,
      difficulty: difficulty as DifficultyLevel,
      mode,
      // Due-cards stories also draw on recent tutor lesson notes for theme
      withLessonNotes: mode === 'due_cards',
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
            { conversation_id: convId, relationship_id: conv.relationship_id },
          );
        }

        // Send push notification via ntfy
        await notifyNewChatMessage(c.env.NTFY_TOPIC, senderName, truncatedContent);
      } catch (err) {
        console.error('[Notifications] Failed to send message notification:', err);
      }
    })());

    // Auto-translate Chinese messages (non-blocking)
    const hasChinese = /[\u4e00-\u9fff]/.test(content);
    if (hasChinese && c.env.ANTHROPIC_API_KEY) {
      c.executionCtx.waitUntil((async () => {
        try {
          const { translateAndSegment } = await import('./services/translation');
          const result = await translateAndSegment(c.env.ANTHROPIC_API_KEY, content);
          await c.env.DB
            .prepare('UPDATE messages SET translation = ?, segmentation = ? WHERE id = ?')
            .bind(result.translation, JSON.stringify(result.segmentation), message.id)
            .run();
          console.log('[Translation] Auto-translated message', message.id);
        } catch (err) {
          console.error('[Translation] Auto-translate failed for message', message.id, err);
        }
      })());
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
    const jsonStr = extractJSON(textContent.text);
    if (!jsonStr) {
      throw new Error('Invalid AI response format');
    }

    const flashcard = JSON.parse(jsonStr) as {
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
      voiceId: conv.voice_id || DEFAULT_MINIMAX_VOICE,
      speed: conv.voice_speed ?? DEFAULT_TTS_SPEED,
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
      voiceId: conv.voice_id || DEFAULT_MINIMAX_VOICE,
      speed: conv.voice_speed ?? DEFAULT_TTS_SPEED,
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
      voiceId: voice_id || conv.voice_id || DEFAULT_MINIMAX_VOICE,
      speed: voice_speed ?? conv.voice_speed ?? DEFAULT_TTS_SPEED,
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
    "fun_facts": "Substantive learning note: grammar patterns, cultural context, common mistakes, or disambiguation from similar words",
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

    const jsonStr = extractJSON(textContent.text);
    if (!jsonStr) {
      throw new Error('Invalid AI response format');
    }

    const result = JSON.parse(jsonStr) as {
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

// Helper: extract JSON object from AI text response using brace-depth tracking
// Handles cases where AI wraps JSON in markdown code fences or adds extra text
function extractJSON(text: string): string | null {
  // Strip markdown code fences if present
  const stripped = text.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
  const start = stripped.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return stripped.slice(start, i + 1); }
  }
  return null;
}

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
4. A substantive learning note: explain grammar patterns, cultural context, common mistakes, or disambiguation from similar characters/words
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
  const jsonStr = extractJSON(text);
  if (!jsonStr) {
    throw new Error('Failed to parse AI response');
  }

  const result = JSON.parse(jsonStr);

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

Create a flashcard for the FULL sentence/message — not just a single keyword. The goal is that after learning this card, the student could reproduce the entire message in Chinese.

- If the text is already in Chinese, use the full text as the hanzi.
- If the text is in English, translate the full message into natural Chinese.
- If the text is a question about Chinese (e.g. "please explain 相信"), create a flashcard for the full sentence that uses the word in context (e.g. "请解释一下相信是什么意思").

IMPORTANT: Use tone marks for pinyin (nǐ hǎo) NOT tone numbers (ni3 hao3).

Respond with ONLY a JSON object in this exact format:
{
  "hanzi": "The full Chinese sentence",
  "pinyin": "full pīnyīn with tone marks",
  "english": "Full English translation",
  "fun_facts": "Substantive learning note about a key word or grammar point: explain usage, cultural context, common mistakes, or disambiguation"
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
    const jsonStr = extractJSON(aiText);
    if (!jsonStr) {
      throw new Error('Failed to parse AI response');
    }

    const result = JSON.parse(jsonStr);
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
        'SELECT id, name, description, new_cards_per_day, secondary_cards_per_day, created_at, updated_at FROM decks WHERE user_id = ? ORDER BY created_at'
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

  // Verify which cards belong to this user — chunked IN queries instead of
  // one query per card, so large reconcile uploads stay under the Workers
  // subrequest cap.
  const cardIds = [...new Set(events.map(e => e.card_id))];
  const validCardIds = new Set<string>();
  const CARD_CHECK_CHUNK = 90;
  for (let i = 0; i < cardIds.length; i += CARD_CHECK_CHUNK) {
    const chunk = cardIds.slice(i, i + CARD_CHECK_CHUNK);
    const rows = await c.env.DB.prepare(`
      SELECT c.id FROM cards c
      JOIN notes n ON c.note_id = n.id
      JOIN decks d ON n.deck_id = d.id
      WHERE d.user_id = ? AND c.id IN (${chunk.map(() => '?').join(',')})
    `).bind(userId, ...chunk).all<{ id: string }>();
    for (const row of rows.results) {
      validCardIds.add(row.id);
    }
  }

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
  // This ensures the cards table reflects the latest state after sync.
  // Bulk reads + batched writes, like /api/cards/recompute-states — the old
  // 2-queries-per-card loop broke large reconcile uploads.
  if (result.created > 0) {
    const affectedCardIds = [...new Set(validEvents.map(e => e.card_id))];
    console.log(`[API reviews] Recomputing state for ${affectedCardIds.length} cards`);

    // Fetch full event history for the affected cards in chunked IN queries
    const eventsByCard = new Map<string, SchedulerReviewEvent[]>();
    const EVENT_FETCH_CHUNK = 50;
    for (let i = 0; i < affectedCardIds.length; i += EVENT_FETCH_CHUNK) {
      const chunk = affectedCardIds.slice(i, i + EVENT_FETCH_CHUNK);
      const rows = await c.env.DB.prepare(`
        SELECT id, card_id, rating, reviewed_at FROM review_events
        WHERE user_id = ? AND card_id IN (${chunk.map(() => '?').join(',')})
        ORDER BY reviewed_at ASC
      `).bind(userId, ...chunk).all<{ id: string; card_id: string; rating: number; reviewed_at: string }>();
      for (const e of rows.results) {
        let list = eventsByCard.get(e.card_id);
        if (!list) {
          list = [];
          eventsByCard.set(e.card_id, list);
        }
        list.push({ id: e.id, card_id: e.card_id, rating: e.rating as 0 | 1 | 2 | 3, reviewed_at: e.reviewed_at });
      }
    }

    // Note: The cards table has legacy columns (ease_factor, interval, repetitions)
    // but not all FSRS columns (scheduled_days, reps). Map accordingly.
    const updateStmt = c.env.DB.prepare(`
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
    `);

    const statements: D1PreparedStatement[] = [];
    for (const [cardId, cardEvents] of eventsByCard) {
      try {
        const newState = computeCardState(cardEvents, FSRS_DEFAULT_SETTINGS);
        statements.push(updateStmt.bind(
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
        ));
      } catch (err) {
        console.error(`[API reviews] Failed to recompute state for card ${cardId}:`, err);
        // Continue with other cards even if one fails
      }
    }

    const UPDATE_BATCH = 100;
    for (let i = 0; i < statements.length; i += UPDATE_BATCH) {
      try {
        await c.env.DB.batch(statements.slice(i, i + UPDATE_BATCH));
      } catch (err) {
        console.error(`[API reviews] Card state batch update failed at offset ${i}:`, err);
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
  const afterId = c.req.query('after_id') || '';
  const limit = parseInt(c.req.query('limit') || '1000', 10);

  if (!since) {
    return c.json({ error: 'since parameter is required (ISO timestamp)' }, 400);
  }

  const events = await db.getReviewEventsSince(c.env.DB, userId, since, limit, afterId);

  // Get sync metadata
  const metadata = await db.getSyncMetadata(c.env.DB, userId);

  return c.json({
    events,
    has_more: events.length >= limit,
    server_time: new Date().toISOString(),
    last_sync_at: metadata?.last_sync_at || null,
  });
});

// Delete a single review event (Undo on the study page). Events are normally
// append-only; undo is the deliberate exception. The client deletes the event
// locally and calls this so a later download/full sync can't resurrect it.
// The card's state is recomputed from the remaining events.
app.delete('/api/reviews/:id', async (c) => {
  const userId = c.get('user').id;
  const eventId = c.req.param('id');

  const event = await c.env.DB.prepare(
    'SELECT id, card_id FROM review_events WHERE id = ? AND user_id = ?'
  ).bind(eventId, userId).first<{ id: string; card_id: string }>();

  if (!event) {
    // Already gone or never uploaded — report success so the client can clear
    // its pending-deletion queue.
    return c.json({ deleted: false });
  }

  await c.env.DB.prepare('DELETE FROM review_events WHERE id = ? AND user_id = ?')
    .bind(eventId, userId).run();

  const rows = await c.env.DB.prepare(`
    SELECT id, card_id, rating, reviewed_at FROM review_events
    WHERE user_id = ? AND card_id = ?
    ORDER BY reviewed_at ASC
  `).bind(userId, event.card_id).all<{ id: string; card_id: string; rating: number; reviewed_at: string }>();

  const cardEvents: SchedulerReviewEvent[] = rows.results.map(e => ({
    id: e.id,
    card_id: e.card_id,
    rating: e.rating as 0 | 1 | 2 | 3,
    reviewed_at: e.reviewed_at,
  }));

  const newState = cardEvents.length > 0
    ? computeCardState(cardEvents, FSRS_DEFAULT_SETTINGS)
    : initialCardState(FSRS_DEFAULT_SETTINGS);

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
    newState.interval,
    newState.repetitions,
    newState.next_review_at,
    newState.due_timestamp,
    event.card_id
  ).run();

  return c.json({ deleted: true });
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

  // Workers cap subrequests (each D1 call counts) at ~1000 per request, so
  // this must NOT query per card — with thousands of reviewed cards the old
  // per-card loop got the request canceled mid-flight. Instead: page all
  // events in a handful of SELECTs, group in memory, write in batches.

  // 1. Page through every review event for the user (only the columns the
  //    scheduler needs), grouping by card.
  const eventsByCard = new Map<string, SchedulerReviewEvent[]>();
  const PAGE_SIZE = 5000;
  let cursorId = '';
  for (;;) {
    const page = await c.env.DB.prepare(`
      SELECT id, card_id, rating, reviewed_at FROM review_events
      WHERE user_id = ? AND id > ?
      ORDER BY id ASC
      LIMIT ?
    `).bind(userId, cursorId, PAGE_SIZE).all<{
      id: string;
      card_id: string;
      rating: number;
      reviewed_at: string;
    }>();

    for (const e of page.results) {
      let list = eventsByCard.get(e.card_id);
      if (!list) {
        list = [];
        eventsByCard.set(e.card_id, list);
      }
      list.push({
        id: e.id,
        card_id: e.card_id,
        rating: e.rating as 0 | 1 | 2 | 3,
        reviewed_at: e.reviewed_at,
      });
    }

    if (page.results.length < PAGE_SIZE) break;
    cursorId = page.results[page.results.length - 1].id;
  }

  console.log(`[API recompute-states] Recomputing state for ${eventsByCard.size} cards for user ${userId}`);

  // 2. Compute new state per card (pure CPU, no queries)
  const updateStmt = c.env.DB.prepare(`
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
  `);

  let updated = 0;
  let errors = 0;
  const statements: D1PreparedStatement[] = [];

  for (const [cardId, cardEvents] of eventsByCard) {
    try {
      // computeCardState expects events sorted by reviewed_at ascending
      cardEvents.sort((a, b) => (a.reviewed_at < b.reviewed_at ? -1 : a.reviewed_at > b.reviewed_at ? 1 : 0));
      const newState = computeCardState(cardEvents, FSRS_DEFAULT_SETTINGS);

      // Note: The cards table has legacy columns (ease_factor, interval, repetitions)
      // but not all FSRS columns (scheduled_days, reps). Map accordingly.
      statements.push(updateStmt.bind(
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
      ));
    } catch (err) {
      console.error(`[API recompute-states] Failed to recompute state for card ${cardId}:`, err);
      errors++;
    }
  }

  // 3. Apply updates in batches (each batch is a single D1 call)
  const BATCH_SIZE = 100;
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    const chunk = statements.slice(i, i + BATCH_SIZE);
    try {
      await c.env.DB.batch(chunk);
      updated += chunk.length;
    } catch (err) {
      console.error(`[API recompute-states] Batch update failed at offset ${i}:`, err);
      errors += chunk.length;
    }
  }

  return c.json({
    total_cards: eventsByCard.size,
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

// ============ Lesson Notes (external tutor homework) ============

app.get('/api/lesson-notes', async (c) => {
  const userId = c.get('user').id;
  const notes = await db.listLessonNotes(c.env.DB, userId);
  return c.json({ notes });
});

app.post('/api/lesson-notes', async (c) => {
  const userId = c.get('user').id;
  const { raw_text, given_at } = await c.req.json<{ raw_text: string; given_at?: string }>();
  if (!raw_text?.trim()) return c.json({ error: 'raw_text required' }, 400);
  const id = await db.createLessonNote(c.env.DB, userId, raw_text.trim(), given_at?.trim() || null);
  return c.json({ id });
});

app.post('/api/lesson-notes/:id/files', async (c) => {
  const userId = c.get('user').id;
  const noteId = c.req.param('id');
  if (!(await db.lessonNoteOwnedBy(c.env.DB, noteId, userId))) {
    return c.json({ error: 'Not found' }, 404);
  }

  const form = await c.req.formData();
  const file = form.get('file') as unknown;
  if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
    return c.json({ error: 'file required' }, 400);
  }
  const blob = file as Blob & { name?: string };
  const filename = blob.name ?? 'upload';
  const key = `lesson-notes/${noteId}/${crypto.randomUUID()}-${filename}`;
  await c.env.AUDIO_BUCKET.put(key, await blob.arrayBuffer(), {
    httpMetadata: { contentType: blob.type || 'application/octet-stream' },
  });
  const fileId = await db.addLessonNoteFile(c.env.DB, noteId, {
    r2_key: key,
    filename,
    content_type: blob.type || null,
    size: blob.size,
  });
  return c.json({ id: fileId, r2_key: key, filename });
});

app.delete('/api/lesson-notes/:id', async (c) => {
  const userId = c.get('user').id;
  await db.deleteLessonNote(c.env.DB, c.req.param('id'), userId);
  return c.json({ ok: true });
});

// ============ Quests (tile-map mini-games) ============

/**
 * A quest is a whole little game level authored by Claude — map, objects,
 * verbs and goals — played by the shared engine. Generation takes a while and
 * may need a repair round, so it runs in the background: the row is created
 * immediately with status 'generating' and the client polls.
 */
function questSummary(row: db.QuestRow) {
  const world = parseQuestWorld(row.world);
  const { world: _world, ...rest } = row;
  return {
    ...rest,
    goal_count: world?.goals.length ?? 0,
    object_count: world?.objects.length ?? 0,
  };
}

function parseQuestWorld(json: string | null): QuestWorld | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as QuestWorld;
  } catch {
    return null;
  }
}

app.get('/api/quests', async (c) => {
  const userId = c.get('user').id;
  await db.markStaleQuests(c.env.DB, userId);
  const rows = await db.listQuests(c.env.DB, userId);
  return c.json({ quests: rows.map(questSummary) });
});

app.post('/api/quests', async (c) => {
  const userId = c.get('user').id;
  if (!c.env.ANTHROPIC_API_KEY) {
    return c.json({ error: 'AI generation is not configured' }, 500);
  }

  const body = await c.req.json<{
    topic?: string;
    difficulty?: QuestDifficulty;
    goal_count?: number;
    deck_ids?: string[];
  }>();

  const difficulty: QuestDifficulty =
    body.difficulty === 'easy' || body.difficulty === 'hard' ? body.difficulty : 'medium';
  const topic = body.topic?.trim().slice(0, 200) || null;

  const questId = await db.createQuest(c.env.DB, userId, {
    title: topic ? `Quest: ${topic}` : 'New quest',
    topic,
    difficulty,
  });

  // A world is one long Claude call plus up to two repair rounds, which
  // outlives waitUntil() — the isolate gets torn down mid-call and the row is
  // left stuck in 'generating'. Queue consumers get minutes, so it goes there.
  await c.env.QUEST_QUEUE.send({
    questId,
    goalCount: body.goal_count,
    deckIds: body.deck_ids,
  });

  return c.json({ id: questId, status: 'generating' }, 202);
});

/** Rebuild a failed quest in place, keeping its topic and difficulty. */
app.post('/api/quests/:id/retry', async (c) => {
  const userId = c.get('user').id;
  const row = await db.getQuest(c.env.DB, c.req.param('id'), userId);
  if (!row) return c.json({ error: 'Not found' }, 404);
  if (row.status === 'generating') return c.json({ error: 'Already generating' }, 409);

  await db.resetQuestForRetry(c.env.DB, row.id, userId);
  await c.env.QUEST_QUEUE.send({ questId: row.id });
  return c.json({ id: row.id, status: 'generating' }, 202);
});

app.get('/api/quests/:id', async (c) => {
  const userId = c.get('user').id;
  await db.markStaleQuests(c.env.DB, userId);
  const row = await db.getQuest(c.env.DB, c.req.param('id'), userId);
  if (!row) return c.json({ error: 'Not found' }, 404);
  const { world, ...rest } = row;
  return c.json({ quest: { ...rest, world: parseQuestWorld(world) } });
});

app.post('/api/quests/:id/complete', async (c) => {
  const userId = c.get('user').id;
  const { moves } = await c.req.json<{ moves?: number }>();
  const row = await db.getQuest(c.env.DB, c.req.param('id'), userId);
  if (!row) return c.json({ error: 'Not found' }, 404);
  const clean = Number.isFinite(moves) ? Math.max(0, Math.round(moves as number)) : 0;
  await db.recordQuestCompletion(c.env.DB, row.id, userId, clean);
  return c.json({ ok: true });
});

app.delete('/api/quests/:id', async (c) => {
  const userId = c.get('user').id;
  await db.deleteQuest(c.env.DB, c.req.param('id'), userId);
  return c.json({ ok: true });
});

// ============ Daily activities (reader / status) ============

// Read-only status of today's reader. NEVER kicks off generation — that only
// happens on demand when a study session starts (see startDailyReader).
// This keeps the home screen's /api/daily/status cheap and avoids generating a
// graded reader every day for every user (which was rate-limiting the AI API).
async function getDailyReaderStatus(
  c: { env: Env },
  userId: string,
  localDate?: string,
) {
  const existing = await db.getDailyReader(c.env.DB, userId, localDate);
  if (!existing) return null;

  // Surface a generation that's been stuck > 30 min as failed so the UI can
  // offer a retry — but do not re-queue it here. Retry happens on demand.
  const isStuckGenerating =
    existing.status === 'generating' &&
    existing.reader_id &&
    existing.created_at &&
    Date.now() - new Date(existing.created_at).getTime() > 30 * 60 * 1000;

  if (isStuckGenerating) {
    console.log('[getDailyReaderStatus] Reader stuck generating > 30 min, marking failed:', existing.reader_id);
    const timeoutMsg = 'Generation timed out after 30 minutes';
    await db.updateReaderStatus(c.env.DB, existing.reader_id, 'failed', timeoutMsg);
    return { ...existing, status: 'failed', error_message: timeoutMsg };
  }

  return existing;
}

// The daily reader has no canned scenario — the story theme is driven by the
// learner's due words and recent lesson notes. daily_readers.situation_id is
// NOT NULL for historical reasons, so reservations use this sentinel.
const DAILY_READER_SOURCE = 'due-cards';

// On-demand generation of today's reader. Idempotent: if one is already
// generating or ready, it's returned as-is rather than regenerated. A failed
// reader (or no reader yet) is (re)queued for generation. Returns null when the
// user doesn't have enough learned vocabulary yet.
//
// The story targets today's due cards (note ids sent by the client, which owns
// the offline study queue) and threads in the tutor's recent lesson notes.
// With no/few due words it falls back to a free story over the full learned
// vocabulary — still with lesson notes.
async function startDailyReader(
  c: { env: Env; executionCtx: { waitUntil: (p: Promise<unknown>) => void } },
  userId: string,
  dueNoteIds: string[],
  localDate?: string,
) {
  const existing = await db.getDailyReader(c.env.DB, userId, localDate);

  // Already generating or ready — return immediately, but treat as failed if stuck > 30 min.
  if (existing && existing.status !== 'failed') {
    const isStuckGenerating =
      existing.status === 'generating' &&
      existing.reader_id &&
      existing.created_at &&
      Date.now() - new Date(existing.created_at).getTime() > 30 * 60 * 1000;

    if (!isStuckGenerating) return existing;

    console.log('[startDailyReader] Reader stuck generating > 30 min, marking failed:', existing.reader_id);
    await db.updateReaderStatus(c.env.DB, existing.reader_id, 'failed', 'Generation timed out after 30 minutes');
  }

  // Check vocabulary before reserving a slot, so we never leave a phantom
  // reservation behind when the user can't have a reader yet.
  const deckIds = await db.getUserDeckIds(c.env.DB, userId);
  const vocabulary = deckIds.length
    ? await db.getLearnedVocabulary(c.env.DB, userId, deckIds)
    : [];
  if (vocabulary.length < 5) return null;

  // No reservation yet — atomically reserve the slot (skip if already reserved for a retry).
  if (!existing) {
    const won = await db.reserveDailyReader(c.env.DB, userId, DAILY_READER_SOURCE, localDate);
    if (!won) return await db.getDailyReader(c.env.DB, userId, localDate);
  }

  // Today's due words become best-effort TARGET words ('due_cards' mode: the
  // consumer merges them with the full learned vocabulary). Too few due words
  // → plain generation over the learned vocabulary instead.
  const MAX_TARGET_WORDS = 80;
  const targets = dueNoteIds.length
    ? (await db.getVocabularyForNotes(c.env.DB, userId, dueNoteIds.slice(0, 300))).slice(0, MAX_TARGET_WORDS)
    : [];
  const dueMode = targets.length >= 3;

  const pending = await db.createPendingReader(c.env.DB, userId, {
    title_chinese: '生成中...',
    title_english: "Today's story...",
    difficulty_level: 'beginner' as DifficultyLevel,
    topic: null,
    source_deck_ids: deckIds,
    vocabulary_used: dueMode ? targets : vocabulary,
  });
  await db.setDailyReaderId(c.env.DB, userId, pending.id, localDate);
  // Only the readerId is sent — the consumer loads vocabulary_used from the
  // reader record to stay under the 128 KB Queues message limit.
  c.executionCtx.waitUntil(
    c.env.STORY_QUEUE.send({
      readerId: pending.id,
      difficulty: 'beginner',
      mode: dueMode ? 'due_cards' : undefined,
      withLessonNotes: true,
      // The daily story is ANCHORED on recent lesson notes when they exist
      // (Jerome: the lesson material matters more than the due cards); the
      // due words above become secondary weave-ins.
      anchorLessonNotes: true,
    }),
  );
  return { reader_id: pending.id, situation_id: DAILY_READER_SOURCE, status: 'generating' };
}

function triggerPracticePregen(
  c: { env: Env; executionCtx: { waitUntil: (p: Promise<unknown>) => void } },
  userId: string,
  point: GrammarPoint,
) {
  c.executionCtx.waitUntil((async () => {
    try {
      const alreadyReady = await db.hasPregenPracticeSession(c.env.DB, userId, point.id);
      if (alreadyReady) return;
      const [vocab, lessonNotes] = await Promise.all([
        db.getLearnedVocabulary(c.env.DB, userId),
        db.getRecentLessonNotesText(c.env.DB, userId),
      ]);
      if (vocab.length < 10) return;
      const content = await generatePracticeSession(
        c.env.ANTHROPIC_API_KEY,
        point,
        vocab,
        lessonNotes || undefined,
      );
      await db.savePregenPracticeSession(c.env.DB, userId, point.id, JSON.stringify(content));
      console.log('[Practice pregen] Pre-generated session for grammar point:', point.id);
    } catch (e) {
      console.error('[Practice pregen] Background generation failed:', e);
    }
  })());
}

app.get('/api/daily/status', async (c) => {
  const userId = c.get('user').id;
  const localDate = c.req.query('local_date');
  const [nextGrammarPoint, grammarDone, activities, dailyReader] = await Promise.all([
    db.getNextGrammarPoint(c.env.DB, userId),
    db.practiceCompletedToday(c.env.DB, userId),
    db.getDailyActivityStatus(c.env.DB, userId),
    getDailyReaderStatus(c, userId, localDate),
  ]);
  if (!grammarDone && nextGrammarPoint) {
    triggerPracticePregen(c, userId, nextGrammarPoint);
  }
  // When done today, show the lesson that was actually completed, not the next one.
  // getNextGrammarPoint returns the next lesson to study (which may be different from
  // the completed one if it graduated to 'known'), creating a misleading "done: [next lesson]" display.
  let grammarPoint = nextGrammarPoint;
  if (grammarDone) {
    const completedPoint = await db.getTodayCompletedGrammarPoint(c.env.DB, userId);
    if (completedPoint) grammarPoint = completedPoint;
  }
  return c.json({
    grammar: { point: grammarPoint, done_today: grammarDone },
    reader_done: activities.reader,
    today_reader: dailyReader,
  });
});

app.post('/api/daily/mark', async (c) => {
  const userId = c.get('user').id;
  const { activity, ref_id } = await c.req.json<{ activity: 'reader'; ref_id?: string }>();
  await db.recordDailyActivity(c.env.DB, userId, activity, ref_id ?? null);
  return c.json({ ok: true });
});

// Kick off generation of today's reader on demand (called when a study session
// starts). Idempotent — safe to call repeatedly; returns the current reader
// status. The client sends note_ids of today's due cards (it owns the offline
// study queue) so the story can target them; an empty/missing list just means
// a free story over the learned vocabulary.
app.post('/api/daily/reader/generate', async (c) => {
  const userId = c.get('user').id;
  type GenerateBody = { note_ids?: string[]; local_date?: string };
  const body = await c.req.json<GenerateBody>().catch(() => ({} as GenerateBody));
  const dueNoteIds = Array.isArray(body.note_ids) ? body.note_ids : [];
  const reader = await startDailyReader(c, userId, dueNoteIds, body.local_date);
  if (!reader) {
    return c.json(
      { error: 'Not enough learned vocabulary yet. Study some cards first, then try again.' },
      400,
    );
  }
  return c.json(reader);
});

// ============ Grammar Practice ============

app.post('/api/practice/tts', async (c) => {
  const { text, speed } = await c.req.json<{ text: string; speed?: number }>();
  if (!text) return c.json({ error: 'text required' }, 400);
  // MiniMax accepts speeds in [0.5, 2.0]
  const clampedSpeed = typeof speed === 'number' ? Math.min(2, Math.max(0.5, speed)) : undefined;
  const result = await generateConversationTTS(c.env, text, { speed: clampedSpeed });
  if (!result) return c.json({ error: 'TTS failed' }, 502);
  return c.json({ audio_base64: result.audioBase64, content_type: result.contentType });
});

// The next ~6 grammar lessons with pre-generated exercises, for offline
// caching. Lessons without exercises yet are topped up in the background
// (max 2 generations per call) and arrive on a later sync.
app.get('/api/practice/upcoming', async (c) => {
  const userId = c.get('user').id;
  const UPCOMING_COUNT = 6;
  const points = await db.getUpcomingGrammarPoints(c.env.DB, userId, UPCOMING_COUNT);

  const lessons: Array<{
    grammar_point: GrammarPoint;
    progress: { status: 'new' | 'learning'; correct_count: number } | null;
    exercises: unknown;
  }> = [];
  const missing: GrammarPoint[] = [];

  for (const point of points) {
    const pregen = await db.getPregenPracticeSession(c.env.DB, userId, point.id);
    let exercises: unknown = null;
    if (pregen) {
      try {
        const content = JSON.parse(pregen.exercises_json) as PracticeSessionContent;
        exercises = {
          flood: content.flood,
          scrambles: content.scrambles,
          contrasts: content.contrasts,
          translates: content.translates,
        };
      } catch (e) {
        console.error('[Practice] Discarding corrupt pre-generated session for', point.id, e);
      }
    }
    if (!exercises) missing.push(point);
    const { progress, ...grammarPoint } = point;
    lessons.push({ grammar_point: grammarPoint, progress, exercises });
  }

  // Top up missing exercise sets in the background, a couple at a time
  for (const point of missing.slice(0, 2)) {
    triggerPracticePregen(c, userId, point);
  }

  return c.json({ lessons, pending: missing.map((p) => p.id) });
});

// Apply offline grammar-lesson completions (idempotent by event id)
app.post('/api/practice/offline-complete', async (c) => {
  const userId = c.get('user').id;
  const { events } = await c.req.json<{
    events: Array<{ id: string; grammar_point_id: string; correct: number; total: number; completed_at: string }>;
  }>();
  if (!events || !Array.isArray(events)) {
    return c.json({ error: 'events array is required' }, 400);
  }

  let applied = 0;
  for (const event of events) {
    if (!event.id || !event.grammar_point_id || !event.completed_at) continue;
    if (await db.applyOfflinePracticeCompletion(c.env.DB, userId, event)) {
      applied++;
    }
  }
  return c.json({ applied, skipped: events.length - applied });
});

// ============ Custom mini lessons (agent-authored, see shared/lesson) ============

// Lessons with their full spec and completion history, for offline caching.
// Completions are the lessons' FSRS review events — the client computes each
// lesson's scheduling state from them, so all lessons are returned by default
// (a completed lesson recurs on the FSRS cadence rather than retiring).
app.get('/api/custom-lessons', async (c) => {
  const userId = c.get('user').id;
  const status = c.req.query('status');
  const [rows, completions] = await Promise.all([
    db.listCustomLessons(
      c.env.DB,
      userId,
      status === 'active' || status === 'done' ? { status } : {},
    ),
    db.listCustomLessonCompletions(c.env.DB, userId),
  ]);
  const completionsByLesson = new Map<string, typeof completions>();
  for (const completion of completions) {
    const list = completionsByLesson.get(completion.lesson_id) ?? [];
    list.push(completion);
    completionsByLesson.set(completion.lesson_id, list);
  }
  return c.json({
    lessons: rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      icon: row.icon,
      source: row.source,
      status: row.status,
      created_at: row.created_at,
      spec: JSON.parse(row.spec),
      completions: completionsByLesson.get(row.id) ?? [],
    })),
  });
});

// Create a lesson from a spec (validated). Used directly by scripts/agents
// with a session; the MCP server and in-app chat have their own tool paths.
app.post('/api/custom-lessons', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json<{ spec?: unknown }>().catch(() => ({} as { spec?: unknown }));
  const result = await createCustomLessonFromSpec(c.env, userId, body.spec, 'api');
  if (!result.ok) {
    return c.json({ error: 'Invalid lesson spec', problems: result.errors }, 400);
  }
  return c.json({ ...result.lesson, spec: JSON.parse(result.lesson.spec), image_jobs: result.imageJobs }, 201);
});

app.delete('/api/custom-lessons/:id', async (c) => {
  const userId = c.get('user').id;
  const deleted = await db.deleteCustomLesson(c.env.DB, c.req.param('id'), userId);
  if (!deleted) return c.json({ error: 'Lesson not found' }, 404);
  return c.json({ ok: true });
});

// Offline completion events — idempotent by event id, same shape as the
// grammar practice endpoint.
app.post('/api/custom-lessons/offline-complete', async (c) => {
  const userId = c.get('user').id;
  const { events } = await c.req.json<{
    events: Array<{ id: string; lesson_id: string; correct: number; total: number; completed_at: string; rating?: number | null }>;
  }>();
  if (!events || !Array.isArray(events)) {
    return c.json({ error: 'events array is required' }, 400);
  }

  let applied = 0;
  for (const event of events) {
    if (!event.id || !event.lesson_id || !event.completed_at) continue;
    if (await db.applyCustomLessonCompletion(c.env.DB, userId, event)) {
      applied++;
    }
  }
  return c.json({ applied, skipped: events.length - applied });
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

  if (c.env.CCR_FEATURE_REQUEST_ROUTINE_URL && c.env.CCR_FEATURE_REQUEST_ROUTINE_KEY) {
    const text = [
      `Feature request ${id} from ${user.name || user.email}`,
      `Page: ${pageContext || 'unknown'}`,
      '',
      content.trim(),
      consoleLogs ? `\n--- Console logs ---\n${consoleLogs}` : '',
      screenshotUrl ? `\nScreenshot: ${screenshotUrl}` : '',
    ].join('\n').slice(0, 65000);

    c.executionCtx.waitUntil(
      fetch(c.env.CCR_FEATURE_REQUEST_ROUTINE_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${c.env.CCR_FEATURE_REQUEST_ROUTINE_KEY}`,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'experimental-cc-routine-2026-04-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      })
        .then(async (r) => {
          if (!r.ok) {
            console.error('CCR routine fire failed', r.status, await r.text());
            return;
          }
          const data = await r.json() as { claude_code_session_url?: string };
          if (data.claude_code_session_url) {
            await c.env.DB.prepare(
              `UPDATE feature_requests SET ccr_session_url = ? WHERE id = ?`
            ).bind(data.claude_code_session_url, id).run();
          }
        })
        .catch((e) => console.error('CCR routine fire error', e)),
    );
  }

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
  const body = await c.req.json<{ status?: string; agent_session_url?: string | null }>();

  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (body.status !== undefined) {
    const validStatuses = ['new', 'in_progress', 'agent_working', 'done', 'declined'];
    if (!validStatuses.includes(body.status)) {
      return c.json({ error: `Invalid status. Valid: ${validStatuses.join(', ')}` }, 400);
    }
    setClauses.push('status = ?');
    params.push(body.status);
  }

  if ('agent_session_url' in body) {
    setClauses.push('agent_session_url = ?');
    params.push(body.agent_session_url ?? null);
  }

  if (setClauses.length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  const now = new Date().toISOString();
  setClauses.push('updated_at = ?');
  params.push(now);
  params.push(id);

  await c.env.DB.prepare(
    `UPDATE feature_requests SET ${setClauses.join(', ')} WHERE id = ?`
  ).bind(...params).run();

  return c.json({ success: true, ...body });
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

  // Queue handler for background processing (story, image, and audio lesson generation)
  async queue(batch: MessageBatch<StoryGenerationMessage | ImageGenerationMessage | CustomLessonImageMessage | SentenceSetMessage | QuestGenerationMessage>, env: Env): Promise<void> {
    const queueName = batch.queue;
    console.log('[Queue] Processing batch from queue:', queueName, 'with', batch.messages.length, 'messages');

    if (queueName === 'story-generation-queue') {
      // Handle story generation
      for (const message of batch.messages) {
        const { readerId, topic, difficulty, mode, withLessonNotes, anchorLessonNotes } = message.body as StoryGenerationMessage;
        console.log('[Queue] Processing story generation for reader:', readerId, mode ? `(mode: ${mode})` : '');

        try {
          // Load the vocabulary from the reader record rather than the queue
          // message — the full list can exceed the 128 KB Queues message limit.
          const pendingReader = await db.getGradedReaderById(env.DB, readerId);
          if (!pendingReader) {
            throw new Error(`Reader not found for story generation: ${readerId}`);
          }
          let vocabulary = pendingReader.vocabulary_used;
          let targetVocabulary: VocabularyItem[] | undefined;

          if (mode === 'due_cards') {
            // vocabulary_used holds the TARGET words (today's due cards).
            // The story itself may use the learner's full learned vocabulary,
            // so it stays natural instead of contorting around ~30 words.
            targetVocabulary = vocabulary;
            const learned = await db.getLearnedVocabulary(env.DB, pendingReader.user_id);
            const seen = new Set(learned.map(v => v.hanzi));
            vocabulary = [...learned, ...targetVocabulary.filter(v => !seen.has(v.hanzi))];
          }

          // Lesson notes: daily readers (anchorLessonNotes) rotate a FOCUS
          // note by day — notes change a few times a week but a story is
          // generated daily, so the emphasis cycles through the week's
          // lessons instead of blending them identically every day.
          let lessonNotes = '';
          if (withLessonNotes) {
            const notes = await db.getRecentLessonNotes(env.DB, pendingReader.user_id);
            const formatNote = (n: { raw_text: string; given_at: string | null }) =>
              n.given_at ? `[${n.given_at}]\n${n.raw_text}` : n.raw_text;
            if (anchorLessonNotes && notes.length > 1) {
              const dayNumber = Math.floor(Date.now() / 86_400_000);
              const focus = notes[dayNumber % notes.length];
              const others = notes.filter(n => n !== focus);
              lessonNotes =
                `TODAY'S FOCUS LESSON (anchor the story primarily on this one):\n${formatNote(focus)}` +
                `\n\nOther recent lesson material (weave in where natural):\n${others.map(formatNote).join('\n\n---\n\n')}`;
            } else {
              lessonNotes = notes.map(formatNote).join('\n\n---\n\n');
            }
          }

          // Daily readers also get anti-repetition context (recent story
          // summaries) and a per-day storytelling lens, so a week of stories
          // over the same lesson notes still comes out different.
          let recentStories: string[] | undefined;
          let lens: string | undefined;
          if (anchorLessonNotes) {
            const summaries = await db.getRecentReaderSummaries(env.DB, pendingReader.user_id);
            recentStories = summaries.map(s => {
              const opening = s.first_page_english ? ` — opens: "${s.first_page_english.slice(0, 100)}"` : '';
              return `${s.title_english} (${s.title_chinese})${opening}`;
            });
            lens = getDailyStoryLens();
          }

          // Generate the story using Claude with tool use. Daily readers
          // anchor on the lesson notes when there are any — the tutor's
          // recent material is the story's foundation, due words secondary.
          const story = await generateStory(
            env.ANTHROPIC_API_KEY,
            vocabulary,
            topic,
            difficulty,
            {
              targetVocabulary,
              lessonNotes: lessonNotes || undefined,
              anchorOnLessonNotes: Boolean(anchorLessonNotes && lessonNotes),
              lens,
              recentStories,
            }
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
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error('[Queue] Story generation failed for reader:', readerId, err);
          // Mark as failed with the reason so the frontend can show it, and
          // don't retry (story generation is expensive)
          await db.updateReaderStatus(env.DB, readerId, 'failed', errMsg);
          message.ack(); // Don't retry, mark as failed instead
        }
      }
    } else if (queueName === 'image-generation-queue') {
      // Handle image generation
      for (const message of batch.messages) {
        // Custom-lesson illustrations share this queue; they carry a lessonId
        // instead of a readerId.
        if ('lessonId' in message.body) {
          const { lessonId, sectionIndex, exerciseIndex, imagePrompt } = message.body as CustomLessonImageMessage;
          try {
            const imageKey = await generatePageImage(
              env.GEMINI_API_KEY,
              imagePrompt,
              `lesson-${lessonId}-s${sectionIndex}e${exerciseIndex}`,
              env.AUDIO_BUCKET
            );
            if (imageKey) {
              await db.setCustomLessonExerciseImage(env.DB, lessonId, sectionIndex, exerciseIndex, imageKey);
              console.log('[Queue] Lesson image generated:', lessonId, `s${sectionIndex}e${exerciseIndex}`);
            } else {
              console.error('[Queue] Lesson image generation returned null:', lessonId);
            }
            // The lesson is studyable without its images (text fallback), so
            // a failed image is never retried forever — ack either way.
            message.ack();
          } catch (err) {
            console.error('[Queue] Lesson image generation failed:', lessonId, err);
            message.retry();
          }
          continue;
        }

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

          // Check if all images are done (or reader has been generating too long)
          const reader = await db.getGradedReaderById(env.DB, readerId);
          if (reader) {
            const pagesWithImages = reader.pages.filter(p => p.image_url).length;
            const pagesNeedingImages = reader.pages.filter(p => p.image_prompt).length;
            const readerAge = Date.now() - new Date(reader.created_at).getTime();

            console.log('[Queue] Progress for reader', readerId, ':', pagesWithImages, '/', pagesNeedingImages);

            // Mark ready when all images are done, or give up after 20 min with partial images
            if (pagesWithImages >= pagesNeedingImages || readerAge > 20 * 60 * 1000) {
              await db.updateReaderStatus(env.DB, readerId, 'ready');
              console.log('[Queue] Reader ready:', readerId, pagesWithImages < pagesNeedingImages ? '(partial images - timeout)' : '');
            }
          }

          message.ack();
        } catch (err) {
          console.error('[Queue] Image generation failed for page:', pageId, err);

          // If the reader has been generating for > 20 min, give up and mark ready with partial images
          const reader = await db.getGradedReaderById(env.DB, readerId).catch(() => null);
          if (reader) {
            const readerAge = Date.now() - new Date(reader.created_at).getTime();
            if (readerAge > 20 * 60 * 1000) {
              console.log('[Queue] Reader stuck too long, marking ready with partial images:', readerId);
              await db.updateReaderStatus(env.DB, readerId, 'ready');
              message.ack();
              continue;
            }
          }

          message.retry();
        }
      }
    } else if (queueName === 'quest-generation-queue') {
      // Build a quest world: one Claude call, validated, with up to two repair
      // rounds. Minutes of wall clock, which is exactly why it lives here.
      for (const message of batch.messages) {
        const { questId, goalCount, deckIds } = message.body as QuestGenerationMessage;
        console.log('[Queue] Generating quest world:', questId);

        try {
          const quest = await db.getQuestUnscoped(env.DB, questId);
          if (!quest) {
            console.log('[Queue] Quest gone, skipping', questId);
            message.ack();
            continue;
          }

          const vocabulary = await db
            .getLearnedVocabulary(env.DB, quest.user_id, deckIds?.length ? deckIds : undefined)
            .catch(() => []);
          const userRow = await env.DB.prepare('SELECT bio FROM users WHERE id = ?')
            .bind(quest.user_id)
            .first<{ bio: string | null }>();

          const world = await generateQuestWorld(env.ANTHROPIC_API_KEY, {
            topic: quest.topic,
            difficulty: (quest.difficulty || 'medium') as QuestDifficulty,
            goalCount,
            vocabulary,
            bio: userRow?.bio ?? null,
            onProgress: (stage) => db.setQuestProgress(env.DB, questId, stage),
          });

          const title = world.title.english || world.title.hanzi || 'Quest';
          await db.setQuestWorld(env.DB, questId, title, world);
          console.log('[Queue] Quest ready:', questId, title);
          message.ack();
        } catch (err) {
          console.error('[Queue] Quest generation failed:', questId, err);
          await db.setQuestError(
            env.DB,
            questId,
            err instanceof Error ? err.message : 'Generation failed'
          );
          message.ack(); // The error is recorded; retrying is the learner's call
        }
      }
    } else if (queueName === 'sentence-set-queue') {
      // Pre-generate a note's sentence set so study never waits on the AI
      for (const message of batch.messages) {
        const { noteId, count, kind, sentenceId, force } = message.body as SentenceSetMessage;

        // Same queue, much smaller job: just the TTS for a card's own sentence.
        if (kind === 'clue_audio') {
          const stored = await ensureSentenceClueAudio(env, noteId, { force });
          console.log('[Queue] Clue audio', stored ? 'done' : 'skipped', noteId);
          message.ack();
          continue;
        }

        // Replace a Google-fallback clip with MiniMax. generateTTS returns null
        // rather than falling back, so a rate limit here leaves the old clip in
        // place for the next sweep instead of storing another bad one.
        if (kind === 'note_audio') {
          const replaced = await regenerateNoteAudio(env, noteId);
          console.log('[Queue] Note audio', replaced ? 'replaced' : 'left', noteId);
          message.ack();
          continue;
        }
        if (kind === 'sentence_audio' && sentenceId) {
          const replaced = await regenerateSentenceAudio(env, sentenceId);
          console.log('[Queue] Sentence audio', replaced ? 'replaced' : 'left', sentenceId);
          message.ack();
          continue;
        }

        try {
          const note = await db.getNoteByIdUnscoped(env.DB, noteId);
          if (!note) {
            console.log('[Queue] Sentence set: note gone, skipping', noteId);
            message.ack();
            continue;
          }

          // Someone may have generated it by hand between queueing and now
          const existing = await db.getNoteSentences(env.DB, noteId);
          if (existing.length > 0) {
            await db.markSentenceSetJobDone(env.DB, noteId);
            message.ack();
            continue;
          }

          const bio = await db.getUserBioForNote(env.DB, noteId);
          const generated = await generateSentenceSet(
            env.ANTHROPIC_API_KEY,
            {
              hanzi: note.hanzi,
              pinyin: note.pinyin,
              english: note.english,
              existing: note.sentence_clue ? [note.sentence_clue] : [],
              bio,
            },
            count
          );

          const stored = await db.replaceNoteSentences(
            env.DB,
            noteId,
            generated.map((s) => ({
              hanzi: s.hanzi,
              pinyin: s.pinyin,
              translation: s.translation,
              audioUrl: null,
              focus: s.focus,
              focusNote: s.focusNote,
            }))
          );

          await attachSentenceSetAudio(env, stored);
          // While we're here: the card's own sentence often has no audio
          // either, and this sweep is the one place that visits every note.
          await ensureSentenceClueAudio(env, noteId);
          await db.markSentenceSetJobDone(env.DB, noteId);
          console.log('[Queue] Sentence set done:', noteId, stored.length, 'sentences');
          message.ack();
        } catch (err) {
          console.error('[Queue] Sentence set generation failed for note:', noteId, err);
          await db
            .markSentenceSetJobFailed(
              env.DB,
              noteId,
              err instanceof Error ? err.message : 'Unknown error'
            )
            .catch(() => {});
          // One retry (max_retries = 1); after that the job row's attempt count
          // keeps it out of future prefetch sweeps.
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
