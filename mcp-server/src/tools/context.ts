/**
 * What every tool module gets, plus the small result helpers so the modules
 * read the same way. Tool modules export one `register*Tools(ctx)` function
 * and are called from `ChineseLearningMCPv2.init()`.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ApiClient, ApiError } from '../api.js';
import type { Env } from '../types.js';

export interface ToolContext {
  server: McpServer;
  env: Env;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  /** Authenticated calls to the main API as this user. */
  api: ApiClient;
}

/** A JSON payload as the tool's text content (pretty-printed for the model). */
export function jsonResult(data: unknown, structured?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

export function textResult(text: string, structured?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

export function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Run a tool body and turn thrown errors (API errors included) into an
 * `isError` result with a readable message instead of a protocol failure.
 */
export async function guard(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) {
      const detail =
        err.body && typeof err.body === 'object' && 'problems' in err.body
          ? `\n${JSON.stringify((err.body as { problems: unknown }).problems, null, 2)}`
          : '';
      return errorResult(`${err.message} (HTTP ${err.status})${detail}`);
    }
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}
