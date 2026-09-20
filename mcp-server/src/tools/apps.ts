/**
 * Interactive MCP Apps for tutors (students dashboard, reader / lesson / deck
 * review) and the app-only tools their UIs call back into.
 *
 * Each app is a self-contained HTML bundle built by `scripts/build-apps.mjs`
 * from `src/ui/apps/<name>/` and served as a `ui://` resource from
 * `APP_HTML[name]` (see `app-html.ts`). Register the resource with
 * `registerApp(ctx, name)` and give the tool `_meta.ui.resourceUri` the
 * returned URI.
 */
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { APP_HTML } from '../app-html.js';
import type { ToolContext } from './context.js';

/**
 * ext-apps resolves its own copy of the MCP SDK types from the root
 * node_modules, so `McpServer` is structurally "different" to the compiler
 * although it is the same class at runtime. Adapt at the boundary once.
 */
export function appServer(server: McpServer): Parameters<typeof registerAppTool>[0] & Parameters<typeof registerAppResource>[0] {
  return server as unknown as Parameters<typeof registerAppTool>[0] & Parameters<typeof registerAppResource>[0];
}

/** Register the HTML resource for a built app and return its `ui://` URI. */
export function registerApp(ctx: ToolContext, name: string): string {
  const html = APP_HTML[name];
  if (!html) {
    throw new Error(`MCP app "${name}" is not built — add src/ui/apps/${name}/index.html and run npm run build:ui`);
  }
  const uri = `ui://${name}/mcp-app.html`;
  registerAppResource(appServer(ctx.server), uri, uri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: html }],
  }));
  return uri;
}

export function registerTutorApps(_ctx: ToolContext): void {
  // Filled in by the apps workstream.
}
