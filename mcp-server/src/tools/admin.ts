/**
 * Admin tools: inspect accounts (decks incl. deleted ones, shares, sync state),
 * set a role, toggle can-invite, handle access requests, delete an account.
 *
 * Every tool calls the main API as the signed-in user; the API's
 * adminMiddleware decides (403 for anyone who is not an admin), so nothing
 * here re-checks. Endpoints: worker/src/routes/admin.ts, routes/invites.ts,
 * GET /api/admin/users in worker/src/index.ts.
 */
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { errorResult, guard, jsonResult } from './context.js';

const USER = z
  .string()
  .min(1)
  .describe('The account: a user id or its email address (case-insensitive).');

const u = (ref: string) => `/api/admin/users/${encodeURIComponent(ref.trim())}`;

interface AdminUserRow {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  is_admin: boolean;
  can_invite: boolean;
  created_at: string;
  last_login_at: string | null;
  last_opened_at?: string | null;
  install_kind?: string | null;
  deck_count: number;
  note_count: number;
  review_count: number;
}

export function registerAdminTools(ctx: ToolContext): void {
  const { server, api } = ctx;

  server.tool(
    'admin_list_users',
    'ADMIN ONLY (403 otherwise). Every account: id, email, name, role (student | tutor), is_admin, can_invite, created / last login / last opened, install kind (pwa | android | browser) and deck / note / review counts. `query` filters by email or name.',
    { query: z.string().optional().describe('Case-insensitive substring of the email or name.') },
    async ({ query }) =>
      guard(async () => {
        const users = await api.get<AdminUserRow[]>('/api/admin/users');
        const q = query?.trim().toLowerCase();
        const rows = q ? users.filter((x) => `${x.email ?? ''} ${x.name ?? ''}`.toLowerCase().includes(q)) : users;
        return jsonResult({ count: rows.length, users: rows });
      })
  );

  server.tool(
    'admin_get_user',
    'ADMIN ONLY. Debug one account: profile (role, admin, can_invite, landing page, daily budget), counts (decks, notes, reviews + last review, readers, lessons, deleted decks / notes), sync state (install kind, cached audio clips, last opened, last review-event sync, active sessions, MCP tokens), relationships from THIS user\'s side (`my_role` tutor | student, the other person), recent feature requests (with screenshot paths), and `decks` — the same as admin_inspect_user_decks.',
    { user: USER },
    async ({ user }) => guard(async () => jsonResult(await api.get(`${u(user)}/inspect`)))
  );

  server.tool(
    'admin_inspect_user_decks',
    'ADMIN ONLY. A user\'s decks for debugging sync / "I deleted it and it is still there": live decks (note counts, queue priority, created / updated), `deleted_decks` (tombstones in deleted_items with when, plus a name hint from a surviving student copy), `shares_sent` / `shares_received` (tutor → student deck copies with whether each side still exists) and `untombstoned_deleted_sources` (decks the user deleted BEFORE tombstones existed — 23 Sep 2026 — which old devices only drop through the live_deck_ids reconcile in /api/sync/changes).',
    { user: USER },
    async ({ user }) => guard(async () => jsonResult(await api.get(`${u(user)}/decks`)))
  );

  server.tool(
    'admin_set_role',
    'ADMIN ONLY. Set an account\'s role. `tutor` gives the tutor-first app: Students · Decks · Library · More tabs, opens on Students, no study nagging (streaks, "Study today\'s cards", student onboarding), and "Try it" previews of decks and lessons that record nothing. `student` is the default learner app.',
    { user: USER, role: z.enum(['student', 'tutor']) },
    async ({ user, role }) => guard(async () => jsonResult(await api.put(`${u(user)}/role`, { role })))
  );

  server.tool(
    'admin_set_can_invite',
    'ADMIN ONLY. Allow or stop an account creating invite links for new people (admins always can).',
    { user: USER, can_invite: z.boolean() },
    async ({ user, can_invite }) =>
      guard(async () => {
        const target = await api.get<{ user: { id: string } }>(`${u(user)}/inspect`);
        return jsonResult(await api.put(`/api/admin/users/${encodeURIComponent(target.user.id)}/can-invite`, { can_invite }));
      })
  );

  server.tool(
    'admin_set_user_voice_gender',
    'ADMIN ONLY. Set the voice an account\'s chat messages are read aloud in: `male` → the listener\'s male conversation voice, `female` → their female voice, `other` or null → the app\'s usual voice (the same choice the person makes in Profile → "Your voice when your messages are read aloud").',
    { user: USER, voice_gender: z.enum(['male', 'female', 'other']).nullable() },
    async ({ user, voice_gender }) => guard(async () => jsonResult(await api.put(`${u(user)}/voice-gender`, { voice_gender })))
  );

  server.tool(
    'admin_preview_delete_user',
    'ADMIN ONLY. What deleting this account would remove (decks, notes, cards, review events, recordings, readers, lessons, relationships, conversations, messages, calls, sessions…), what stays (the user\'s deck / reader copies already in students\' accounts, lessons assigned to others) and how many R2 objects only this user uses. `blockers` lists why it cannot be deleted (own account, admin, ADMIN_EMAIL, system user). Always show this to the human before admin_delete_user.',
    { user: USER },
    async ({ user }) => guard(async () => jsonResult(await api.get(`${u(user)}/deletion-preview`)))
  );

  server.tool(
    'admin_delete_user',
    'ADMIN ONLY. PERMANENTLY delete an account and everything it owns — cannot be undone. Students\' copies of this user\'s decks / readers / lessons are kept. Call admin_preview_delete_user first, show the human what will go, and only proceed when they explicitly ask. `confirm_email` must be the account\'s email, typed exactly (case-insensitive).',
    { user: USER, confirm_email: z.string().min(3).describe('The account\'s email address, as confirmation.') },
    async ({ user, confirm_email }) =>
      guard(async () => {
        if (!confirm_email.includes('@')) return errorResult('confirm_email must be the account\'s email address.');
        return jsonResult(await api.delete(u(user), { confirm_email }));
      })
  );

  server.tool(
    'admin_list_access_requests',
    'ADMIN ONLY. People who tried to sign in without an invite (email, name, attempts, first / last seen, status). Default pending.',
    { status: z.enum(['pending', 'approved', 'dismissed', 'all']).optional() },
    async ({ status }) =>
      guard(async () => jsonResult(await api.get('/api/admin/access-requests', { status: status ?? 'pending' })))
  );

  server.tool(
    'admin_handle_access_request',
    'ADMIN ONLY. `approve` creates an email-bound invite so the person gets in the next time they sign in with Google; `dismiss` hides the request.',
    { request_id: z.string().min(1), action: z.enum(['approve', 'dismiss']) },
    async ({ request_id, action }) =>
      guard(async () => jsonResult(await api.post(`/api/admin/access-requests/${encodeURIComponent(request_id)}/${action}`)))
  );

  // ---------- Audio backfill (docs/AUDIO.md; worker/src/routes/audio-backfill.ts) ----------

  server.tool(
    'audio_backfill_status',
    'ADMIN ONLY. Read-only state of the TTS audio pipeline. `providers`: per TTS provider (minimax, azure, google) whether it is configured (missing secret names), enabled, available, its account problem, learned RPM / cap, last success, last error and last-hour counts; `stored_clips`: the effective stored-clip order, the first provider, whether it is unavailable, which providers\' clips count as current (audio_settings_get / audio_settings_update change these). `account_problem`: null when MiniMax answers normally, else { code (e.g. 2053 insufficient credit, 1004 / 2049 bad key), message, since, paused_until, errors_in_a_row, probing } — every MiniMax call is paused (5 → 60 min, a probe call after each pause) and no clip loses attempts; `clips_waiting_on_account_errors`; `account` (MiniMax has no balance API for pay-as-you-go keys, so balance is null). Then: current settings (MiniMax model, voice, speed), the backlog of stored clips by kind (word / card sentence / sentence set) and state (current, missing, Google-made, old voice/model, waiting to retry), clips by provider / model / voice, recent failures, the MiniMax rate limiter (the LEARNED RPM — adaptive, starts at 8/min, ×1.25 (≥ +2) per clean busy minute, halves on a 1002 — with its cap, last_rate_limited_at and recent changes; night mode, tokens, last-hour calls by priority, rate-limited count, whether the backfill pump is running), measured throughput (clips/min), an ETA for the whole backlog, and eta_at_learned_rpm (the ETA at the batch share of the learned rate).',
    {},
    async () => guard(async () => jsonResult(await api.get('/api/admin/audio/backfill')))
  );

  server.tool(
    'audio_backfill_run',
    'ADMIN ONLY. Kick the audio backfill: starts the pump (a no-op when one is running). With `limit`, also queues the next `limit` clips of the backlog (priority order, ≤ 500) right away. Everything still goes through the shared MiniMax rate limiter.',
    { limit: z.number().int().min(0).max(500).optional().describe('Also queue this many backlog clips now (default 0 = just the pump).') },
    async ({ limit }) => guard(async () => jsonResult(await api.post('/api/admin/audio/backfill/run', limit ? { limit } : {})))
  );

  server.tool(
    'audio_retry_failed',
    'ADMIN ONLY. Retry clips that are waiting out a failure, now: their attempts go back to 0 and the backfill picks them on its next pass. No `error_code` = clips that failed because of the MiniMax ACCOUNT (2053 insufficient credit, 1008, 1004 / 2049 bad key, HTTP 401 / 403); a code (e.g. 2053, or an HTTP status) = only those; "all" = every failure. Also ends a running account pause so the next call probes MiniMax at once, and starts the pump. Use after fixing the MiniMax account.',
    { error_code: z.union([z.number().int(), z.string().max(12)]).optional().describe('A MiniMax base_resp code (2053), an HTTP status (401), or "all". Default: every account-level error.') },
    async ({ error_code }) => guard(async () => jsonResult(await api.post('/api/admin/audio/retry-failed', error_code !== undefined ? { error_code } : {})))
  );

  // ---------- Audio providers (docs/AUDIO.md "Providers"; worker/src/routes/audio-settings.ts) ----------

  const PROVIDER = z.enum(['minimax', 'azure', 'google']);
  const ORDER = z.array(PROVIDER).min(1).max(3);

  server.tool(
    'audio_settings_get',
    'ADMIN ONLY. Read-only. Which TTS provider speaks and in what order: `settings` = { stored_order (providers tried for clips that are KEPT: word / card sentence / sentence-set clips, lesson + chat clips cached on devices), live_order (played once: chat Read-aloud fallback, role-play replies), upgrade_backup_clips (remake a backup provider\'s clips with the first provider once it is available again), providers: { minimax | azure | google: { enabled, max_rpm, voices: { default, female, male }, speed_factor (rate = 1 + (app speed − 1) × factor) } } }; `defaults` (MiniMax only for stored, Google live fallback); `catalogue` (curated voices per provider); `providers` (configured? missing secrets, account problem, learned RPM, last success / error); `effective` (the orders minus disabled / unconfigured providers, which providers\' clips are current, the rates cards (0.6) and conversations (0.9) are spoken at). `azure_voices: true` also lists the zh-CN voices Azure offers in its region (proves the key works).',
    { azure_voices: z.boolean().optional().describe('Also list the zh-CN voices of the configured Azure region (one read-only Azure call).') },
    async ({ azure_voices }) => guard(async () => jsonResult(await api.get('/api/admin/audio/settings', azure_voices ? { azure_voices: '1' } : undefined)))
  );

  server.tool(
    'audio_settings_update',
    'ADMIN ONLY. Change the TTS provider settings (only the fields given; validated — a 400 lists every problem). Typical: MiniMax out of credit → stored_order ["minimax", "azure"] (Azure makes clips while MiniMax is paused; with upgrade_backup_clips the backfill remakes them with MiniMax later). Reordering so another provider is first makes the backfill remake every clip with it (unless upgrade_backup_clips is false). `reset: true` = back to the defaults. Takes effect within ~30 s. Returns the same view as audio_settings_get.',
    {
      stored_order: ORDER.optional().describe('Providers for clips that are kept, first = preferred. Disabled / unconfigured ones are skipped at run time.'),
      live_order: ORDER.optional().describe('Providers for live playback nobody keeps.'),
      upgrade_backup_clips: z.boolean().optional(),
      providers: z
        .record(
          PROVIDER,
          z.object({
            enabled: z.boolean().optional(),
            max_rpm: z.number().int().min(1).max(600).optional().describe('Hard cap on requests per minute (Azure F0 allows 20 / 60 s).'),
            voices: z.object({ default: z.string().optional(), female: z.string().optional(), male: z.string().optional() }).optional(),
            speed_factor: z.number().min(0).max(2).optional(),
          }),
        )
        .optional(),
      reset: z.boolean().optional().describe('true = every setting back to the defaults (the other fields are ignored).'),
    },
    async ({ reset, ...rest }) =>
      guard(async () => {
        if (reset) return jsonResult(await api.put('/api/admin/audio/settings', { reset: true }));
        const body = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
        if (Object.keys(body).length === 0) return errorResult('Nothing to change: pass stored_order, live_order, upgrade_backup_clips, providers or reset.');
        return jsonResult(await api.put('/api/admin/audio/settings', body));
      })
  );

  server.tool(
    'audio_tts_compare',
    'ADMIN ONLY. Calibration (4 MiniMax calls): the same sentence in the house voice with the old model (speech-02-hd) and the current one, at the house speed and at 1.0, with each clip\'s duration — to check the current model speaks at the same perceived speed.',
    { text: z.string().max(200).optional().describe('A Chinese sentence (default: a 16-character everyday sentence).') },
    async ({ text }) => guard(async () => jsonResult(await api.post('/api/admin/audio/compare', text ? { text } : {})))
  );
}
