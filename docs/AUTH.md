# Sign-in, sessions, invites & onboarding

How people get in (invite-only), how sessions work on every app, and what a new invitee sees first.
CLAUDE.md keeps the rules in short; this is the full reference.

## Sign-in & sessions (`worker/src/services/auth.ts`, `routes/auth-session.ts`, `shared/auth/signin.ts`)

- **The session token never travels in a URL.** Every app makes a random `verifier`, keeps it (web:
  `sessionStorage` + a 15-min `localStorage` copy, `frontend/src/services/signIn.ts`; Lab:
  `Prefs.pendingAuthVerifier`; desktop: main-process memory) and sends only `challenge` =
  base64url(SHA-256(verifier)) (PKCE S256) to `/api/auth/login?challenge=` (carried in the OAuth state
  as `.x.<challenge>`). The callback stores a one-time code (`auth_codes`, migration 0129: only its
  SHA-256, the user, the challenge, the client; 60 s) and redirects with `?code=` (web) /
  `chineselearning-{lab,desktop}://auth?code=&nonce=`. `POST /api/auth/exchange { code, verifier }` →
  `{ session_token, expires_at }`; the row is DELETEd by the same statement that reads it (single use,
  a wrong verifier burns it; 400 `reason`: invalid_request | invalid_code | expired | nonce_mismatch).
  A link carrying someone else's code is worthless in your browser (login CSRF).
- **`?session_token=` in the web app's URL is ignored** except on the Vite dev server (E2E /
  screenshots log in with it) and inside a desktop build from before the exchange (its preload lacks
  `signsInWithCode`). The new desktop app exchanges the code itself and writes the session into the
  page's `localStorage` (`desktop/src/main.ts` `handOverSession`).
- **`challenge` is required** (Nov 2026): `/api/auth/login` without one (a Lab / desktop build from before the
  exchange, a stale web bundle) redirects back with `error=update_required` (the splash says "This version of the
  app is out of date…"); the callback never hands out `session_token` any more. Only the Vite dev server still
  reads `?session_token=` (E2E).
- **Sliding 30-day sessions** (`worker/src/services/auth.ts` `renewSessionIfDue`): a session used with less than
  20 days left is renewed to 30 days from now (one guarded UPDATE, so at most once per ~10 days of use;
  `auth.session_renewed`). Only sessions made to last slide — the MCP server's 5-minute rows never do. An
  expired session still answers 401 and is deleted; the daily cron prunes the rest. Before (Oct 2026) a
  session died 30 days after sign-in however much it was used, and the Lab app silently got 401 on sync,
  analytics, feedback and transcription for days while offline study kept working.
- **The signed-out state** (`shared/auth/session.ts`, Lab `core/…/auth/SessionRules.kt`, parity-tested): a 401
  from OUR API to a request carrying the session (never Soniox; never logout / the code exchange) sets a
  persistent flag — web `services/signedOut.ts` (localStorage `signed-out-v1`, from `authEvents.onUnauthorized`),
  Lab `data/auth/SessionHealth.kt` (`Prefs.signedOutSince`, from ONE OkHttp interceptor on `Api.http`) — and a
  non-dismissable banner on every screen: "You're signed out — sign in again to sync, transcribe and use Claude.
  Your reviews are saved on this phone." + Sign in (web `components/auth/SignedOutBanner.tsx` at the top, a
  compact pill on full-screen routes; Lab `ui/kit/AccountDialogs.kt` `SignedOutBanner` in `ShellFrame`'s
  `topBanner`). Nothing local changes: the cached user, IndexedDB / Room, the audio cache and every outbox stay.
  A 2xx from a route that always needs the session (`provesSignedIn`: sync / profile) or a sign-in clears it.
  A transcription whose upload got 401 says "Signed out — sign in again" (web `TakeOutcome.kind: 'signed_out'`,
  Lab `TranscriptionUi.SignedOut`). Analytics `auth.signed_out_detected { platform, where }`.
- **Signing in again never wipes data** (Oct 2026: Settings → Sign out + sign in wiped a day of unsynced reviews
  and ~12,400 cached clips). Each app remembers whose data it holds (web localStorage `account-owner-v1`, Lab
  `Prefs.accountOwnerId` / `accountOwnerEmail`, kept by `clearAccount`); a fresh sign-in compares
  (`accountSwitchFor` / `SessionRules.accountSwitch`: by id, else e-mail): the same account (or none known)
  resumes with everything kept — pending events and the Outbox upload on the next (incremental) sync; a
  DIFFERENT account clears the previous one's data (web `clearAccountData`, Lab `Repository.clearForNewAccount`,
  audio included) — and when something hasn't uploaded it first asks "N reviews and M recordings haven't
  uploaded yet — sign back in as <email> to upload them first, or discard them" (web
  `components/auth/AccountGuards.tsx`, Lab `AccountSwitchDialog` from `MainActivity.completeSignIn`).
  **Settings → Sign out** with unsent work asks first (Sync first / Sign out anyway; `signOutWarning`); "anyway"
  deletes nothing (Lab: only the token goes). With everything uploaded the Lab clears the account's database but
  KEEPS the audio cache (files keyed by R2 key). The web's logout never touches IndexedDB. A dev-server
  `?session_token=` (E2E) skips the account check. `auth.unsynced_warning { reason, choice }`.
- **Sign out revokes**: `POST /api/auth/logout` deletes the Bearer session (web `logout()` sends the
  header; Lab `Repository.signOut` → `Api.revokeSession`, ≤ 4 s, best effort). **Sign out of all
  devices** (Settings, web `components/settings/SignOutSection.tsx` + Lab `SettingsScreen`, in-page
  confirm): `POST /api/auth/logout-all` → `{ signed_out }`, every `auth_sessions` row of the account — and Claude's MCP
  connection: it writes `users.mcp_revoked_at` (migration 0147), and the MCP worker refuses + revokes every OAuth
  grant made before it (`grantStatus` in `mcp-server/src/oauth/users.ts`; grants carry `props.grantedAt`).
- E2E: `POST /api/test/auth-code { email, challenge, client? }` mints a code without Google (Lab
  `AuthContractTest`, hand-run checks).
- **Content-Security-Policy** (`frontend/public/_headers`, Pages): ENFORCED (Nov 2026) — the full policy (every
  origin the app uses is listed there) + `frame-ancestors 'none'`, `X-Frame-Options: DENY`, nosniff, Referrer-Policy,
  Permissions-Policy (camera / mic / display-capture for the app only). Violations are still reported to
  `POST /api/csp-report` (`routes/csp-report.ts`: one `"type":"csp"` log line per violation — directive + blocked
  origin + page path only). **A new external origin (API, socket, image / media host, script) must be added to that
  header or the browser blocks it.** Verified with zero violations on a production build (sign-in, study, Anki export /
  sql.js, pdf.js materials, progress worker, chat ChatHub socket, call room socket + camera, settings, the feedback
  screenshot via html2canvas).

## Invite-only sign-up

**A Google sign-in for an email with no `users` row creates a user only if an invite admits it.**
The gate lives in the `/api/auth/callback` handler (`worker/src/index.ts`) and
`worker/src/services/signup.ts`:

1. `findExistingUser` — existing users (by google_id, then email — the email match only when Google says
   `verified_email`) always get in; nothing changes for them. An unverified address never matches an
   email-bound invite, a pending invitation or `ADMIN_EMAIL` either (`resolveSignup`'s `emailVerified`).
2. Otherwise `resolveSignup(db, googleUser, { inviteToken, adminEmail })` tries, in order:
   the invite token carried in the OAuth `state` (from `/join/<token>` → `/api/auth/login?invite=`),
   a still-valid `invites` row bound to the Google email, a `pending_invitations` row whose
   inviter has `can_invite`/is admin (the pre-existing email-invite path), and finally
   **`ADMIN_EMAIL`, which is permanently invited so the admin can never lock themselves out.**
3. No match → **no user is created**; the attempt is upserted into `access_requests` (one ntfy
   ping via `NTFY_TOPIC` the first time) and the browser lands on `/?signup=invite_only`.
   A valid link whose invite is bound to a *different* email → `/?signup=email_mismatch&inviter=…`.
4. A match → `createUser`, then `redeemInvite` (idempotent, awaited before the redirect so the
   first screen already has the deck): records the redemption, creates the relationship in
   `active` status with the inviter in `inviter_role`, and copies `share_deck_ids` via the
   existing `shareDeck`. An *existing* user who signs in from a `/join` link is NOT redeemed by the
   callback: they land on `/join/<token>` and press "Accept as <name>" (a tutor connects current
   students the same way, with that one tap).

**Who may invite** is `users.can_invite` (admin page toggle; admins always may). It gates
`POST /api/invites` and the email path of `POST /api/relationships` when the target has no
account; connecting with an existing user stays open to everyone. Invite tokens are 32 random
bytes base64url — treat them as bearer secrets (don't log them). **A use is taken atomically**
(`claimInviteUse`: `UPDATE … WHERE use_count < max_uses AND revoked_at IS NULL AND not expired RETURNING`) BEFORE the
account is created, so two people can't both get in on the last use. **An EXISTING account is never connected by the
link alone** (Nov 2026): signing in from `/join/<token>` lands back on `/join/<token>`, where "Accept as <name>" is an
explicit `POST /api/invites/:id/redeem`. `E2E_TEST_MODE`'s
`/api/test/auth` still creates users directly.

### Invites & access requests (invite-only sign-up; `worker/src/routes/invites.ts`)
- `GET /api/invites/:id/public` - **No auth.** What the `/join/:token` page shows: inviter name/avatar, `valid`, `status`, `email_bound` (never the email itself)
- `GET /api/invites` - Invites I created (`?all=1` for admins: everyone's), each with `url`, `status`, `redemptions`
- `POST /api/invites` - Create one (needs `can_invite` or admin): `{ email?, inviter_role?: 'tutor'|'student'|null, share_deck_ids?, max_uses?, expires_in_days?, note? }` → invite with `url`
- `DELETE /api/invites/:id` - Revoke (owner or admin)
- `POST /api/invites/:id/redeem` - A signed-in user accepting someone's link (relationship + decks, no new account)
- `GET /api/admin/access-requests` - Pending uninvited sign-in attempts (`?status=all|approved|dismissed`)
- `POST /api/admin/access-requests/:id/approve` - Creates an email-bound invite from the admin; the person just signs in again
- `POST /api/admin/access-requests/:id/dismiss`
- `PUT /api/admin/users/:id/can-invite` - `{ can_invite: boolean }`
- `GET /api/auth/login?invite=<token>` - Starts Google sign-in with the invite riding in the OAuth `state`

Invite rows also carry `welcome_message` (optional; `POST /api/invites` accepts it, and on the
first redemption `deliverWelcomeMessage` in `services/signup.ts` posts it as the inviter's first chat
message in the relationship's conversation + an unread notification) and `opened_at` (set by the
first `GET /invites/:id/public`, i.e. the /join page loading — the tutor's list shows
"Link opened · not signed in yet"). Migration 0065.

### Student onboarding & home (`worker/src/routes/onboarding.ts`)
- `GET /api/me/onboarding` - What a new invitee's first-open screen needs: `invited`, `inviter`
  (name/picture), `inviter_role`, `relationship_id`, `welcome_message` + `welcome_conversation_id`,
  `decks` copied by the invite (id/name/note_count), `has_reviewed`/`review_count`. The client
  (`components/onboarding/useOnboarding.ts`) caches it in localStorage and shows `FirstOpenScreen`
  while the user came in via a tutor invite and has zero reviews (server and local); after the
  first review the normal home renders. `FirstCardExplainer` (rendered once by StudyPage) shows a
  three-line explainer over the first card when there are no review events yet.
- `POST /api/decks/starter` - Idempotent: creates the caller's built-in **"Starter Chinese"** deck
  (`services/starter-deck.ts`, 15 words with tone-marked pinyin + one example sentence each, word and
  sentence TTS generated after the response) or returns the existing one by name. The invite sheet
  preselects it and requires at least one deck when inviting a student.
- The student home (`pages/HomePage.tsx`, `components/home/`) is one **Study today's cards** button
  with a plain subtitle ("24 cards due · about 8 min", ~20 s/card; four-colour breakdown behind ⓘ),
  the "🗒 N new notes from <tutor>" row, ONE compact **From <tutor>** homework card
  (`HomeworkHomeCard.tsx`: a slim row per active item — title, "5 / 12", due label — from the shared
  `homeHomework`, `shared/homework/home.ts`; a tap opens the pass / the deck; an unread tutor message is
  one small line), a slim one-line top-5 deck list linking to `/decks`, and one
  **+ Add a deck** link (modal with "Generate with Claude" inside). It never says "Flashcards done"
  until a full sync has completed once (`hooks/useSyncStatus.ts`).
