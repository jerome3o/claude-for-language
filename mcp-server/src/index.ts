import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import OAuthProvider, {
  OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";

// Types
interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  ENVIRONMENT: string;
  // OAuth KV storage
  OAUTH_KV: KVNamespace;
}

interface User {
  id: string;
  email: string | null;
  google_id: string | null;
  name: string | null;
  picture_url: string | null;
}

interface Deck {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface Note {
  id: string;
  deck_id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  audio_url: string | null;
  fun_facts: string | null;
  created_at: string;
  updated_at: string;
}

// Props passed from OAuth middleware to downstream handlers
interface McpAuthProps {
  userId: string;
  userEmail: string | null;
}

// Utility function to generate IDs
function generateId(): string {
  return crypto.randomUUID();
}

const CARD_TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'] as const;

// Google OAuth handler for user authentication
async function googleAuthHandler(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);

  // Start Google OAuth flow
  if (url.pathname === "/oauth/google/start") {
    const oauthReqInfo = url.searchParams.get("oauthReqInfo");
    if (!oauthReqInfo) {
      return new Response("Missing OAuth request info", { status: 400 });
    }

    const state = btoa(oauthReqInfo);
    const redirectUri = `${url.origin}/oauth/google/callback`;

    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "offline",
      prompt: "consent",
    });

    return Response.redirect(
      `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      302
    );
  }

  // Handle Google OAuth callback
  if (url.pathname === "/oauth/google/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error || !code || !state) {
      return new Response("OAuth failed: " + (error || "missing params"), { status: 400 });
    }

    // Exchange code for tokens
    const redirectUri = `${url.origin}/oauth/google/callback`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      return new Response("Token exchange failed: " + err, { status: 500 });
    }

    const tokens = await tokenResponse.json() as { access_token: string };

    // Get user info from Google
    const userInfoResponse = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } }
    );

    if (!userInfoResponse.ok) {
      return new Response("Failed to get user info", { status: 500 });
    }

    const googleUser = await userInfoResponse.json() as {
      id: string;
      email: string;
      name: string;
      picture: string;
    };

    // Get or create user in database
    let user = await env.DB
      .prepare("SELECT * FROM users WHERE google_id = ?")
      .bind(googleUser.id)
      .first<User>();

    if (!user) {
      // Check by email
      user = await env.DB
        .prepare("SELECT * FROM users WHERE email = ?")
        .bind(googleUser.email)
        .first<User>();

      if (user) {
        // Link Google account
        await env.DB
          .prepare(`
            UPDATE users SET
              google_id = ?,
              name = ?,
              picture_url = ?,
              last_login_at = datetime('now')
            WHERE id = ?
          `)
          .bind(googleUser.id, googleUser.name, googleUser.picture, user.id)
          .run();
      } else {
        // Create new user
        const userId = generateId();
        await env.DB
          .prepare(`
            INSERT INTO users (id, email, google_id, name, picture_url, role, is_admin, last_login_at)
            VALUES (?, ?, ?, ?, ?, 'student', 0, datetime('now'))
          `)
          .bind(userId, googleUser.email, googleUser.id, googleUser.name, googleUser.picture)
          .run();

        user = await env.DB
          .prepare("SELECT * FROM users WHERE id = ?")
          .bind(userId)
          .first<User>();
      }
    } else {
      // Update last login
      await env.DB
        .prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?")
        .bind(user.id)
        .run();
    }

    if (!user) {
      return new Response("Failed to create or get user", { status: 500 });
    }

    // Decode the original OAuth request info
    let oauthReqInfo: string;
    try {
      oauthReqInfo = atob(state);
    } catch {
      return new Response("Invalid state", { status: 400 });
    }

    // Complete the OAuth flow by redirecting back to the OAuth provider
    // with user info
    const completeUrl = new URL("/oauth/authorize/complete", url.origin);
    completeUrl.searchParams.set("oauthReqInfo", oauthReqInfo);
    completeUrl.searchParams.set("userId", user.id);
    completeUrl.searchParams.set("userEmail", user.email || "");

    return Response.redirect(completeUrl.toString(), 302);
  }

  return new Response("Not Found", { status: 404 });
}

// Create MCP server with tools (now receives userId for data isolation)
function createServer(env: Env, userId: string) {
  const server = new McpServer({
    name: "Chinese Learning App",
    version: "1.0.0",
  });

  // ============ Deck Tools ============

  server.tool(
    "list_decks",
    "List all vocabulary decks with their stats",
    {},
    async () => {
      const decks = await env.DB
        .prepare('SELECT * FROM decks WHERE user_id = ? ORDER BY updated_at DESC')
        .bind(userId)
        .all<Deck>();

      const decksWithStats = await Promise.all(
        decks.results.map(async (deck) => {
          const [noteCount, cardsDue, cardsMastered] = await Promise.all([
            env.DB.prepare('SELECT COUNT(*) as count FROM notes WHERE deck_id = ?')
              .bind(deck.id).first<{ count: number }>(),
            env.DB.prepare(
              `SELECT COUNT(*) as count FROM cards c
               JOIN notes n ON c.note_id = n.id
               WHERE n.deck_id = ? AND (c.next_review_at IS NULL OR c.next_review_at <= datetime('now'))`
            ).bind(deck.id).first<{ count: number }>(),
            env.DB.prepare(
              `SELECT COUNT(*) as count FROM cards c
               JOIN notes n ON c.note_id = n.id
               WHERE n.deck_id = ? AND c.interval > 21`
            ).bind(deck.id).first<{ count: number }>(),
          ]);
          return {
            ...deck,
            note_count: noteCount?.count || 0,
            cards_due: cardsDue?.count || 0,
            cards_mastered: cardsMastered?.count || 0,
          };
        })
      );

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(decksWithStats, null, 2),
        }],
      };
    }
  );

  server.tool(
    "get_deck",
    "Get a deck with all its notes",
    { deck_id: z.string().describe("The deck ID") },
    async ({ deck_id }) => {
      const deck = await env.DB
        .prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?')
        .bind(deck_id, userId)
        .first<Deck>();

      if (!deck) {
        return {
          content: [{ type: "text" as const, text: `Deck not found: ${deck_id}` }],
          isError: true,
        };
      }

      const notes = await env.DB
        .prepare('SELECT * FROM notes WHERE deck_id = ? ORDER BY created_at DESC')
        .bind(deck_id)
        .all<Note>();

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ ...deck, notes: notes.results }, null, 2),
        }],
      };
    }
  );

  server.tool(
    "get_deck_progress",
    "Get detailed study progress for a deck including card-level stats",
    { deck_id: z.string().describe("The deck ID") },
    async ({ deck_id }) => {
      const deck = await env.DB
        .prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?')
        .bind(deck_id, userId)
        .first<Deck>();

      if (!deck) {
        return {
          content: [{ type: "text" as const, text: `Deck not found: ${deck_id}` }],
          isError: true,
        };
      }

      const cards = await env.DB
        .prepare(`
          SELECT c.*, n.hanzi, n.pinyin, n.english
          FROM cards c
          JOIN notes n ON c.note_id = n.id
          WHERE n.deck_id = ?
          ORDER BY n.hanzi
        `)
        .bind(deck_id)
        .all();

      const stats = {
        total_cards: cards.results.length,
        new_cards: cards.results.filter((c: any) => c.next_review_at === null).length,
        learning: cards.results.filter((c: any) => c.next_review_at !== null && c.interval <= 1).length,
        reviewing: cards.results.filter((c: any) => c.interval > 1 && c.interval <= 21).length,
        mastered: cards.results.filter((c: any) => c.interval > 21).length,
        due_now: cards.results.filter((c: any) =>
          c.next_review_at === null || new Date(c.next_review_at) <= new Date()
        ).length,
      };

      const noteProgress: Record<string, any> = {};
      for (const card of cards.results as any[]) {
        if (!noteProgress[card.note_id]) {
          noteProgress[card.note_id] = {
            hanzi: card.hanzi,
            pinyin: card.pinyin,
            english: card.english,
            cards: [],
          };
        }
        noteProgress[card.note_id].cards.push({
          card_type: card.card_type,
          ease_factor: card.ease_factor,
          interval: card.interval,
          repetitions: card.repetitions,
          next_review_at: card.next_review_at,
        });
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            deck: { id: deck.id, name: deck.name },
            stats,
            notes: Object.values(noteProgress),
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    "create_deck",
    "Create a new vocabulary deck",
    {
      name: z.string().describe("Name of the deck"),
      description: z.string().optional().describe("Description of the deck"),
    },
    async ({ name, description }) => {
      const id = generateId();
      await env.DB
        .prepare('INSERT INTO decks (id, user_id, name, description) VALUES (?, ?, ?, ?)')
        .bind(id, userId, name, description || null)
        .run();

      const deck = await env.DB
        .prepare('SELECT * FROM decks WHERE id = ?')
        .bind(id)
        .first<Deck>();

      return {
        content: [{
          type: "text" as const,
          text: `Created deck: ${JSON.stringify(deck, null, 2)}`,
        }],
      };
    }
  );

  server.tool(
    "update_deck",
    "Update a deck's name or description",
    {
      deck_id: z.string().describe("The deck ID"),
      name: z.string().optional().describe("New name for the deck"),
      description: z.string().optional().describe("New description for the deck"),
    },
    async ({ deck_id, name, description }) => {
      // Verify ownership
      const existing = await env.DB
        .prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?')
        .bind(deck_id, userId)
        .first<Deck>();

      if (!existing) {
        return {
          content: [{ type: "text" as const, text: `Deck not found: ${deck_id}` }],
          isError: true,
        };
      }

      const updates: string[] = [];
      const values: (string | null)[] = [];

      if (name !== undefined) {
        updates.push('name = ?');
        values.push(name);
      }
      if (description !== undefined) {
        updates.push('description = ?');
        values.push(description);
      }

      if (updates.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No updates provided" }],
          isError: true,
        };
      }

      updates.push("updated_at = datetime('now')");
      values.push(deck_id);

      await env.DB
        .prepare(`UPDATE decks SET ${updates.join(', ')} WHERE id = ?`)
        .bind(...values)
        .run();

      const deck = await env.DB
        .prepare('SELECT * FROM decks WHERE id = ?')
        .bind(deck_id)
        .first<Deck>();

      return {
        content: [{
          type: "text" as const,
          text: `Updated deck: ${JSON.stringify(deck, null, 2)}`,
        }],
      };
    }
  );

  server.tool(
    "delete_deck",
    "Delete a deck and all its notes/cards",
    { deck_id: z.string().describe("The deck ID to delete") },
    async ({ deck_id }) => {
      const deck = await env.DB
        .prepare('SELECT * FROM decks WHERE id = ? AND user_id = ?')
        .bind(deck_id, userId)
        .first<Deck>();

      if (!deck) {
        return {
          content: [{ type: "text" as const, text: `Deck not found: ${deck_id}` }],
          isError: true,
        };
      }

      await env.DB
        .prepare('DELETE FROM decks WHERE id = ?')
        .bind(deck_id)
        .run();

      return {
        content: [{
          type: "text" as const,
          text: `Deleted deck: "${deck.name}" (${deck_id})`,
        }],
      };
    }
  );

  // ============ Note Tools ============

  server.tool(
    "add_note",
    "Add a vocabulary note to a deck (creates 3 cards automatically)",
    {
      deck_id: z.string().describe("The deck ID"),
      hanzi: z.string().describe("Chinese characters (simplified)"),
      pinyin: z.string().describe("Pinyin with tone marks (e.g., nǐ hǎo)"),
      english: z.string().describe("English translation"),
      fun_facts: z.string().optional().describe("Cultural notes, memory aids, etc."),
    },
    async ({ deck_id, hanzi, pinyin, english, fun_facts }) => {
      const deck = await env.DB
        .prepare('SELECT id FROM decks WHERE id = ? AND user_id = ?')
        .bind(deck_id, userId)
        .first();

      if (!deck) {
        return {
          content: [{ type: "text" as const, text: `Deck not found: ${deck_id}` }],
          isError: true,
        };
      }

      const noteId = generateId();

      await env.DB
        .prepare(
          'INSERT INTO notes (id, deck_id, hanzi, pinyin, english, fun_facts) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .bind(noteId, deck_id, hanzi, pinyin, english, fun_facts || null)
        .run();

      for (const cardType of CARD_TYPES) {
        const cardId = generateId();
        await env.DB
          .prepare('INSERT INTO cards (id, note_id, card_type) VALUES (?, ?, ?)')
          .bind(cardId, noteId, cardType)
          .run();
      }

      await env.DB
        .prepare("UPDATE decks SET updated_at = datetime('now') WHERE id = ?")
        .bind(deck_id)
        .run();

      // Generate TTS audio via main API
      let audioGenerated = false;
      try {
        const apiUrl = env.ENVIRONMENT === 'production'
          ? 'https://chinese-learning-api.jeromeswannack.workers.dev'
          : 'http://localhost:8787';
        const audioResponse = await fetch(`${apiUrl}/api/notes/${noteId}/generate-audio`, {
          method: 'POST',
        });
        audioGenerated = audioResponse.ok;
      } catch (e) {
        console.error('Failed to generate audio:', e);
      }

      return {
        content: [{
          type: "text" as const,
          text: `Added note: ${hanzi} (${pinyin}) - ${english}${audioGenerated ? ' (with audio)' : ' (audio generation pending)'}`,
        }],
      };
    }
  );

  server.tool(
    "update_note",
    "Update an existing note",
    {
      note_id: z.string().describe("The note ID"),
      hanzi: z.string().optional().describe("New Chinese characters"),
      pinyin: z.string().optional().describe("New pinyin"),
      english: z.string().optional().describe("New English translation"),
      fun_facts: z.string().optional().describe("New fun facts/notes"),
    },
    async ({ note_id, hanzi, pinyin, english, fun_facts }) => {
      // Verify ownership via deck
      const note = await env.DB
        .prepare(`
          SELECT n.* FROM notes n
          JOIN decks d ON n.deck_id = d.id
          WHERE n.id = ? AND d.user_id = ?
        `)
        .bind(note_id, userId)
        .first<Note>();

      if (!note) {
        return {
          content: [{ type: "text" as const, text: `Note not found: ${note_id}` }],
          isError: true,
        };
      }

      const updates: string[] = [];
      const values: (string | null)[] = [];

      if (hanzi !== undefined) {
        updates.push('hanzi = ?');
        values.push(hanzi);
      }
      if (pinyin !== undefined) {
        updates.push('pinyin = ?');
        values.push(pinyin);
      }
      if (english !== undefined) {
        updates.push('english = ?');
        values.push(english);
      }
      if (fun_facts !== undefined) {
        updates.push('fun_facts = ?');
        values.push(fun_facts);
      }

      if (updates.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No updates provided" }],
          isError: true,
        };
      }

      updates.push("updated_at = datetime('now')");
      values.push(note_id);

      await env.DB
        .prepare(`UPDATE notes SET ${updates.join(', ')} WHERE id = ?`)
        .bind(...values)
        .run();

      await env.DB
        .prepare("UPDATE decks SET updated_at = datetime('now') WHERE id = ?")
        .bind(note.deck_id)
        .run();

      const updatedNote = await env.DB
        .prepare('SELECT * FROM notes WHERE id = ?')
        .bind(note_id)
        .first<Note>();

      return {
        content: [{
          type: "text" as const,
          text: `Updated note: ${JSON.stringify(updatedNote, null, 2)}`,
        }],
      };
    }
  );

  server.tool(
    "delete_note",
    "Delete a note and its cards",
    { note_id: z.string().describe("The note ID to delete") },
    async ({ note_id }) => {
      const note = await env.DB
        .prepare(`
          SELECT n.* FROM notes n
          JOIN decks d ON n.deck_id = d.id
          WHERE n.id = ? AND d.user_id = ?
        `)
        .bind(note_id, userId)
        .first<Note>();

      if (!note) {
        return {
          content: [{ type: "text" as const, text: `Note not found: ${note_id}` }],
          isError: true,
        };
      }

      await env.DB
        .prepare('DELETE FROM notes WHERE id = ?')
        .bind(note_id)
        .run();

      await env.DB
        .prepare("UPDATE decks SET updated_at = datetime('now') WHERE id = ?")
        .bind(note.deck_id)
        .run();

      return {
        content: [{
          type: "text" as const,
          text: `Deleted note: ${note.hanzi} (${note.pinyin})`,
        }],
      };
    }
  );

  // ============ History Tools ============

  server.tool(
    "get_note_history",
    "Get review history for a note including all card types, ratings, and recordings",
    { note_id: z.string().describe("The note ID") },
    async ({ note_id }) => {
      const note = await env.DB
        .prepare(`
          SELECT n.* FROM notes n
          JOIN decks d ON n.deck_id = d.id
          WHERE n.id = ? AND d.user_id = ?
        `)
        .bind(note_id, userId)
        .first<Note>();

      if (!note) {
        return {
          content: [{ type: "text" as const, text: `Note not found: ${note_id}` }],
          isError: true,
        };
      }

      const reviews = await env.DB
        .prepare(`
          SELECT cr.id, cr.rating, cr.time_spent_ms, cr.user_answer, cr.recording_url, cr.reviewed_at, c.card_type
          FROM card_reviews cr
          JOIN cards c ON cr.card_id = c.id
          WHERE c.note_id = ?
          ORDER BY cr.reviewed_at DESC
        `)
        .bind(note_id)
        .all<{
          id: string;
          rating: number;
          time_spent_ms: number | null;
          user_answer: string | null;
          recording_url: string | null;
          reviewed_at: string;
          card_type: string;
        }>();

      const ratingLabels = ['Again', 'Hard', 'Good', 'Easy'];
      const byCardType: Record<string, any[]> = {};

      for (const review of reviews.results) {
        if (!byCardType[review.card_type]) {
          byCardType[review.card_type] = [];
        }
        byCardType[review.card_type].push({
          reviewed_at: review.reviewed_at,
          rating: ratingLabels[review.rating] || review.rating,
          time_spent_ms: review.time_spent_ms,
          user_answer: review.user_answer,
          has_recording: !!review.recording_url,
        });
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            note: { hanzi: note.hanzi, pinyin: note.pinyin, english: note.english },
            total_reviews: reviews.results.length,
            history_by_card_type: byCardType,
          }, null, 2),
        }],
      };
    }
  );

  // ============ Study Tools ============

  server.tool(
    "get_due_cards",
    "Get cards that are due for review",
    {
      deck_id: z.string().optional().describe("Filter by deck ID (optional)"),
      limit: z.number().optional().describe("Maximum number of cards (default 20)"),
    },
    async ({ deck_id, limit = 20 }) => {
      let query = `
        SELECT c.*, n.hanzi, n.pinyin, n.english, n.fun_facts, n.deck_id
        FROM cards c
        JOIN notes n ON c.note_id = n.id
        JOIN decks d ON n.deck_id = d.id
        WHERE d.user_id = ? AND (c.next_review_at IS NULL OR c.next_review_at <= datetime('now'))
      `;

      const params: (string | number)[] = [userId];

      if (deck_id) {
        query += ' AND n.deck_id = ?';
        params.push(deck_id);
      }

      query += ' ORDER BY c.next_review_at ASC NULLS LAST LIMIT ?';
      params.push(limit);

      const result = await env.DB
        .prepare(query)
        .bind(...params)
        .all();

      const cards = result.results.map((row: any) => ({
        card_id: row.id,
        card_type: row.card_type,
        hanzi: row.hanzi,
        pinyin: row.pinyin,
        english: row.english,
        fun_facts: row.fun_facts,
        ease_factor: row.ease_factor,
        interval: row.interval,
        repetitions: row.repetitions,
        next_review_at: row.next_review_at,
      }));

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            count: cards.length,
            cards,
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    "get_overall_stats",
    "Get overall study statistics",
    {},
    async () => {
      const [totalCards, cardsDue, studiedToday, totalDecks] = await Promise.all([
        env.DB.prepare(`
          SELECT COUNT(*) as count FROM cards c
          JOIN notes n ON c.note_id = n.id
          JOIN decks d ON n.deck_id = d.id
          WHERE d.user_id = ?
        `).bind(userId).first<{ count: number }>(),
        env.DB.prepare(`
          SELECT COUNT(*) as count FROM cards c
          JOIN notes n ON c.note_id = n.id
          JOIN decks d ON n.deck_id = d.id
          WHERE d.user_id = ? AND (c.next_review_at IS NULL OR c.next_review_at <= datetime('now'))
        `).bind(userId).first<{ count: number }>(),
        env.DB.prepare(`
          SELECT COUNT(*) as count FROM card_reviews cr
          JOIN study_sessions ss ON cr.session_id = ss.id
          WHERE ss.user_id = ? AND date(cr.reviewed_at) = date('now')
        `).bind(userId).first<{ count: number }>(),
        env.DB.prepare('SELECT COUNT(*) as count FROM decks WHERE user_id = ?')
          .bind(userId).first<{ count: number }>(),
      ]);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            total_decks: totalDecks?.count || 0,
            total_cards: totalCards?.count || 0,
            cards_due_today: cardsDue?.count || 0,
            cards_studied_today: studiedToday?.count || 0,
          }, null, 2),
        }],
      };
    }
  );

  return server;
}

// MCP request handler (with user context from OAuth)
async function handleMcpRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  props: McpAuthProps
): Promise<Response> {
  const server = createServer(env, props.userId);
  const { createMcpHandler } = await import("agents/mcp");
  return createMcpHandler(server)(request, env, ctx);
}

// Worker entry point using OAuth provider
export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler: handleMcpRequest,
  defaultHandler: async (request: Request, env: Env, ctx: ExecutionContext) => {
    const url = new URL(request.url);

    // Handle Google OAuth flows
    if (url.pathname.startsWith("/oauth/google/")) {
      return googleAuthHandler(request, env, ctx);
    }

    // Health check
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(JSON.stringify({
        status: "ok",
        name: "Chinese Learning MCP Server",
        version: "1.0.0",
        transport: "Streamable HTTP with OAuth 2.1",
        endpoint: "/mcp",
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
  authorizeEndpoint: "/oauth/authorize",
  tokenEndpoint: "/oauth/token",
  clientRegistrationEndpoint: "/oauth/register",
  // Use Google as upstream identity provider
  // Users will be redirected to /oauth/google/start for authentication
});
