/**
 * Tutor tools: students, their activity, what they find hard, recordings,
 * lesson log, messages, homework decks, invites.
 *
 * Every tool goes through `ctx.api` (the main API as the signed-in tutor), so
 * access checks — "is this user the tutor of this relationship?" — are the
 * API's, never re-implemented here.
 */
import type { ToolContext } from './context.js';

export function registerStudentTools(_ctx: ToolContext): void {
  // Filled in by the students workstream.
}
