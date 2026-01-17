import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Types
interface Env {
  DB: D1Database;
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

// Utility function to generate IDs
function generateId(): string {
  return crypto.randomUUID();
}

const CARD_TYPES = ['hanzi_to_meaning', 'meaning_to_hanzi', 'audio_to_hanzi'] as const;

// Create MCP server with tools
function createServer(env: Env) {
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
        .prepare('SELECT * FROM decks ORDER BY updated_at DESC')
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
        .prepare('SELECT * FROM decks WHERE id = ?')
        .bind(deck_id)
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
        .prepare('SELECT * FROM decks WHERE id = ?')
        .bind(deck_id)
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
        .prepare('INSERT INTO decks (id, name, description) VALUES (?, ?, ?)')
        .bind(id, name, description || null)
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
        .prepare('SELECT * FROM decks WHERE id = ?')
        .bind(deck_id)
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
        .prepare('SELECT id FROM decks WHERE id = ?')
        .bind(deck_id)
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

      return {
        content: [{
          type: "text" as const,
          text: `Added note: ${hanzi} (${pinyin}) - ${english}`,
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

      const note = await env.DB
        .prepare('SELECT * FROM notes WHERE id = ?')
        .bind(note_id)
        .first<Note>();

      if (note) {
        await env.DB
          .prepare("UPDATE decks SET updated_at = datetime('now') WHERE id = ?")
          .bind(note.deck_id)
          .run();
      }

      return {
        content: [{
          type: "text" as const,
          text: `Updated note: ${JSON.stringify(note, null, 2)}`,
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
        .prepare('SELECT * FROM notes WHERE id = ?')
        .bind(note_id)
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
        WHERE (c.next_review_at IS NULL OR c.next_review_at <= datetime('now'))
      `;

      const params: (string | number)[] = [];

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
        env.DB.prepare('SELECT COUNT(*) as count FROM cards').first<{ count: number }>(),
        env.DB.prepare(
          "SELECT COUNT(*) as count FROM cards WHERE next_review_at IS NULL OR next_review_at <= datetime('now')"
        ).first<{ count: number }>(),
        env.DB.prepare(
          "SELECT COUNT(*) as count FROM card_reviews WHERE date(reviewed_at) = date('now')"
        ).first<{ count: number }>(),
        env.DB.prepare('SELECT COUNT(*) as count FROM decks').first<{ count: number }>(),
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

// Worker entry point using Streamable HTTP transport
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle MCP endpoint with Streamable HTTP
    if (url.pathname === "/mcp" || url.pathname === "/mcp/") {
      const server = createServer(env);

      // Import and use the streamable HTTP handler
      const { createMcpHandler } = await import("agents/mcp");
      return createMcpHandler(server)(request, env, ctx);
    }

    // Health check
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(JSON.stringify({
        status: "ok",
        name: "Chinese Learning MCP Server",
        version: "1.0.0",
        transport: "Streamable HTTP",
        endpoint: "/mcp",
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};
