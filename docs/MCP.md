# MCP server

The MCP server (`mcp-server/`) lets Claude (claude.ai, Claude Desktop) manage a learner's or a tutor's
data. This is the full reference: architecture, OAuth, the tool catalogue, the tutor MCP Apps, debugging.

## MCP Server

The app includes an MCP (Model Context Protocol) server that allows AI assistants like Claude to interact with your vocabulary data.

### MCP Server URL (Streamable HTTP)
`https://chinese-learning-mcp.jeromeswannack.workers.dev/mcp`

### Architecture Overview

Tool modules live in `mcp-server/src/tools/` (`students.ts`, `content.ts`, `apps.ts`) and call the main API
through `ApiClient` (`mcp-server/src/api.ts`) as the signed-in user — each call mints a short-lived
`auth_sessions` token and revokes it afterwards — so tutor access checks stay in the API worker.

The MCP server uses several key technologies:
- **`@cloudflare/workers-oauth-provider`**: Wraps the worker with OAuth 2.1 support
- **`agents/mcp` (McpAgent)**: Class-based MCP server pattern from the `agents` package
- **Hono**: HTTP routing framework for the OAuth flow endpoints
- **Google OAuth**: User authentication via Google Sign-In

### Critical Implementation Details

#### 1. SQLite-Backed Durable Objects (IMPORTANT!)

The `McpAgent` class **requires SQLite-backed Durable Objects**. This is a common pitfall:

```toml
# wrangler.toml - CORRECT configuration
[durable_objects]
bindings = [
  { name = "MCP_OBJECT", class_name = "ChineseLearningMCPv2" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ChineseLearningMCPv2"]  # Must use new_sqlite_classes, NOT new_classes!
```

If you see this error, the Durable Object is not SQLite-backed:
```
Error: SqlError: SQL query failed: This Durable Object is not backed by SQLite storage
```

**Note**: An existing non-SQLite class cannot be converted. You must create a new class with a different name using `new_sqlite_classes`.

#### 2. OAuth Flow Implementation (`mcp-server/src/oauth/`, `@cloudflare/workers-oauth-provider` 1.2)

The flow is **approval page → Google → existing accounts only**, built on the provider's consent / upstream helpers:
- `GET /authorize` (`oauth/handler.ts`): `parseAuthRequest`, then "<client> wants to access your Chinese Learning
  account" with the redirect URI's host, a localhost warning, Approve / Cancel (`oauth/pages.ts`; everything from the
  client escaped) — skipped when this browser already approved the same client + redirect URI (the provider's
  HMAC-signed `__Host-oauth-approvals` cookie, key derived from `COOKIE_ENCRYPTION_KEY`, 90 days).
- `POST /authorize`: `approveConsent` (handle bound to the browser by a `__Host-` HttpOnly Secure SameSite=Lax cookie,
  single use, 10 min) → `beginUpstream` (Google `state`, also browser-bound) → Google; Cancel → `denyConsent`.
- `GET /callback`: `finishUpstream` (refused without the state's cookie), Google code → userinfo, then
  `findMcpUser` (`oauth/users.ts`): by `google_id`, else by email ONLY when `verified_email`. **Never INSERTs a user**
  — sign-up is invite-only in the app; an unknown account gets a 403 "Sign up in the app first" page and an
  `access_requests` row (same rules as the web callback). Google's error bodies are never echoed.
- `oauth/provider.ts`: resource `<origin>/mcp` (built per origin, cached), S256 PKCE only (the library's 1.2 rule),
  `/register` accepts only `https://claude.ai|claude.com` (+ subdomains) and loopback redirect URIs
  (`oauth/redirect-policy.ts`), and `requireLiveUser` refuses (401) + revokes the grants of a user no longer in D1
  (admin account deletion can't reach `OAUTH_KV`); a refresh for one fails `invalid_grant` (`tokenExchangeCallback`).
- Tests: `oauth/__tests__/` run the real provider in Node (in-memory KV, fake D1; `cloudflare:workers` aliased in
  `vitest.config.ts`).

#### 3. Required Secrets

Set these via `wrangler secret put`:
- `GOOGLE_CLIENT_ID` - From Google Cloud Console
- `GOOGLE_CLIENT_SECRET` - From Google Cloud Console
- `COOKIE_ENCRYPTION_KEY` - Generate with `openssl rand -hex 32`

#### 4. Google OAuth Setup

In Google Cloud Console, add this callback URL:
```
https://chinese-learning-mcp.jeromeswannack.workers.dev/callback
```

### Available Tools

| Tool | Description |
|------|-------------|
| `list_decks` | List all decks with stats (note count; `cards_due` = the deck's study session today, `reviews_due`, `cards_mastered` = Review + stability > 21 d — from `GET /api/me/study-queue?per_deck=1`) |
| `get_deck` | Get a deck with all its notes |
| `get_deck_progress` | Get detailed study progress for a deck |
| `create_deck` | Create a new deck (`POST /api/decks`; shared defaults: 3 new + 6 secondary cards a day) |
| `update_deck` | Update deck name/description and SRS parameters (interval_modifier, request_retention, easy_interval, maximum_interval) |
| `delete_deck` | Delete a deck and all its notes |
| `add_note` | Add a vocabulary note incl. example sentence (`POST /api/decks/:id/notes`; TTS in the background) |
| `batch_add_notes` | Add up to 500 notes in one `POST /api/decks/:id/notes/batch`; duplicates skipped, per-row failures listed |
| `search_notes` | Search notes by hanzi/pinyin/english across all decks (or one deck) — check before adding to avoid duplicates |
| `batch_search_notes` | Dedup-check many candidate words in one call — use instead of looping `search_notes` when clearing a whole homework list against existing notes |
| `move_notes` | Move notes to a different deck, keeping SRS state and history (`POST /api/notes/move`) |
| `update_note` | Update an existing note |
| `delete_note` | Delete a note |
| `get_note_cards` | Get all cards for a note with their SRS state |
| `set_card_familiarity` / `batch_set_familiarity` | Only `familiarity: "new"` does anything: a FORGET event (`POST /api/me/card-forgets`, back to New, history kept, Undo-able in the apps). "seen" / "familiar" / "well_known" / "mastered" are refused with an explanation — card state comes from review events (FSRS replays them), so a written state would be undone by the next replay; use `bump_cards` / `suspend_cards` / a real review instead (`tools/study.ts`). `update_card_settings` was removed for the same reason (Nov 2026) |
| `get_note_history` | Get review history and Q&A for a note |
| `backfill_word_tags` | AI word tags of the signed-in user's notes: progress + cost so far, and (unless `status_only`) queue up to `limit` untagged notes now (`POST /api/notes/word-tags/backfill`); the sync fills ≤ 200 an hour by itself |
| `check_deck_for_errors` | Word check of a whole deck (yours, or a student's copy with `relationship_id` + `shared_deck_id`): waits for the run, returns proposals (current → proposed + reason) and the cost; changes nothing |
| `scan_content_pinyin` | Scan the user's lessons (+ copies they assigned), library lessons and readers for impossible pinyin (扶梯 fúqī → fútī): a readable dry-run report by default; `dry_run: false` corrects it in place (ids, history, schedule kept) — only when the user asked (`tools/pinyin-scan.ts`) |
| `apply_note_fixes` | Apply ONLY the fixes the user approved: `job_id` + `proposal_ids` (+ `also_source`), or `fixes: [{ note_id, issue_id }]` from a create tool's `check_warnings` |
| `create_custom_lesson` | Author a custom mini lesson (sections of exercises) for the user's next study session |
| `list_custom_lessons` | List custom mini lessons (pending and completed) |
| `get_custom_lesson` | Get one lesson with its full spec (fetch before editing) |
| `update_custom_lesson` | Replace a lesson's content in place (same id — completion history + revisit schedule kept) |
| `delete_custom_lesson` | Delete a custom mini lesson |
| `create_companion_lesson` | `{ audio_lesson_id, unlock?: 'audio' \| 'manual', prompt? }` — the companion mini lesson of a READY audio lesson (~10–15 min drilling its characters, sentences and meanings), created LOCKED until the podcast is listened to (or "Done" for manual); waits ≤ ~50 s, else `generating` (see `get_audio_lesson`'s `companion`). `create_custom_lesson` also takes `unlock` |
| `get_due_cards` | Today's study session (all decks or one), in session order: reviews due + the budget's new cards, with `due_today` / `reviews_due` (`GET /api/me/study-queue`) |
| `get_overall_stats` | `due_today` (what Home shows), `reviews_due`, totals, studied today (`GET /api/stats/overview`) |
| `study` | **MCP App** - Opens an interactive flashcard study session in the UI |
| `create_audio_lesson` / `get_audio_lesson` / `list_audio_lessons` | Audio lessons (`tools/audio-lessons.ts`): start one — the description says when to use which: dialogue (practise a situation: `description` / `dialogue`), sleep (learn a text's new words: `text`), story (listen & repeat a whole pasted story / conversation: `text`, ≤ 6,000 characters, ≤ 90 min, `notice` when cut, no `target_minutes`); a tutor's `for_relationship_id` is only a label / status, chapters, transcript, usage / the list |
| `get_audio_lesson_feedback` | What the learner said while listening (`tools/audio-lesson-feedback.ts`, `GET /api/me/audio-lesson-feedback`; docs/AUDIO_LESSONS.md "Feedback while listening"): per lesson the "Too hard" / back a section / next section presses from the lock screen, notification, headset or player — a summary line, counts, how far he got, `hardest_lines` ranked (text, pinyin, English, too hard / replayed / skipped; a press within 2 s of a new line counts for the line before) and the presses (`events`: none / recent / all). Read before writing the next audio lesson or recap |
| `get_audio_lesson_feed` | The signed-in user's private podcast feed URL of their audio lessons (`GET /api/me/podcast-feed`; made on first use) + podcast:// link; private — give it to the user only |
| `get_idiom` / `list_idioms` | 成语 Idioms (`tools/idioms.ts`): one idiom's entry — meaning, 典故, usage, examples, quiz; generated when missing (waits up to 90 s), `caution` when not high confidence, `app_path` to point a learner at it / the starter list + looked-up idioms. Read / generate only, sends nothing |
| `create_clip` / `list_clips` / `get_clip` / `generate_clips` | 🎬 Clips (experimental, `tools/clips.ts`, docs/CLIPS.md): import ONE clip spec v1 into the user's own feed (the description is CLIP_SPEC_DOC; pre-checked with validateClipSpec, problems listed; `pinyin_fixes` back) / the feed trimmed (status, theme, words, length, watched / liked / saved, its mini lesson) / one clip with its spec / Claude writes 1–3 in the background around a topic / words. Sends nothing to anyone |
| `get_meme_review` / `generate_meme_review` | 梗 Meme review (prototype, `tools/meme-review.ts`): the newest (or a given month's) issue — memes with meaning, origin, examples, register, "would you say it?", source / video links, quiz — and the months / ADMIN: start the research agent for a month (~$1.5–2.5, background; `regenerate` redoes a ready one). Read only otherwise, sends nothing |
| `list_picture_hunts` / `create_picture_hunt` | The user's picture hunts (status, objects, best score) / start one from a scene description (`tools/picture-hunts.ts`) |
| `list_folders` / `create_folder` / `rename_folder` / `delete_folder` / `move_to_folder` | Folders for decks, library lessons and readers (`tools/folders.ts`): list with full paths ("HSK 2 / Week 1 / Monday"), depth + item counts, create (inside any folder, or by `path` — missing steps made), rename / re-parent (cycles / > 5 levels refused), delete (items → Unfiled, subfolders up one level, nothing deleted), file items by `folder_id` or by folder name / path (found or made). `list_decks`, `list_lesson_library`, `list_readers` show each item's folder and take a `folder_id` filter (`'unfiled'`); `create_deck`, `create_library_lesson`, `create_reader`, `generate_reader` take `folder_id` / `folder` |
| `get_up_next` / `add_to_up_next` / `move_in_up_next` / `remove_from_up_next` / `get_student_up_next` / `add_to_student_up_next` / `move_in_student_up_next` / `remove_from_student_up_next` | "Up next" (`tools/up-next.ts`): the ordered list of words the user already has, introduced FIRST within the daily budget (the list + today's ⚡ pocket / add by note_ids or hanzi at 'top' / 'bottom' / a 1-based place — already-listed words move, fully studied words are refused with a bump_cards hint / move / take off — the card is kept) and the tutor's versions on a student's list (only when she asked; nothing is created or sent) |
| `bump_cards` / `list_bumped_cards` / `clear_bumped_card` / `bump_student_cards` | "⚡ Study it today" (`tools/bumps.ts`): put words the user ALREADY has first in today's study (note_ids or hanzi; new cards even past the daily limit) instead of adding duplicates / the pocket / take one out / the tutor bumps a student's cards (the student sees "⚡ from <tutor>"). `search_notes` / `batch_search_notes` point at it |
| `illustrate_deck` / `illustrate_note` | Pictures on cards (`tools/note-images.ts`): a picture for every card of one of the user's OWN decks without one (`dry_run` = count + cost first; `illustrate_new` = the deck's switch) / one card's picture (`regenerate`, `remove`). Shows with the English on meaning → hanzi, on the answer side of the others |
| `suspend_cards` / `unsuspend_cards` / `list_suspended_cards` | Suspend & snooze (`tools/card-holds.ts`): the signed-in user's OWN cards out of all study until unsuspended (note_ids / hanzi / card_ids, optional card_types; history and schedule kept, no review written) / back into study / the held list (suspended + snoozed). No tutor variant |
| `list_feature_requests` / `get_feature_request` | Feature requests and in-app feedback (docs/FEEDBACK.md): `kind` filter (`feedback` = feedback + bug, `bug`, `request`), each row's `kind`, parsed `context` + `context_line`, `has_screenshot` and a signed `screenshot_url` (24 h) / one with comments + console logs. `claim_feature_request`, `update_feature_request_status`, `add_feature_request_comment` unchanged |
| `list_materials` / `read_material` | Lesson materials the user owns or has been shared (PDFs, slides, pictures: title, pages, has text) / one material's text page by page with speaker notes (`tools/materials.ts`) |

#### Create, then send (every tutor tool)

Minghui (Oct 2026): an agent sent a 319-word deck she never meant to send. The rule, in the server
`instructions` (`CREATE_THEN_SEND`) and every description: **create content in the tutor's own account;
never send anything to a student unless the tutor explicitly asks to send that item to that named student
in this conversation; when in doubt, create it and ask.**
- **Create tools** (`create_homework_deck`, `create_deck`, `batch_add_notes`, `add_words_to_student_deck`,
  `create_reader`, `generate_reader`, `create_library_lesson`, `duplicate_library_lesson`,
  `submit_session_notes`, `add_student_lesson_notes`) never reach a student; replies carry `sent: false` and
  "Saved in your account (not sent). Say "send it to <student>" to share."
- **Send tools** (`share_deck_with_student`, `update_student_deck_copy`, `assign_lesson_to_students`,
  `push_lesson_update`, `share_reader_with_student`, `assign_homework`, `assign_homework_draft`,
  `send_session_notes_items`) start their description with `SEND_RULE`, require `relationship_id`(s) and
  `confirm: true` (`CONFIRM_SEND`, a zod literal; the handler also refuses without it, `NEEDS_CONFIRM`),
  take an optional `student_name` checked against the relationship (`resolveStudent` / `nameMatches`), and
  reply `sent: true`, `sent_to` and "SENT to <student>: …". All in `mcp-server/src/tools/homework-send.ts`;
  `tools/create-then-send.test.ts` proves no create tool calls a sending endpoint and every send tool needs
  the student + confirm. The MCP Apps' Send buttons (an explicit click) are unchanged.
- Deprecated: `create_deck_for_student` = `create_homework_deck` (its `relationship_id` is only a label now;
  sends only with `send_now` + `confirm`).

#### Tutor tools — students (`mcp-server/src/tools/students.ts`)

All of these go through the main API as the signed-in user (`ApiClient`), so "is this user the
tutor of this relationship?" is decided by the API, never re-implemented in the MCP server.
`relationship_id` comes from `list_students`. Responses are trimmed to what a chat needs
(recording keys become playable `audio_url`s, ratings become again/hard/good/easy); the pure
shaping helpers are in `tools/students/shape.ts` and unit-tested in `tools/students.test.ts`.

| Tool | What it does |
|------|--------------|
| `list_students` | Every student card from `/api/tutor/dashboard` (status, streak, pills, needs-attention words, the one-off homework headline, setup checklist for new students, `last_conversation_id`) + pending invite links + the tutor's homework decks, plus `my_tutors` / pending requests from `/api/relationships` |
| `list_prepared_activities` / `prepare_activities` | In-call activities prepared for the student's NEXT video lesson from their previous lessons (why each one, what's in it, used or not) + what they've covered / write a fresh set (waits ≤ 90 s). Tutor's material only — nothing is sent (`tools/prepared-activities.ts`) |
| `get_student_overview` | One student's full card (`/relationships/:relId/overview`): all needs-attention words, homework decks and lessons with progress, setup/install state, recent days, `study_budget` (new words + extra cards a day, who set it) and `student_profile` (the tutor's private note) |
| `set_student_study_budget` | Set the student's ONE daily new-card budget (`new_cards_per_day` / `secondary_cards_per_day`, null = default 3 + 6; `PUT …/student-study-budget`) — the student gets a chat message and sees "Set by <tutor>" in Settings; `list_students` rows carry `study_budget` too |
| `get_student_profile` / `update_student_profile` | The tutor's private profile of the student (`GET|PUT …/student-profile`): what kind of learner, what homework suits them; update changes only the fields passed. The server `instructions` tell Claude to read it before making anything for a student and never quote it to them |
| `get_student_insights` | Pre-lesson briefing over a range (`/insights`): totals, ranked `struggling` with the wrong answers typed, `going_well`, activity, recordings with marks; `top_n` trims the lists; default range = since last logged lesson, else 14 days |
| `get_student_history` | Individual review events newest first with filters (deck, card type, rating, text) and keyset paging (`next_cursor`) |
| `get_student_daily_progress` | Last 30 days day-by-day + headline stats and per-deck counts (`/student-progress/daily` + `/student-progress`) |
| `get_student_day` | Everything reviewed on one date (`/student-progress/day/:date`) |
| `write_student_summary` / `list_student_summaries` | Claude-written narrative (EN + 中文) for a range, persisted; 503 message surfaced when no API key |
| `list_student_recordings` | Pronunciation recordings in a range with `audio_url` and tutor marks; `queue: true` = the "Needs your ear" queue with `why` labels, `heard`, `pronunciation_score`, `sounded_off`; `only_unmarked` = everything not yet heard |
| `mark_recording` / `clear_recording_mark` | `listened` or `needs_work` + comment (shown to the student once on the back of that card) / remove the mark |
| `log_lesson` / `list_lesson_log` / `delete_lesson_log_entry` | Lesson log; the newest entry anchors "since last lesson"; notes are copied into the student's lesson notes |
| `send_message_to_student` | Posts a chat message as the tutor into THE chat with the student (one per pair, created on first use) |
| `list_conversations` / `get_conversation_messages` | Read the chat — `get_conversation_messages` takes the `relationship_id` (or a conversation id; old merged ids work); last N messages, `from: "me"` for the caller. Both pass `?exclude_ai=1`: practice chats with Claude already copied into the Claude threads are left out (404 with `moved_to_thread`) |
| `send_install_howto` | Posts the install instructions (Obtainium / Add to Home screen) into the chat |
| `list_student_homework` | Shared decks with completion + activity, and the student's mini lessons with completions |
| `get_shared_deck_progress` | Per-word mastery and recent ratings for one shared deck |
| `share_deck_with_student` / `update_student_deck_copy` | **Send tools** (`confirm: true`, optional `student_name`). Send a tutor deck to the student as a homework assignment (`POST …/homework`; `mode` default `both` = one-off pass by `due_date` — default the next logged lesson, else in two days — then long-term; `priority: core` = top of their study queue, `non_urgent` = bottom; `skip_known`) / add the tutor's newer words to an existing copy (progress kept) |
| `remove_student_deck` / `remove_student_lesson` / `remove_student_reader` | Take homework back (sent by mistake): delete the STUDENT's copy of a deck the tutor shared (`shared_deck_id` or the copy's `deck_id`; `delete_source` also deletes her deck when no one else has a copy), a lesson she assigned, a reader she shared — never the student's own; `dry_run: true` first reports what would be lost. Named in `list_student_homework`'s description, which now also lists shared `readers` |
| `move_student_deck` | Move a packet within the student's study queue (`to: top | up | down | bottom`); returns `queue_position` of `queue_total` |
| `list_card_flags` / `reply_to_card_flag` | Cards the student flagged with their note (open by default) / answer one — resolves it, posts the reply into the chat, shown to the student once on that card |
| `list_student_claude_chats` | The student's chats with Claude they let the tutor read (card questions by default; `visibility` + `visibility_note` say what they share): per conversation `thread_id`, `context_kind`, `badge`, `word` + `card_path` for a card chat, `questions` (his message + Claude's reply, answers trimmed to `answer_chars`; a role-play opener has question null) — `GET …/claude-threads` |
| `get_student_claude_thread` | One whole shared chat, read-only (`thread_id` from the list; a private one is "not found"): messages `from` student / claude, text, translation |
| `submit_session_notes` / `get_session_notes_job` / `list_session_notes_jobs` | Hand the tutor's raw lesson notes to the session-notes agent (`POST …/session-notes`, or `call_id` for a recorded video lesson → `POST /api/calls/:id/homework`; deck + conditional mini lesson / reader, all kept in the tutor's account — `auto_share: true` needs `confirm: true`) / poll one job's progress, steps, result and `not_sent` keys / list a student's jobs |
| `send_session_notes_items` | **Send tool**: a finished job's unsent deck / lessons / reader (`items` keys from `not_sent`, none = all) → `POST …/session-notes/:id/send` |
| `list_student_lesson_notes` / `add_student_lesson_notes` / `get_homework_draft` / `update_homework_draft_plan` / `revise_homework_draft` / `assign_homework_draft` (`tools/homework.ts`) | Lesson-notes entries and their homework state / add notes (+ draft by default, nothing sent) / the draft with skipped words, plan and load now → after / change modes, dates, split / ask the assistant to change it (same job) / assign it (send tool, `confirm: true`) |
| `create_link_homework` / `assign_link_homework` / `list_link_homework` / `update_link_homework` (`tools/homework-hub.ts`) | Link homework (docs/HOMEWORK.md §8): save a video / song / article link with instructions in the tutor's OWN account (`POST /api/homework-links`, checked with `pickLinkHomework`; sends nothing) / send it (send tool, `confirm: true`) to one or more students as one-off homework (`POST …/homework`, `kind: 'link'`, optional due date) / list saved links / edit one (`PUT /api/homework-links/:id`, `update_student_copies` only when the tutor asked) |
| `get_homework_library` (`tools/homework-hub.ts`) | Everything sent, one row per deck copy / lesson / reader / link (§9): student, sent, due, status completed / in_progress / overdue / not_started, %, progress, the student's note, `due_assignment_id`; one student (`…/homework-library`) or all (`/api/tutor/homework-library`); status / kind / text filters (`filterLibrary`) |
| `get_student_homework` / `assign_homework` / `update_homework_assignment` (`tools/homework.ts`) | The load gauge + assignments with due labels and progress / assign (send tool, `confirm: true`) decks, library lessons and readers as `one_off` (due date, `split_days`, known words left out) / `fsrs` / `both` / move a due date or cancel |
| `create_student_invite` / `list_invites` / `revoke_invite` | Invite links (`inviter_role: tutor`, decks to copy, welcome message); status, `link_opened_at`, redemptions; revoke |

#### Tutor tools — content (`mcp-server/src/tools/content.ts`)

Registered by `registerContentTools(ctx)` from `mcp-server/src/tools/content/{readers,lessons,decks}.ts`.
Every tool calls the main API as the signed-in user through `ctx.api` (`ApiClient`), so the API's
ownership checks, validators and queues (TTS, illustrations, story generation) apply unchanged;
reader and lesson specs are pre-validated with the shared `validateReaderSpec` / `validateLessonSpec`
so Claude gets the problem list without a round trip. `content/specs.ts` holds the spec documentation
pasted into the descriptions plus the pure helpers (trimming, note normalisation), unit-tested in
`content.test.ts` together with a fake-context test that records the API paths each tool hits.

| Tool | Description |
|------|-------------|
| `list_readers` | The user's graded readers, trimmed (id, titles, difficulty, topic, status, page_count, creator_role, folder, `queue_position` in the reader queue); `status` filter |
| `get_reader` | One reader as a full `ReaderSpec` (page ids + image urls); poll while `generating` |
| `create_reader` | New reader from a hand-written `ReaderSpec` (`POST /api/readers/import`); `queue_position: 'top' \| 'bottom'` = its place in the reader queue (default top) |
| `update_reader` | Whole-reader replace (`PUT /api/readers/:id/spec`); keeping page `id`s keeps illustrations whose prompt is unchanged |
| `generate_reader` | Queue a Claude-written story from learned vocabulary of given decks (`POST /api/readers/generate`); returns id + `generating`; `queue_position: 'top' \| 'bottom'` |
| `list_reader_queue` / `move_reader_in_queue` / `reorder_reader_queue` | The reader queue ("Up next" — the order the study session offers unread stories, one a day): the unread, ready stories in order with `queue_position`, titles, level, folder / move one to `top` / `up` / `down` / `bottom` or a 1-based position (`POST /api/readers/:id/move`) / set the order at once, `reader_ids` first, the rest after (`PUT /api/readers/reorder`). `list_readers` rows carry `queue_position` |
| `retry_reader` / `delete_reader` | Re-queue a failed reader / delete one (images kept if a shared copy uses them) |
| `share_reader_with_student` | **Send tool** (`confirm: true`). Send one of the tutor's readers to the student as homework (`POST …/homework`, kind reader; `mode` default `both`, `due_date` default next logged lesson else +2 days) |
| `list_student_readers` | Shares in a relationship with the student's read status (`GET …/shared-readers`) |
| `export_reader` | Markdown / re-importable JSON / Quizlet CSV as text |
| `list_lesson_library` / `get_library_lesson` | The tutor's library items / one with its full spec |
| `create_library_lesson` | From a `spec` or a `generate_prompt` (Claude drafts it server-side), optional `tags` |
| `update_library_lesson` | Full-spec replace (+ tags); version bumps; reminds to push when copies exist |
| `duplicate_library_lesson` / `archive_library_lesson` | Copy as "Copy of …" / archive |
| `assign_lesson_to_students` | **Send tool** (`confirm: true`). A library lesson as homework per relationship (`POST …/homework`, `mode` default `both`, `due_date` default each student's next logged lesson else +2 days); `assigned` / `already_had` (left as is) / `errors` |
| `get_lesson_assignments` | Per student: completions, last rating/score, `up_to_date` |
| `push_lesson_update` | **Send tool** (`confirm: true`, `relationship_ids` required). Overwrite those students' copies in place (history + revisit schedule kept) |
| `export_library_lesson` | Markdown with answer key / JSON / CSV |
| `list_student_lessons` | Tutor's view of a student's lessons (`GET /api/relationships/:relId/student-lessons`) |
| `create_homework_deck` | Create deck + notes in the TUTOR's account via the API (one batch); nothing is sent (`for_relationship_id` only labels who it is for). Only `send_now: true` + `relationship_id` + `confirm: true` sends it at once as homework (`POST …/homework`: `mode` default `both`, `due_date` default next logged lesson else +2 days, `priority`, `skip_known`); a failed send keeps the deck. Never waits for TTS: the worker copies each clip onto the student's copy when it is generated (`propagateNoteAudioToSharedCopies`); per-note failures are reported, not fatal |
| `create_deck_for_student` | **Deprecated** alias of `create_homework_deck`; its `relationship_id` is only a label |
| `add_words_to_student_deck` | Add notes to the tutor's source deck of a shared deck; the student's copy is untouched unless `update_student_copy: true` + `confirm: true` (then `POST …/shared-decks/:id/update`) |
| `get_starter_deck` | `POST /api/decks/starter` — the idempotent built-in "Starter Chinese" deck |

#### Tutor apps (`mcp-server/src/tools/apps.ts`, UIs in `src/ui/apps/`)

Four interactive MCP Apps for tutors, each a model-facing tool that opens the UI plus
**app-only tools** (prefix `app_`, `_meta.ui.visibility: ['app']`, hidden from the model) the UI
calls back into. Server modules live in `src/tools/apps/` (one per app, `shared.ts` for the
`appTool` helper / students / `withProblems`, `types.ts` for the payload shapes the UIs import as
types); every call goes through `ctx.api` (the main API as the signed-in tutor).

| App / opening tool | What the tutor can do | App-only tools |
|---|---|---|
| `students_dashboard` — `open_students_dashboard(tz_offset_minutes?)` | One card per student from `GET /api/tutor/dashboard`: status, pills, needs-attention words with the wrong answers typed, setup checklist for new students; expand for recordings inbox + homework; log a lesson, message, mark recordings (comment shown to the student); "Ask Claude" chips send a prepared prompt into the chat | `app_refresh_dashboard`, `app_student_detail` (overview + insights recordings), `app_log_lesson`, `app_send_message`, `app_mark_recording` |
| `review_reader` — `review_reader(reader_id)` | Pages with Chinese / pinyin / English / illustration (`<api>/api/audio/<key>`); inline editing, add / delete / reorder pages, titles; Save (`PUT /api/readers/:id/spec`, page ids kept), Send to student (share-reader endpoint), "Ask Claude to revise" | `app_save_reader_spec`, `app_share_reader` |
| `review_lesson` — `review_lesson(library_item_id? \| lesson_id?)` | All 9 exercise types rendered and editable, add / remove / reorder; Save (library or a student's copy), Assign (multi-select), Push update, assignments with up-to-date / behind | `app_save_library_lesson`, `app_save_lesson`, `app_assign_lesson`, `app_push_lesson_update` |
| `review_deck` — `review_deck(deck_id)` | Word table with audio, inline row edit / add / delete saved per note; Send to student or Update their copy (from the dashboard's `homework.decks`); "Ask Claude to add 5 more words…" | `app_update_note`, `app_add_note`, `app_delete_note`, `app_share_deck`, `app_update_shared_deck` |

Saves validate with `shared/{reader,lesson}/validate` on both sides; a 400 with `problems` comes
back as `{ ok: false, problems }` and is shown inline. After every save / send the UI calls
`updateModelContext` with a text summary so Claude's next revision starts from the edited content;
"Ask Claude" buttons use `sendMessage` and are hidden when the host lacks that capability.

**UI mechanics**: vanilla TS, one folder per app (`index.html`, `main.ts`, `app.css`) sharing
`src/ui/apps/_shared/` (`host.ts` = the ext-apps `App` bridge with capability flags, `dom.ts` =
element builder / speech / toast / sheet, `picker.ts` = student picker, `base.css` = theme tokens
that follow the host variables and `data-theme`). `scripts/build-apps.mjs` builds `src/ui` (study)
and every `src/ui/apps/<name>/index.html` as its own single-file bundle and regenerates
`src/app-html.ts` (`APP_HTML[name]`, committed) — run `npm run build:ui` after touching a UI.
`registerApp(ctx, name)` serves the bundle as `ui://<name>/mcp-app.html` with a CSP allowing the
API origin. **Screenshots / dev preview**: set `window.__MCP_APP_PREVIEW__` to an object shaped
like the tool's `structuredContent` (and optionally `__MCP_APP_PREVIEW_TOOLS__ = { app_x: result }`
for canned app-only results) before the bundle runs and the app renders without a host — see
`docs/pr-screenshots/mcp-tutor-apps/`.

#### Admin tools (`mcp-server/src/tools/admin.ts`)

Admin only — every tool calls the API as the signed-in user and `adminMiddleware` answers 403 to anyone else. `user` is an
id or an email. Unit-tested in `tools/admin.test.ts`.

| Tool | What it does |
|------|--------------|
| `admin_list_users` | Every account with role, admin, can_invite, last login / opened, install kind, counts; `query` filters |
| `admin_get_user` | `GET /api/admin/users/:user/inspect` — profile, sync state, relationships, recent reports, decks |
| `admin_inspect_user_decks` | Live + deleted decks, shares either way, decks deleted before tombstones |
| `admin_set_role` | `student` / `tutor` (the tutor-first app) |
| `admin_set_can_invite` | Allow / stop invite links |
| `admin_set_user_voice_gender` | `male` / `female` / `other` / null — the voice that account's chat messages are read aloud in (`PUT /api/admin/users/:user/voice-gender`) |
| `admin_preview_delete_user` / `admin_delete_user` | What an account deletion removes / keeps; delete with `confirm_email` |
| `admin_list_access_requests` / `admin_handle_access_request` | Uninvited sign-in attempts; approve / dismiss |
| `admin_card_state` | Does the server's cached card state equal the replay of the account's review events? `check` (default): dry run — differing rows by transition, how many have no event, samples; `repair`: rewrite the differing rows (cache columns only) |

Audio (same file, docs/AUDIO.md): `audio_settings_get` / `audio_settings_update` (provider order for stored / live, voices, enabled, max RPM, upgrade backup clips, `reset`; `GET|PUT /api/admin/audio/settings`), `audio_backfill_status` (now with `providers` + `stored_clips`) (read-only: backlog by kind × state, clips by provider / model / voice, limiter, measured clips/min, ETA), `audio_backfill_run` (`limit?`: start the pump, queue that many clips now), `audio_retry_failed` (`error_code?`: failed clips due now — account errors by default, one code, or "all" — and probe MiniMax at once), `audio_tts_compare` (old vs current model durations — perceived speed check), `audio_lessons_rerender` (`format` story | sleep | all, `dry_run` default true: ready story / sleep lessons in the old ×3-then-English layout re-rendered in the current one (×3, English, ×2) from their own MP3; `POST /api/admin/audio-lessons/rerender`). API: `GET /api/admin/audio/backfill` (with `account_problem` first), `POST /api/admin/audio/backfill/run`, `POST /api/admin/audio/retry-failed`, `POST /api/admin/audio/compare` (`routes/audio-backfill.ts`).

#### Debug tools (`mcp-server/src/tools/debug.ts`)

The signed-in user's own study-state reports (see "Debug reports" above); nothing returns a whole report.

| Tool | What it does |
|------|--------------|
| `list_debug_reports` | Reports newest first (`client` lab / web), each with its summary (home total + counts, queue size, cards, events, unsynced) |
| `get_debug_report` | One report by id (or `latest_lab` / `latest_web`), a `section` at a time: overview (default), decks, cards (paged, filter by deck / queue / in_due_queue / card), events (paged hashes) |
| `compare_debug_reports` | Server-side diff, default newest lab (a) vs newest web (b): hints, context, headline numbers, per-deck differences, differing cards with the server's event count, one-sided cards and events |

#### Usage tools (`mcp-server/src/tools/usage.ts`)

Admin only (the API answers 403 otherwise); `user` = id or e-mail; docs/ANALYTICS.md.

| Tool | What it does |
|------|--------------|
| `usage_summary` | Active days, sessions, time in app per platform, top screens / events, last seen per platform + app version |
| `feature_adoption` | Per catalogue event: first / last used + count (one user or everyone); never used, stale, old paths still in use |
| `user_timeline` | One person's events in order for a day (`tz_offset_minutes`) or a range |
| `event_counts` | An event or prefix (`chat.*`) by day / user / platform / event |
| `recent_errors` | Errors shown to users + Lab crash reports |
| `ai_usage` | Model calls, tokens, estimated cost by model / day / user / route / provider |

### Study Tool (MCP App)

The `study` tool is special - it renders an interactive flashcard UI directly in Claude.ai or other MCP hosts that support MCP Apps. Usage:

1. Call `list_decks` to get available deck IDs
2. Call `study(deck_id: "...")` to open the study interface
3. The UI displays cards, handles flipping, and rating
4. Audio is the word's own clip (`/api/audio/<key>`, the resource's CSP allows the API origin), else browser speech synthesis
5. Each card carries its own FSRS interval previews (`getIntervalPreviews` over the card's replayed events + forgets — the web's rating buttons)
6. Reviews are submitted automatically via the `submit_review` tool (hidden from model), which POSTs the review EVENT to `/api/reviews` as the user — the API stores it and recomputes the card's state. **No MCP tool writes `cards` / `review_events` itself** (`tools/study.ts`; a guard test in `study.test.ts` greps the MCP source and fails on `UPDATE cards` / `INSERT INTO review_events`)

The UI bundle is built with Vite and embedded in the worker. To rebuild:
```bash
cd mcp-server && npm run build:ui
```

### Notes on MCP Usage
- **`update_student_copies`** (boolean, default false — a send: set it only when the tutor asked to update the students' copies; `tools/student-copies.ts`) on `update_note`, `add_note`, `batch_add_notes` (kind deck, the note's deck), `update_library_lesson` (kind lesson; replaces a separate `push_lesson_update`, which is kept), `update_reader` and `update_link_homework`: after the edit it calls `POST /api/student-copies/update` and lists per-student results ("Also updated Anna's copy"). A failed copy update never fails the edit.
- The deck / note tools (`create_deck`, `update_deck`, `delete_deck`, `add_note`, `batch_add_notes`, `update_note`, `delete_note`, `move_notes`) call the main API, so the worker's content service makes the cards, generates TTS in the background (word + example sentence), queues the sentence set and writes deletion tombstones. The MCP server only reads D1 directly (lists, searches, duplicate pre-checks).
- A deck created through MCP gets the shared new-deck defaults (3 new + 6 secondary cards a day)
- Notes created via MCP have audio shortly after the call returns; the tool never waits for it
- Use `get_note_history` to see a user's study progress and questions asked about a note

### Connecting to Claude.ai

Add the MCP server URL in Claude.ai settings:
```
https://chinese-learning-mcp.jeromeswannack.workers.dev/mcp
```

Claude.ai will handle the OAuth flow automatically.

### Connecting to Claude Desktop

Use `mcp-remote` to connect Claude Desktop to the MCP server:
```bash
npx mcp-remote https://chinese-learning-mcp.jeromeswannack.workers.dev/mcp
```

### Development

```bash
# Run MCP server locally
npm run dev:mcp

# Deploy MCP server
npm run deploy:mcp
```

### Debugging

To view live logs while testing:
```bash
cd mcp-server && npx wrangler tail --format pretty
```

Common issues:
- **"Could not find McpAgent binding for MCP_OBJECT"** - Missing Durable Object config in wrangler.toml
- **"This Durable Object is not backed by SQLite storage"** - Used `new_classes` instead of `new_sqlite_classes`
- **OAuth errors after deploy** - GitHub Actions may overwrite secrets; ensure `MCP_COOKIE_ENCRYPTION_KEY` is set in GitHub secrets
