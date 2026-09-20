/**
 * Interactive MCP Apps for tutors (students dashboard, reader / lesson / deck
 * review) and the app-only tools their UIs call back into.
 *
 * Each app is a self-contained HTML bundle built by `scripts/build-apps.mjs`
 * from `src/ui/apps/<name>/` and served as a `ui://` resource from
 * `APP_HTML[name]` (see `app-html.ts`). Register the resource with
 * `registerApp(ctx, name)` and give the tool `_meta.ui.resourceUri` the
 * returned URI. The apps themselves live in `./apps/`:
 *
 *   students-dashboard.ts  open_students_dashboard + app_student_detail,
 *                          app_log_lesson, app_send_message, app_mark_recording,
 *                          app_refresh_dashboard
 *   reader.ts              review_reader + app_save_reader_spec, app_share_reader
 *   lesson.ts              review_lesson + app_save_library_lesson, app_save_lesson,
 *                          app_assign_lesson, app_push_lesson_update
 *   deck.ts                review_deck + app_update_note, app_add_note,
 *                          app_delete_note, app_share_deck, app_update_shared_deck
 *
 * App-only tools carry the `app_` prefix and `_meta.ui.visibility: ['app']`,
 * so the model never sees them and they cannot collide with the model-facing
 * tutor tools in students.ts / content.ts.
 */
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { APP_HTML } from '../app-html.js';
import { apiBaseUrl } from '../types.js';
import type { ToolContext } from './context.js';
import { registerDeckApp } from './apps/deck.js';
import { registerLessonApp } from './apps/lesson.js';
import { registerReaderApp } from './apps/reader.js';
import { registerStudentsDashboardApp } from './apps/students-dashboard.js';

/**
 * ext-apps resolves its own copy of the MCP SDK types from the root
 * node_modules, so `McpServer` is structurally "different" to the compiler
 * although it is the same class at runtime. Adapt at the boundary once.
 */
export function appServer(server: McpServer): Parameters<typeof registerAppTool>[0] & Parameters<typeof registerAppResource>[0] {
  return server as unknown as Parameters<typeof registerAppTool>[0] & Parameters<typeof registerAppResource>[0];
}

/**
 * Register the HTML resource for a built app and return its `ui://` URI.
 * The CSP metadata lets the sandboxed page load illustrations and recordings
 * from the API's public `/api/audio/*` route.
 */
export function registerApp(ctx: ToolContext, name: string): string {
  const html = APP_HTML[name];
  if (!html) {
    throw new Error(`MCP app "${name}" is not built — add src/ui/apps/${name}/index.html and run npm run build:ui`);
  }
  const uri = `ui://${name}/mcp-app.html`;
  const apiOrigin = new URL(apiBaseUrl(ctx.env)).origin;
  registerAppResource(
    appServer(ctx.server),
    uri,
    uri,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: { ui: { csp: { resourceDomains: [apiOrigin], connectDomains: [apiOrigin] }, prefersBorder: true } },
    },
    async () => ({
      contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: html }],
    }),
  );
  return uri;
}

export function registerTutorApps(ctx: ToolContext): void {
  registerStudentsDashboardApp(ctx);
  registerReaderApp(ctx);
  registerLessonApp(ctx);
  registerDeckApp(ctx);
}
