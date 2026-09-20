/**
 * Authenticated access to the main API on behalf of the signed-in MCP user.
 *
 * The MCP worker shares the D1 database with the main API, but the business
 * logic (tutor access checks, insights aggregation, deck sharing, lesson
 * assignment, TTS…) lives in the API worker. Rather than re-implement it,
 * tools call the API with a short-lived `auth_sessions` row minted for the
 * user — exactly what the existing TTS path does — and delete it afterwards.
 *
 *   const api = new ApiClient(env, userId);
 *   const students = await api.get<Dashboard>('/api/tutor/dashboard');
 *   await api.post('/api/relationships/rel-1/lesson-log', { lesson_at, notes });
 *
 * Every call mints its own token so a slow tool can never outlive it; the
 * token lives 5 minutes and is removed in `finally`.
 */
import { Env, apiBaseUrl } from './types.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  constructor(private readonly env: Env, private readonly userId: string) {}

  get baseUrl(): string {
    return apiBaseUrl(this.env);
  }

  /** Run `fn` with a temporary session token for this user, then revoke it. */
  async withSession<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    await this.env.DB
      .prepare('INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(token, this.userId, expiresAt)
      .run();
    try {
      return await fn(token);
    } finally {
      try {
        await this.env.DB.prepare('DELETE FROM auth_sessions WHERE id = ?').bind(token).run();
      } catch (e) {
        console.error('[ApiClient] Failed to clean up session token:', e);
      }
    }
  }

  /**
   * Call the API and parse the JSON reply. Throws `ApiError` on a non-2xx
   * status with the server's `error` message when it sent one.
   */
  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | null | undefined>,
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
    }
    return this.withSession(async (token) => {
      const res = await fetch(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      if (!res.ok) {
        const message =
          parsed && typeof parsed === 'object' && 'error' in parsed && typeof (parsed as { error: unknown }).error === 'string'
            ? (parsed as { error: string }).error
            : `${method} ${path} failed with HTTP ${res.status}`;
        throw new ApiError(res.status, message, parsed);
      }
      return parsed as T;
    });
  }

  get<T = unknown>(path: string, query?: Record<string, string | number | boolean | null | undefined>): Promise<T> {
    return this.request<T>('GET', path, undefined, query);
  }

  post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body ?? {});
  }

  put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body ?? {});
  }

  patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body ?? {});
  }

  delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}
