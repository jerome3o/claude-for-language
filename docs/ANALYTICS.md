# Usage analytics

What people actually do in the apps — for the two of us (Jerome and Minghui) and Claude, so that
Claude can answer "Minghui hasn't used the homework drafts yet" or "she still opens the old search
page" from data instead of guesses. With two-ish users we log a lot; turn it down later with the
level switch below.

```
web app  ─ services/analytics.ts ─┐                         ┌─ usage_summary / feature_adoption /
Lab app  ─ data/analytics/ ───────┼─ POST /api/me/usage-events ── D1 usage_events ─┤  user_timeline / event_counts /
worker   ─ trackServer() ─────────┘   (privacy filter again)                      └─ recent_errors / ai_usage (MCP, admin)
worker   ─ request-log.ts ──────── Workers Observability (one JSON line per request)
```

## The privacy rule

**Ids, enums, counts, durations and booleans only.** Never message text, card content (hanzi,
pinyin, English, sentences), typed answers, recordings, transcripts, names, titles, search
queries, URLs, tokens or e-mail addresses.

It is enforced in code, not by convention — `shared/analytics/privacy.ts` (Kotlin port
`AnalyticsPrivacy.kt`, parity-tested), applied on the device before an event is queued **and** on
the server before it is stored:

1. each event lists the only prop keys it may carry (the catalogue); anything else is dropped;
2. `FORBIDDEN_PROP_KEYS` (`text`, `content`, `body`, `message`, `answer`, `hanzi`, `email`, `token`,
   `url`, `query`, …) can never be a prop — a test checks the catalogue against it;
3. string values must be a short id / enum token (`[A-Za-z0-9_.:/-]`, ≤ 64 chars): no spaces,
   no Chinese, no `@`, so a sentence, a name or an address cannot pass even under an allowed key.

Screens are recorded as route patterns: `screenName('/connections/3f1c…/chat/9a8b…')` →
`/connections/:id/chat/:id`. Tests that try to log a message body and assert it is dropped:
`shared/analytics/analytics.test.ts`, `frontend/src/services/analytics.test.ts`,
`worker/src/routes/__tests__/analytics.test.ts`, the Lab `AnalyticsParityTest` / app tests.

## What is recorded

Every event carries: `id` (client-made, the dedupe key), `ts`, `event`, `screen` (the route
pattern it happened on), `props`, `session_id` (a new session after 30 min away — `app.open`),
`platform` (`web` | `pwa` | `android-hybrid` | `lab` | `server`) and `app_version` (web: build
time; Lab: `0.N (versionCode)`).

- **Screen views** — `app.screen_view` for the screen being LEFT with `duration_ms` (time on it),
  recorded once from the router (web `AnalyticsListener` in `App.tsx`; Lab: the nav controller
  listener), also when the app goes to the background. "Time in app" = the sum of these.
- **Feature events** — the catalogue below.
- **Server events** — `trackServer()` (`worker/src/services/analytics/server-events.ts`): content
  created, homework assigned, push and e-mail sent, and **every model call** (`server.ai_call`:
  provider, model, input / output / cache-read tokens, estimated USD cost, the route or queue that
  made it). AI calls are captured without touching the call sites: `installAiUsageCapture()` wraps
  `fetch` once and reads `usage` from a clone of each Anthropic / Gemini JSON response
  (`ai-usage.ts`, `MODEL_PRICES` — list prices, an estimate). The user and route come from an
  AsyncLocalStorage scope (`scope.ts`, compatibility flag `nodejs_als`) set for every request,
  queue batch and cron run.
- **Request logs** — `request-log.ts` writes one JSON line per request to Workers Observability:
  `{ type: "request", method, route: "/api/decks/:id", status, duration_ms, user_id, error? }`
  (route pattern, never the raw path). `[observability]` is on with `head_sampling_rate = 1`.
  Query them in the Cloudflare dashboard (Workers → Observability, `type = request`), or with the
  Cloudflare observability MCP.

## How it is sent

- **Web** (`frontend/src/services/analytics.ts`): `track(event, props)` returns at once; events go
  into their own IndexedDB (`usage-analytics`, capped at 5000) and are uploaded in batches of ≤ 500
  by every sync and every 60 s while online (and with `keepalive` when the page is hidden). Rows
  are deleted only after a 2xx (or a permanent 4xx). Every step is in try/catch: analytics can
  never break or slow the app.
- **Lab** (`android-lab/app/…/data/analytics/`): the same, in its own small Room database, uploaded
  by its `FeatureSync` and every ~60 s in the foreground.
- **Upload path**: `POST /api/me/usage-events` (`USAGE_UPLOAD_PATH`, `shared/analytics/wire.ts`). It was
  `/api/analytics/events` until Oct 2026, but content blockers with EasyPrivacy (uBlock Origin, AdGuard,
  Brave, Ghostery) carry the generic rule `/analytics/event` and refused that request inside the browser
  (`ERR_BLOCKED_BY_CLIENT`, never reaching the worker), so no web event from such a browser was stored.
  The old path is still served (same handler) for Lab builds that predate the move. **Never name an
  endpoint the web app calls with tracker words** (`analytics/event`, `track`, `telemetry`, `collect`,
  `beacon`, `pixel`, …) — `analyticsUploadPathProblems` is the test's check. The events stay queued
  while blocked (newest 5,000), so a browser delivers its backlog on the next flush.
- **Server**: `POST /api/me/usage-events` `{ events }` → `{ accepted, stored, rejected, opted_out, level }`;
  idempotent by event id (`INSERT OR IGNORE`), unknown and server-only events rejected, props
  filtered again, future timestamps clamped.

## Switches

- **`ANALYTICS_LEVEL`** (worker env var, default `verbose`): `off` stores nothing (clients keep
  sending and get `stored: 0`), `basic` drops the high-volume events (`VERBOSE_ONLY_EVENTS`:
  screen views, card ratings, sentence reveals, homework items, reader word taps, listening-mode plays), `verbose`
  stores everything. Set it in `wrangler.toml` `[vars]` or the dashboard.
- **Per user** — Settings → Advanced → *Share usage data to help improve the app* (on by default;
  web and Lab). `PUT /api/profile/analytics { share_usage }` sets `users.analytics_opt_out`; turning
  it off also deletes that user's rows, the device clears its queue and stops recording, and the
  server drops anything still uploaded (`opted_out: true` turns a stale device off too). Server
  events honour it as well. `/api/auth/me` carries `share_usage`.
- **Retention** — the worker's daily cron (`[triggers] crons = ["17 3 * * *"]`, `scheduled()` in
  `index.ts`) deletes `usage_events` older than 180 days (`USAGE_RETENTION_DAYS`). Deleting an
  account deletes its rows (`DELETE_STEPS`).

## Asking questions (MCP, admin only)

`mcp-server/src/tools/usage.ts` → `worker/src/routes/analytics.ts` (behind `adminMiddleware`).
`user` is an id or an e-mail; `since` / `from` / `to` take `2026-10-01`, an ISO timestamp or `14d`.

| Tool | Answers |
|---|---|
| `usage_summary(user, since?)` | active days, sessions, time in app per platform, top screens by time, top events, last seen per platform + app version |
| `feature_adoption(user?, since?, stale_days?)` | per catalogue event: first / last used, count (and users, for everyone); `never_used`, `stale`, `old_path_in_use` (old event or screen with a newer replacement, with both counts) |
| `user_timeline(user, date \| from-to, tz_offset_minutes?, include_screens?)` | everything one person did, in order, to reconstruct a day |
| `event_counts(event \| prefix, group_by: day \| user \| platform \| event, since?, user?)` | how often, e.g. `chat.*` by user |
| `recent_errors(user?, since?)` | `error.shown` events grouped by place + the Lab crash / freeze reports (`crash_reports`) |
| `ai_usage(since?, group_by: model \| day \| user \| route \| provider, user?)` | calls, tokens, estimated cost |

Typical questions: "has Minghui used homework drafts?" → `feature_adoption(user: minghui…)` and
look for `tutor.homework_draft_*`; "what did she do on Tuesday?" → `user_timeline(date, tz_offset_minutes: 480)`;
"is anyone still on the old Lab build?" → `usage_summary` → `last_seen_by_version`.

## Adding an event (every new user-facing feature must)

1. One line in `shared/analytics/events.ts`: name `area.snake_case`, area, a one-line description,
   the prop keys (ids / enums / counts only). If it **replaces** an older way of doing the same
   thing, give the old event `replacedBy: '<new event>'` (or add the old screen to
   `SCREEN_REPLACED_BY`) so `feature_adoption` reports the old path still in use.
2. The same line in the Lab mirror (`android-lab/core/…/analytics/AnalyticsEvents.kt`) — the parity
   test fails until both match.
3. One call where it happens: web `track('area.event', { … })` from `services/analytics.ts`; Lab
   `app.analytics.track("area.event", mapOf(…))`; worker `trackServer('server.x', { … })`.
   Errors shown to the user: `trackError('<where>', err)` (web).

## The catalogue

Generated from `shared/analytics/events.ts` (the source of truth — regenerate this section when it changes).

### app

| Event | Props | Meaning |
|---|---|---|
| `app.open` | `install_kind` | The app was opened or came back after 30 min away (a new analytics session). |
| `app.screen_view` | `duration_ms`, `from` | Left a screen; `screen` is the route pattern, duration_ms the time on it. |
| `app.update_applied` | — | A new app version was installed / reloaded. |

### study

| Event | Props | Meaning |
|---|---|---|
| `study.session_start` | `scope`, `due`, `new_cards`, `offline` | Opened Study with cards to do. |
| `study.session_end` | `reviews`, `duration_ms`, `reason` | Left Study (or emptied the queue). |
| `study.card_rated` | `rating`, `card_type`, `queue`, `time_ms`, `recorded`, `multiple_choice` | Rated a card. |
| `study.ask_claude` | `card_type` | Asked Claude about the card on screen. |
| `study.edit_card` | — | Opened Edit card from a study card. |
| `study.flag_card` | — | Flagged a card for the tutor. |
| `study.sentence_coach` | — | Opened the Sentence coach from a study card. |
| `study.write_it` | — | Opened stroke-order practice (Write it). |
| `study.take_transcribed` | `via`, `live_error`, `ms` | A pronunciation take got its "You said": via live / upload / failed / offline; live_error = why the live Soniox stream gave nothing (none / timeout / soniox_<code> / closed / empty / socket / no_session / aborted); ms = Stop → result. `event_counts` on it shows at once when live transcription stops working on a client. |
| `study.study_more` | `count` | Pressed Study More (bonus new cards). |
| `study.celebration` | `reviews`, `active_ms` | Emptied today's queue (the once-a-day celebration). |
| `study.long_term_toggle` | `value` | "Add to my long-term review" switched for a word. |
| `study.sentence_reveal` | `step` | Tapped an example sentence row open. |
| `study.sentence_explain` | — | "What's going on here?" on an example sentence. |
| `study.tutor_note_practice` | `count` | Practised cards from a tutor note. |

### homework

| Event | Props | Meaning |
|---|---|---|
| `homework.pass_start` | `kind`, `items` | Opened a homework pass. |
| `homework.pass_item` | `result` | Answered one item of a homework pass. |
| `homework.pass_done` | `kind`, `items` | Finished a homework pass. |

### chat

| Event | Props | Meaning |
|---|---|---|
| `chat.open` | `is_ai`, `unread` | Opened a conversation. |
| `chat.send` | `kind`, `is_ai`, `reply`, `offline` | Sent a message. |
| `chat.menu_action` | `action`, `kind` | Chose an item in the message menu (long-press / ⋯). |
| `chat.reaction` | — | Reacted to a message. |
| `chat.make_flashcards` | `count`, `focus` | Saved cards with Make flashcards. |
| `chat.correction` | — | The tutor corrected a message. |
| `chat.check_draft` | — | Check my Chinese on the compose box. |
| `chat.forward` | `kind` | Forwarded a message. |
| `chat.search` | `results` | Searched inside a conversation. |
| `chat.pinyin_toggle` | `aid`, `on` | Switched the 拼 / EN reading aids of a conversation. |
| `chat.discuss` | — | Discuss with Claude on a message. |
| `chat.listening_mode` | `scope`, `on` | Listening mode switched for a conversation, or the default for new chats. |
| `chat.listening_play` | `slow` | Listening mode: tapped a hidden message to hear it. |
| `chat.listening_reveal` | — | Listening mode: held a hidden message to reveal its text. |
| `chat.inbox_open` | `conversations`, `unread` | Opened the Chats tab. |

### calls

| Event | Props | Meaning |
|---|---|---|
| `call.start` | `solo` | Started a video call. |
| `call.join` | `role` | Joined a call. |
| `call.leave` | `duration_ms` | Left a call (it goes on). |
| `call.end` | `duration_ms` | Ended a call for everyone. |
| `call.board` | `tile` | Opened a board tile (text / draw / chat). |
| `call.board_page` | `action` | Added / turned / followed a board page. |
| `call.screen_share` | `on` | Started or stopped sharing the screen. |
| `call.annotate` | `target` | Drew on a shared screen or material. |
| `call.material_present` | `material_kind`, `pages` | Presented a lesson material. |
| `call.activity_start` | `activity_kind` | Started an in-call activity. |
| `call.layout` | `preset` | Changed the call layout (▦). |
| `call.review_open` | — | Opened a call review / lesson report. |
| `call.homework_from_call` | — | Make homework from this lesson. |

### tutor

| Event | Props | Meaning |
|---|---|---|
| `tutor.send_homework` | `items`, `mode`, `kind`, `split_days` | Sent homework from the Send homework sheet. |
| `tutor.remove_homework` | `kind` | Took homework back from a student. |
| `tutor.lesson_notes_add` | `draft` | Added lesson notes (drafting homework by default). |
| `tutor.session_notes` | — | Submitted session notes to the homework agent. |
| `tutor.homework_draft_message` | — | Asked Claude to change a homework draft. |
| `tutor.homework_draft_assign` | `items` | Assigned a homework draft. |
| `tutor.library_save` | `created` | Saved a library lesson in the editor. |
| `tutor.library_assign` | `students` | Assigned a library lesson to students. |
| `tutor.library_push_update` | — | Pushed a library lesson update to copies. |
| `tutor.catalogue_copy` | `exercise_type` | Copied a catalogue sample into the library. |
| `tutor.budget_change` | `new_cards`, `secondary_cards`, `reset` | Changed a student's daily new cards. |
| `tutor.student_profile_save` | — | Saved the private student profile. |
| `tutor.recording_mark` | `status` | Marked a recording (listened / needs work). |
| `tutor.flag_reply` | — | Replied to a flagged card. |
| `tutor.queue_move` | `to` | Moved a deck in the student's queue. |
| `tutor.invite_create` | `decks` | Created an invite link. |
| `tutor.insights_summary` | — | Asked for the Claude-written insights summary. |
| `tutor.try_as_student` | `kind` | Tried a deck / lesson as the student (preview). |

### readers

| Event | Props | Meaning |
|---|---|---|
| `reader.open` | `source`, `pages` | Opened a graded reader. |
| `reader.finish` | `rating`, `pages` | Rated / finished a reader. |
| `reader.word_tap` | — | Tapped a word chip. |
| `reader.word_more` | — | "More about this word". |
| `reader.word_add_card` | — | Added a reader word as a card. |
| `reader.generate` | — | Asked for a new reader. |
| `reader.editor_save` | `pages` | Saved a reader in the editor. |
| `reader.audio_block` | `action` | Used the phrase-block scrubber (jump / step). |
| `reader.speed_changed` | `speed` | Changed the reader playback speed (1 / 0.75 / 0.5). |

### quests

| Event | Props | Meaning |
|---|---|---|
| `quest.generate` | `difficulty` | Asked for a new quest. |
| `quest.play` | — | Opened a quest to play. |
| `quest.complete` | `moves` | Finished a quest. |

### picture_hunt

| Event | Props | Meaning |
|---|---|---|
| `picture_hunt.create` | `source` | Made a picture hunt. |
| `picture_hunt.play_done` | `found`, `total`, `gave_up` | Finished a picture hunt round. |

### lessons

| Event | Props | Meaning |
|---|---|---|
| `lesson.start` | `source`, `exercises` | Started a mini lesson. |
| `lesson.complete` | `rating`, `source`, `duration_ms` | Finished a mini lesson. |
| `lesson.grammar_start` | — | Started the OLD fixed-phase grammar lesson. **Old path → `lesson.start`.** |
| `lesson.editor_save` | — | Saved a lesson in the editor. |
| `lesson.catalogue_try` | `exercise_type` | Tried a catalogue sample lesson. |

### coach

| Event | Props | Meaning |
|---|---|---|
| `coach.start` | `action` | Started a Sentence Coach conversation. |
| `coach.quick_action` | `action` | Used a quick-action chip. |
| `coach.follow_up` | — | Sent a follow-up message in the coach chat. |

### decks

| Event | Props | Meaning |
|---|---|---|
| `deck.create` | `source` | Created a deck. |
| `deck.generate` | — | Generate with Claude. |
| `deck.note_add` | — | Added a note by hand. |
| `deck.note_edit` | `where` | Edited a note. |
| `deck.paste_list` | `added`, `updated`, `skipped`, `failed` | Saved a pasted word list. |
| `deck.enrich_words` | `words` | "Write them with Claude" in Paste a list. |
| `deck.reorder` | `how` | Moved a deck in the study queue. |
| `deck.export_anki` | `kind` | Exported to Anki. |
| `deck.search` | `results`, `server` | Searched cards on the Decks tab. |
| `deck.share` | `update` | Shared / updated a deck copy for a student. |
| `folder.create` | `kind`, `nested` | Made a folder of decks / library lessons / readers. |
| `folder.rename` | `kind` | Renamed a folder. |
| `folder.delete` | `kind`, `items` | Deleted a folder (its items go to Unfiled). |
| `folder.move_items` | `kind`, `count`, `unfiled` | Moved items into a folder (or back to Unfiled). |

### settings

| Event | Props | Meaning |
|---|---|---|
| `settings.change` | `setting`, `value` | Changed a setting (`setting` names it, `value` an enum). |
| `settings.analytics` | `on` | Turned usage data sharing on / off. |
| `settings.full_sync` | — | Ran a full sync by hand. |
| `settings.debug_report` | — | Sent a debug report by hand. |

### notifications

| Event | Props | Meaning |
|---|---|---|
| `notification.tapped` | `kind` | Opened the app from a notification. |

### errors

| Event | Props | Meaning |
|---|---|---|
| `error.shown` | `code`, `where`, `status` | An error message was shown to the user. |

### server

| Event | Props | Meaning |
|---|---|---|
| `server.content_created` | `kind`, `count`, `via` | A deck / notes / lesson / reader was created through the API. *(server)* |
| `server.homework_assigned` | `kind`, `mode`, `count` | Homework assignments were written for a student. *(server)* |
| `server.ai_call` | `provider`, `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cost_usd`, `status`, `route` | One model call: model, tokens and an estimated cost. *(server)* |
| `server.push_sent` | `channel`, `kind`, `ok` | A push notification was sent. *(server)* |
| `server.email_sent` | `kind`, `ok` | An e-mail was sent. *(server)* |
| `server.coach_auto_detect` | — | A coach conversation started WITHOUT an action (old clients). **Old path → `coach.start`.** *(server)* |
| `server.study_session_api` | — | POST /api/study/sessions — kept only for old clients. **Old path → `study.session_start`.** *(server)* |
