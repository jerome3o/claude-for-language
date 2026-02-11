import { vi } from 'vitest';

/**
 * A mock D1Database that lets tests configure responses for specific queries.
 *
 * Usage:
 *   const db = createMockD1();
 *   db.addResult('SELECT * FROM users WHERE id = ?', { id: 'u1', name: 'Alice' });
 *   // Now calling db.prepare('SELECT...').bind('u1').first() returns that object
 */

interface MockResult {
  /** Pattern to match against the SQL query (substring match, trimmed) */
  pattern: string;
  /** The result to return. For first() calls, return the object. For all() calls, wrap in results array. */
  result: any;
  /** If true, calling this query throws an error instead */
  error?: string;
  /** How many times this result can be used. -1 = unlimited. Default: -1 */
  uses?: number;
}

export interface MockD1Database extends D1Database {
  /** Add a result that will be returned when a query matching the pattern is executed */
  addResult(pattern: string, result: any): void;
  /** Add a result that is consumed after one use (for sequential calls with same pattern) */
  addResultOnce(pattern: string, result: any): void;
  /** Add a result for .all() calls (wraps in { results: [...] } automatically) */
  addAllResult(pattern: string, results: any[]): void;
  /** Add a result for .run() calls */
  addRunResult(pattern: string): void;
  /** Make a query throw an error */
  addError(pattern: string, errorMessage: string): void;
  /** Get all queries that were executed, with their bound parameters */
  getQueries(): Array<{ sql: string; params: any[] }>;
  /** Clear all configured results and query history */
  reset(): void;
}

export function createMockD1(): MockD1Database {
  const results: MockResult[] = [];
  const queries: Array<{ sql: string; params: any[] }> = [];

  function findResult(sql: string): MockResult | undefined {
    const normalizedSql = sql.replace(/\s+/g, ' ').trim();
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const normalizedPattern = r.pattern.replace(/\s+/g, ' ').trim();
      if (normalizedSql.includes(normalizedPattern)) {
        if (r.uses !== undefined && r.uses !== -1) {
          r.uses--;
          if (r.uses <= 0) {
            results.splice(i, 1);
          }
        }
        return r;
      }
    }
    return undefined;
  }

  function createStatement(sql: string): D1PreparedStatement {
    let boundParams: any[] = [];

    const stmt: D1PreparedStatement = {
      bind(...params: any[]) {
        boundParams = params;
        return stmt;
      },
      async first<T = any>(column?: string): Promise<T | null> {
        queries.push({ sql, params: boundParams });
        const match = findResult(sql);
        if (match?.error) throw new Error(match.error);
        if (!match) return null;
        if (column && match.result) return match.result[column];
        return match.result as T;
      },
      async all<T = any>(): Promise<D1Result<T>> {
        queries.push({ sql, params: boundParams });
        const match = findResult(sql);
        if (match?.error) throw new Error(match.error);
        const resultData = match?.result ?? { results: [] };
        // If result is already in D1Result format, return as-is
        if (resultData.results !== undefined) return resultData;
        // Otherwise wrap
        return { results: Array.isArray(resultData) ? resultData : [resultData], success: true, meta: {} } as any;
      },
      async run(): Promise<D1Result> {
        queries.push({ sql, params: boundParams });
        const match = findResult(sql);
        if (match?.error) throw new Error(match.error);
        return { results: [], success: true, meta: {} } as any;
      },
      async raw<T = any>(): Promise<T[]> {
        queries.push({ sql, params: boundParams });
        return [];
      },
    };

    return stmt;
  }

  const db = {
    prepare(sql: string): D1PreparedStatement {
      return createStatement(sql);
    },
    async dump(): Promise<ArrayBuffer> {
      return new ArrayBuffer(0);
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      return [];
    },
    async exec(query: string): Promise<D1ExecResult> {
      return { count: 0, duration: 0 };
    },

    // Test helper methods
    addResult(pattern: string, result: any) {
      results.push({ pattern, result, uses: -1 });
    },
    addResultOnce(pattern: string, result: any) {
      results.push({ pattern, result, uses: 1 });
    },
    addAllResult(pattern: string, resultArray: any[]) {
      results.push({ pattern, result: { results: resultArray }, uses: -1 });
    },
    addRunResult(pattern: string) {
      results.push({ pattern, result: null, uses: -1 });
    },
    addError(pattern: string, errorMessage: string) {
      results.push({ pattern, result: null, error: errorMessage, uses: -1 });
    },
    getQueries() {
      return [...queries];
    },
    reset() {
      results.length = 0;
      queries.length = 0;
    },
  } as MockD1Database;

  return db;
}

// Common test data factories

export function createTestUser(overrides: Partial<{
  id: string;
  email: string;
  name: string;
  picture_url: string | null;
  google_id: string | null;
  role: string;
  is_admin: number;
  last_login_at: string | null;
  created_at: string;
}> = {}) {
  return {
    id: overrides.id ?? 'user-1',
    email: overrides.email ?? 'user1@test.com',
    google_id: overrides.google_id ?? 'google-1',
    name: overrides.name ?? 'Test User',
    picture_url: overrides.picture_url ?? null,
    role: overrides.role ?? 'student',
    is_admin: overrides.is_admin ?? 0,
    last_login_at: overrides.last_login_at ?? null,
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
  };
}

export function createTestRelationship(overrides: Partial<{
  id: string;
  requester_id: string;
  recipient_id: string;
  requester_role: string;
  status: string;
  created_at: string;
  accepted_at: string | null;
}> = {}) {
  return {
    id: overrides.id ?? 'rel-1',
    requester_id: overrides.requester_id ?? 'user-1',
    recipient_id: overrides.recipient_id ?? 'user-2',
    requester_role: overrides.requester_role ?? 'tutor',
    status: overrides.status ?? 'active',
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
    accepted_at: overrides.accepted_at ?? '2026-01-01T00:00:00Z',
  };
}

export function createTestDeck(overrides: Partial<{
  id: string;
  user_id: string;
  name: string;
  description: string | null;
}> = {}) {
  return {
    id: overrides.id ?? 'deck-1',
    user_id: overrides.user_id ?? 'user-1',
    name: overrides.name ?? 'Test Deck',
    description: overrides.description ?? null,
    new_cards_per_day: 30,
    learning_steps: '1 10',
    graduating_interval: 1,
    easy_interval: 4,
    relearning_steps: '10',
    starting_ease: 250,
    minimum_ease: 130,
    maximum_ease: 300,
    interval_modifier: 100,
    hard_multiplier: 120,
    easy_bonus: 130,
    request_retention: 0.9,
    fsrs_weights: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

export function createTestNote(overrides: Partial<{
  id: string;
  deck_id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  audio_url: string | null;
  fun_facts: string | null;
}> = {}) {
  return {
    id: overrides.id ?? 'note-1',
    deck_id: overrides.deck_id ?? 'deck-1',
    hanzi: overrides.hanzi ?? '你好',
    pinyin: overrides.pinyin ?? 'nǐ hǎo',
    english: overrides.english ?? 'hello',
    audio_url: overrides.audio_url ?? null,
    audio_provider: null,
    fun_facts: overrides.fun_facts ?? null,
    context: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

export function createTestConversation(overrides: Partial<{
  id: string;
  relationship_id: string;
  title: string | null;
  created_at: string;
  last_message_at: string | null;
  scenario: string | null;
  user_role: string | null;
  ai_role: string | null;
  is_ai_conversation: number;
  voice_id: string | null;
  voice_speed: number | null;
}> = {}) {
  return {
    id: overrides.id ?? 'conv-1',
    relationship_id: overrides.relationship_id ?? 'rel-1',
    title: overrides.title ?? null,
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
    last_message_at: overrides.last_message_at ?? null,
    scenario: overrides.scenario ?? null,
    user_role: overrides.user_role ?? null,
    ai_role: overrides.ai_role ?? null,
    is_ai_conversation: overrides.is_ai_conversation ?? 0,
    voice_id: overrides.voice_id ?? null,
    voice_speed: overrides.voice_speed ?? null,
  };
}
