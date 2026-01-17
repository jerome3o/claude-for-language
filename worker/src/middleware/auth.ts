import { Context, Next } from 'hono';
import { Env, User } from '../types';
import { parseSessionCookie, getSessionWithUser } from '../services/auth';

// Extend Hono context to include user
declare module 'hono' {
  interface ContextVariableMap {
    user: User;
  }
}

// Routes that don't require authentication
const PUBLIC_ROUTES = [
  '/api/health',
  '/api/auth/login',
  '/api/auth/callback',
  '/api/auth/me', // Returns 401 if not authenticated, which is expected behavior
  '/api/oauth/', // MCP OAuth endpoints
];

function isPublicRoute(path: string): boolean {
  return PUBLIC_ROUTES.some(route => path.startsWith(route));
}

export async function authMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next
): Promise<Response | void> {
  const path = c.req.path;

  // Skip auth for public routes
  if (isPublicRoute(path)) {
    return next();
  }

  // Get session from Authorization header or cookie
  let sessionId: string | null = null;
  const authHeader = c.req.header('Authorization');

  if (authHeader?.startsWith('Bearer ')) {
    sessionId = authHeader.slice(7);
  } else {
    const cookieHeader = c.req.header('Cookie') || null;
    sessionId = parseSessionCookie(cookieHeader);
  }

  if (!sessionId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Validate session and get user
  const result = await getSessionWithUser(c.env.DB, sessionId);

  if (!result) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Attach user to context
  c.set('user', result.user);

  return next();
}

// Middleware for admin-only routes
export async function adminMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next
): Promise<Response | void> {
  const user = c.get('user');

  if (!user || !user.is_admin) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  return next();
}
