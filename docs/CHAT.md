# Tutor–student chat: live delivery, notifications, read state

This is the contract the worker, the web app and the Lab app share for chat delivery.
(Rich-message features — edit/delete, photos, voice, corrections, flashcards from chat —
are documented further down as they land.)

## 1. Data (migration 0089_chat_push.sql)

```sql
-- One row per installed native app (FCM registration token).
CREATE TABLE device_push_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,          -- FCM registration token
  platform TEXT NOT NULL DEFAULT 'android',
  app TEXT NOT NULL DEFAULT 'lab',     -- 'lab' (future: other native shells)
  device_label TEXT,                   -- e.g. "Pixel 10 Pro Fold" (shown nowhere critical)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_success_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_device_push_tokens_user ON device_push_tokens(user_id);

-- How far each person has read each conversation (read receipts, unread counts,
-- clearing notifications on every device).
CREATE TABLE conversation_reads (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TEXT NOT NULL,          -- created_at of the newest message read (ISO, same format as messages.created_at)
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (conversation_id, user_id)
);

-- Idempotent sends (offline outbox, notification inline reply, retries).
ALTER TABLE messages ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX idx_messages_sender_client ON messages(sender_id, client_id) WHERE client_id IS NOT NULL;
```

`messages.created_at` is an ISO string (`new Date().toISOString()`); compare as strings.
Admin account deletion (`services/admin/delete-user.ts` `DELETE_STEPS`) must cover the two new tables.

## 2. API

All behind the normal auth middleware unless noted.

- `POST /api/conversations/:id/messages` — body `{ content, reply_to_message_id?, client_id? }`.
  With `client_id` the send is **idempotent**: a second POST with the same `(sender, client_id)`
  returns the existing message (200 instead of 201) and notifies nobody again.
  After insert: the sender's own read marker moves to the new message; the recipient is notified
  (§3). The response is `MessageWithSender` (+ `client_id`).
- `POST /api/conversations/:id/read` — body `{ up_to?: string }` (a message `created_at`; default =
  newest message). Moves my marker forward only (never back). Returns
  `{ conversation_id, last_read_at, unread: number }`. Side effects: a `chat_read` FCM data
  message to **my own** native devices (so they drop the notification), and a `read` live event
  to my other connected clients and to the other person (read receipts).
  **Opening a chat reads it up to the newest message, system rows included** (they count as unread
  and are read like any message — one rule for the count, the badge and the marker). Both apps make
  sure the read goes out even when the chat closes at once: the web flushes the debounced read on
  leaving (`useChatReadMarker`, `readToSendOnLeave`; nothing sent yet → no `up_to`), the Lab sends it
  on the app's scope and from `onCleared` when the load never reached it (`ChatRich.leaveRead`; offline
  → the Outbox, up to the newest message on screen). Oct 2026: Jerome glanced at his chat with
  Minghui (newest = her "📹 started a video call" line) for ~1 s; the Lab's read waited for three
  requests and was cancelled, so the Chats badge said 1 for days.
- `GET /api/conversations/:id/messages` — unchanged shape, plus `read_state: { me: last_read_at|null, other: last_read_at|null }`.
- `GET /api/me/chat-inbox?since=<iso>` — for background checks and the live-socket catch-up.
  ```json
  {
    "server_time": "2026-10-02T10:00:00.000Z",
    "messages": [ { "id", "conversation_id", "relationship_id", "content", "created_at",
                    "sender": { "id", "name", "picture_url" } } ],   // messages to me (not sent by me), created_at > since, unread, oldest first, ≤ 50
    "conversations": [ { "conversation_id", "relationship_id", "title", "other_user": { "id","name","picture_url" },
                         "unread": 3, "last_read_at": "…|null", "last_message_at": "…" } ]   // only those with unread > 0
  }
  ```
  `since` omitted = the last 7 days. Excludes AI (Claude role-play) conversations.
- `POST /api/push/devices` — `{ token, platform?: 'android', app?: 'lab', device_label? }` → `{ id }`;
  upsert by token (a token moving to another account moves with it).
- `DELETE /api/push/devices` — `{ token }` (sign-out).
- `GET /api/push/config` additionally returns `fcm: boolean` (the worker has FCM credentials).
- `POST /api/live/ticket` → `{ ticket, ws_path: "/api/live/ws" }` — a one-minute HMAC ticket
  (same scheme as call tickets, purpose `live`), then `GET /api/live/ws?ticket=` upgrades to a
  WebSocket into the caller's **ChatHub** Durable Object (registered before the auth middleware).

## 3. Delivering a new message

`notifyNewChatMessage(env, message, conversation)` (worker `services/chat/notify.ts`), in `waitUntil`:

1. **Live**: the recipient's ChatHub broadcasts `{"type":"message","message":MessageWithSender,"relationship_id"}`
   to every socket the recipient has open; the sender's ChatHub gets the same (their other devices).
2. **FCM** (if `FCM_SERVICE_ACCOUNT_JSON` is set): a **data-only, high-priority** message to each of
   the recipient's tokens:
   ```json
   { "type": "chat_message", "conversation_id", "relationship_id", "message_id",
     "sender_id", "sender_name", "sender_picture_url", "content" (≤ 1000 chars), "created_at",
     "url": "/connections/<relId>/chat/<convId>" }
   ```
   (FCM data values are strings.) `android.priority = "high"`, `collapse_key` = conversation id,
   `ttl` = 86400s. A token answered with `UNREGISTERED` / `404` / `INVALID_ARGUMENT` (token) is deleted;
   other failures bump `failure_count` and are dropped after 5.
3. **Web Push** (existing `pushToUsers`) with
   `{ type: 'chat_message', title: sender name, body: preview, url, tag: 'chat-<convId>', conversation_id, relationship_id }`.
   The service worker skips the notification when a focused, visible tab is already on that chat.
4. The existing in-app notification row, e-mail and ntfy stay as they were.

## 4. ChatHub Durable Object (one per user, `CHAT_HUB` binding, SQLite class, Hibernation API)

- `fetch` with an upgrade: accepts the socket (tagged with a per-connection id).
- RPC `broadcast(event)` from the worker: send to every socket.
- Client → hub frames: `{"type":"ping"}` → `{"type":"pong"}`; `{"type":"typing","conversation_id"}`
  → the hub checks membership (via D1, cached) and calls the other participant's hub
  `broadcast({"type":"typing","conversation_id","user_id"})` (clients show "typing…" for 4 s after the last one).
- Server → client events: `hello {user_id, server_time}`, `message`, `message_updated` (edits / deletes / reactions — later PRs),
  `read {conversation_id, user_id, last_read_at}`, `typing`.
- After (re)connecting a client calls `/api/me/chat-inbox?since=` (or the open chat's `?since=`) to catch up —
  the socket is a doorbell, the REST API stays the source of truth. Clients fall back to polling
  (web: the old 3 s while a chat is open) whenever the socket is down.

## 5. Notifications on each client

**Lab (Android)** — one channel `lab_messages` "Messages"; one notification per conversation
(id = stable hash of the conversation id), `MessagingStyle` with the sender `Person` (name + avatar),
each message a line (+ pinyin line when it contains hanzi); actions **Reply** (RemoteInput →
outbox `POST …/messages` with a `client_id`, the notification updated with my reply) and
**Mark as read** (`POST …/read`). Tapping opens `chineselearning-lab:///connections/<rel>/chat/<conv>`
(works from a cold start). Opening a chat, or a `chat_read` FCM message / `read` event for me,
cancels that conversation's notification. No notification while that chat is on screen.
Sources, in order: FCM (instant, when configured) → the live socket while the app is in the
foreground → a 15-minute periodic `ChatCheckWorker` (`/api/me/chat-inbox`) as the fallback.

**Web** — the service worker shows `chat_message` pushes with `tag: chat-<convId>` (replaces the
previous one for that chat, `renotify: true`), click opens/focuses the chat URL; the chat page
closes that tag's notifications (`registration.getNotifications({ tag })`) when it opens.

---

# PR 2 — live chat & rich messages (migration 0090_chat_rich.sql)

```sql
ALTER TABLE messages ADD COLUMN updated_at TEXT;   -- set on ANY change after creation (edit, delete, reaction, transcript, pin, correction)
ALTER TABLE messages ADD COLUMN edited_at TEXT;
ALTER TABLE messages ADD COLUMN deleted_at TEXT;   -- soft delete: content '' and attachment NULL, the row stays
ALTER TABLE messages ADD COLUMN attachment TEXT;   -- JSON ChatAttachment
ALTER TABLE messages ADD COLUMN pinned_at TEXT;
ALTER TABLE messages ADD COLUMN pinned_by TEXT;
CREATE INDEX idx_messages_conv_updated ON messages(conversation_id, updated_at);
```

```ts
type ChatAttachment =
  | { kind: 'image'; width: number; height: number; bytes: number; mime: string }
  | { kind: 'voice'; duration_ms: number; bytes: number; mime: string;
      transcript_status: 'pending' | 'done' | 'failed';
      transcript?: string | null; translation?: string | null };
```
The R2 key is never sent to clients: `chat-media/<conversationId>/<messageId>.<ext>` (person-made data,
registered in `STORAGE_PREFIXES` as NOT collectable; removed when the message is deleted and by
account deletion).

Message JSON (`MessageWithSender`) gains: `client_id`, `updated_at`, `edited_at`, `deleted_at`,
`attachment`, `media_url` (`/api/chat-media/<messageId>` when there is an attachment, else null),
`pinned_at`, `pinned_by`.

### Endpoints
- `GET /api/conversations/:id/messages?since=` — returns messages with `created_at > since OR updated_at > since`;
  `latest_timestamp` = the max of `COALESCE(updated_at, created_at)` over the conversation (the next cursor).
  Clients merge by id (replace). Deleted messages come back with `deleted_at` (render "Message deleted").
- `POST /api/conversations/:id/media?kind=image|voice&client_id=&caption=&reply_to_message_id=&duration_ms=` —
  raw body (`image/jpeg|png|webp` ≤ 8 MB — clients send a ≤ 1600 px JPEG; `audio/webm|ogg|mp4|aac|mpeg|wav` ≤ 10 MB,
  ≤ 5 min). Creates the message (content = caption or ''), idempotent by client_id like text sends, notifies like a
  text message (preview "📷 Photo" / "🎤 Voice message"). A voice message is transcribed in `waitUntil` with
  `transcribeTake` (services/take-transcription.ts), translated (existing auto-translate), then `transcript_status`
  → done/failed, `updated_at` bumped, `message_updated` live event to both people.
- `GET /api/chat-media/:messageId` — the bytes, only for the two participants (403 otherwise), `Cache-Control: private, max-age=31536000, immutable`.
  Clients fetch it with their normal auth and cache it (web: blob URL + Cache Storage / IndexedDB; Lab: disk cache).
- `PATCH /api/messages/:id` `{ content }` — sender only, not deleted, text messages (or a photo's caption);
  sets `edited_at`, clears translation (re-translated in the background).
- `DELETE /api/messages/:id` — sender only; soft delete (+ R2 object removed).
- `POST /api/messages/:id/pin` `{ pinned: boolean }` — either participant.
- Reactions (`POST /api/messages/:id/reactions`) now bump `updated_at` and emit `message_updated`.
- `GET /api/relationships/:relId/conversations` — each conversation gains `unread` (messages from the other person after my read marker) and `last_message` carries attachment kind / deleted.
- Every change above → ChatHub `{"type":"message_updated","message":MessageWithSender}` to both participants.

### Client behaviour (web + Lab, same rules)
- **Live**: while a chat is open, the ChatHub socket delivers `message` / `message_updated` / `read` / `typing`;
  REST polling (`?since=`) runs only while the socket is down (web 3 s; Lab 3 s in chat) and once after every reconnect.
- **Typing**: send `{"type":"typing","conversation_id"}` at most every 2.5 s while the compose box is non-empty and changing;
  show "<name> is typing…" for 4 s after the last event (cleared at once when their message arrives).
- **Read receipts**: under my newest message the other person has read (`read_state.other >= created_at`): "Seen"; else
  "Sent" (✓) / pending (clock) / failed ("Not sent · Tap to retry").
- **Optimistic send**: a bubble appears at once with a client_id; text and media go through the offline queue
  (web: persisted per conversation in IndexedDB/localStorage and retried when online/at open; Lab: Outbox `enqueueJson` /
  `enqueueRaw`); the server's message replaces the bubble by client_id.
- **Unread**: opening a chat scrolls to the first unread message under a "New messages" divider (read marker as it was
  before opening); a floating "↓ N new" pill when scrolled up and new messages arrive.
- **Pinned**: a slim bar at the top with the newest pinned message (tap → jump; ⋯ → list of all pins).
- **Search**: header 🔍 filters the loaded messages client-side — shared pure `searchMessages(messages, query)`
  in `shared/chats/search.ts` (content, translation, transcript, caption; case-insensitive; pinyin with or without
  tones when the message has `words`) — Lab port parity-tested.
- **Photos**: 📎 → camera or gallery, compressed on device to ≤ 1600 px JPEG q≈0.8, optional caption; full-screen viewer on tap.
- **Voice**: hold-to-record (or tap to start/stop) → preview → send; bubble with ▶, duration, waveform-ish bar,
  transcript (hanzi), then toggles for pinyin / translation.
- **Edit / delete**: on my own messages in the ⋯ sheet; "edited" label.

---

# PR 3 — learning tools in the chat (migration 0091_chat_learning.sql)

```sql
ALTER TABLE messages ADD COLUMN words TEXT;        -- JSON ReaderWord[] (shared/reader/words.ts), concatenating to the text exactly
ALTER TABLE messages ADD COLUMN correction TEXT;   -- JSON { text, note, by, at }
```
- Words are computed in the background for every message (or voice transcript) containing Chinese, with the reader
  words splitter (`segmentReaderText`, Haiku), and lazily by `POST /api/messages/:id/words` → `{ words }` for older
  messages. `message_updated` when they land. Until then (or when Claude's split failed) the device makes the chips with
  the deterministic segmenter (`shared/chinese/segment.ts`; docs/LANGUAGE_EXPLORER.md "Word chips without an LLM").
- **Pinyin / Translate toggles** per message (pinyin from `words`; translation from `translation`), remembered per
  conversation on the device. A "Show pinyin for all" switch in the chat header menu.
  A message with no `translation` yet asks `POST /api/messages/:id/translate` → `{ translation }`
  (`routes/message-translate.ts`, `translateChineseText` in `services/translation.ts`: ONE short forced-tool Haiku
  reply, Sonnet 5 as the last try, stored for both people); failures are 503 `{ error, retryable }` / 502 with a
  readable reason, shown inline, and the toggle switches back off so the next tap retries (both apps give up after
  30 s). The word-by-word breakdown is a SEPARATE call (`segmentChineseText`, budget scaled to the length, doubled when
  cut off) behind `POST /api/messages/:id/translate-segmented`, which still answers with the translation and a
  chunk-less stand-in when only the breakdown fails. (Until 7 Oct 2026 both came from one free-text JSON call capped
  at 2000 tokens: a long tutor message was cut off after ~17 s and Translate always failed.)
- **Tap a word** (chips when words exist) → the reader word sheet (hanzi · pinyin · gloss · ▶ · the sentence ·
  "More about this word" via `/api/reader-words/explain` · **+ Add as card**).
- **Make flashcards from this chat**: header ⋯ → select messages (or "Today" / "Last 50 messages") →
  `POST /api/conversations/:id/flashcards/propose { message_ids?, since?, focus?: 'correction' }` →
  `{ cards: [FlashcardItem + { already_have: boolean, source_message_id }] }` (structuredCall, CARD_STANDARD, the shared
  FLASHCARD_ITEM_SCHEMA; corrections and words the learner got wrong first; `already_have` = normalised hanzi already in
  one of the caller's notes) → review sheet (edit fields, uncheck, deck picker) →
  `POST /api/decks/:id/notes/batch` in one tap.
- **Add-card deck pickers** (word sheet, Explain → word / Save as flashcard, Make flashcards, the correction's card, the
  tap-to-save lists): decks in study-queue order (`decksInQueueOrder`, shared/decks/queue.ts) and the top deck of the
  queue preselected (`defaultPickerDeckId`) every time — no remembered last deck, no pinned decks. The deck list scrolls
  on its own and the Add / Save button stays pinned at the bottom of the sheet.
- **Correct this** (the tutor of the relationship, on the other person's text message): `PUT /api/messages/:id/correction
  { text, note? }` / `DELETE`. Shown under the bubble as a character diff (`diffHanzi`, shared/lesson/answer-check.ts) +
  note; the student's ⋯ → "Make a card from the correction" (`propose` with `focus: 'correction'`). The student gets a
  push "✏️ <tutor> corrected your message".
- **Check my Chinese before sending**: a ✓ button on the compose box (when the draft has Chinese) → existing
  `POST /api/sentence/coach` → corrected sentence as a diff + short critique → "Use this" replaces the draft.

### PR 3 — as implemented (exact shapes)
- Message JSON: `words: [{ text, pinyin, gloss }] | null`, `words_source: 'content' | 'transcript' | null`
  (transcript = words concatenate to `attachment.transcript`), `correction: { text, note|null, by, at } | null`.
  Stale words come back null; all three are null on a deleted message.
- `POST /api/messages/:id/words` → `{ words | null, source, cached }` (null = no Chinese / not transcribed yet);
  403/404/409(deleted)/400(>1500 chars)/503 retryable/502.
- `POST /api/conversations/:id/flashcards/propose { message_ids? (≤80), since?, focus?: 'correction' }` →
  `{ cards: [{ hanzi, pinyin, english, fun_facts, sentence_clue?, sentence_clue_pinyin?, sentence_clue_translation?,
  already_have, source_message_id|null }] }` (≤ 15; neither ids nor since = last 50 messages);
  400 nothing usable / 503 `{error, retryable:true}` / 502 `{error, retryable:false}`.
- `PUT /api/messages/:id/correction { text, note? }` / `DELETE` → the message. Tutor of the relationship only, on the
  other person's text message (403 / 404 / 409 deleted / 400 media). A new correction pushes the student:
  FCM `{ type:'chat_correction', conversation_id, relationship_id, message_id, sender_name, content, url }`,
  Web Push `{ type:'chat_correction', title, body, url, tag:'chat-<convId>', conversation_id, relationship_id, message_id }`.
- Editing keeps the correction; deleting clears it.

---

# E-mail opt-out (migration 0093_chat_email_prefs.sql)

```sql
ALTER TABLE users ADD COLUMN email_chat_messages INTEGER NOT NULL DEFAULT 1;  -- 0 = no chat e-mails
```

- `notifyNewChatMessage` (services/chat/notify.ts) skips the e-mail when the recipient's `email_chat_messages = 0`.
  Push (FCM / Web Push), the live socket and the in-app notification are unaffected.
- Every chat e-mail has a **Turn off chat emails** link in the footer (HTML + text) and the
  `List-Unsubscribe: <url>` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers (RFC 2369 / 8058), so Gmail
  and others show their own Unsubscribe button.
- The link needs no sign-in: `…/api/email/unsubscribe?t=<token>` on the API worker (`PUBLIC_API_URL`, default the
  workers.dev URL), token = `b64url(userId).b64url(HMAC-SHA256("email-unsubscribe:" + SESSION_SECRET, "chat:" + userId))`
  (`services/email-unsubscribe.ts`). It never expires and only ever toggles this one preference.
- `GET /api/email/unsubscribe?t=` → a tiny page; **a GET changes nothing** (mail scanners open links) — the page POSTs
  as it loads, so for a person it is one tap, then shows "Chat e-mails are off · Turn back on" (without JavaScript: a button).
- `POST /api/email/unsubscribe?t=` (also the one-click target, body `List-Unsubscribe=One-Click`) / `POST /api/email/resubscribe?t=`
  → `{ email_chat_messages }` with `Accept: application/json`, else the page. 400 bad token, 404 unknown account.
- Signed in: `PUT /api/profile/email-prefs { email_chat_messages: boolean }`; the value is on `/api/auth/me`.
  Web: Settings → Notifications → **Chat e-mails** checkbox. Lab: Settings → **Chat e-mails** toggle (cached on the device).

---

# Round 2 — a normal chat app, with the learning tools in the long-press menu

Jerome: "Make it look like a normal chat app like Signal, but when you long-press a message you get all the tools."
The bubbles carry **no buttons**; every tool is in the message menu. Same rules in both apps.

## Look (Signal-like)
- **Bubbles**: mine on the right in the accent blue (`#2c6bed` light / `#3b7bf0` dark) with white text; theirs on the left
  in a neutral grey (`#e9e9eb` light / `#2b2b2e` dark), no border. 18 dp radius; inside a group the corners facing the
  neighbouring bubbles are 4 dp (Signal's stacked look); max width ~78 % (480 dp / px unfolded).
- **Groups** (`layoutBubbles`, `shared/chats/bubbles.ts`, Lab `ChatBubbles.kt` parity-tested): consecutive messages
  from one person within 3 min on the same local day. 2 dp between bubbles in a group, 10 dp between groups.
- **Time + ticks** sit INSIDE the last bubble of a group, bottom-right, small and translucent (`9:41 ✓✓`); a tap on any
  other bubble shows its time the same way (toggle). Ticks only on my messages: 🕓 pending, ✓ sent, ✓✓ read
  (`read_state.other >= created_at`), a red "!" + "Not sent · Tap to retry" under a failed one. "edited", 📌 sit with the time.
- **Day separators**: a centred pill "Today" / "Yesterday" / "Mon 28 Sep" (not sticky).
- **Avatars**: none in a 1:1 chat (the header says who it is). The Claude practice chat keeps none either.
- **Reactions**: a small pill overlapping the bubble's bottom edge (`❤️ 2`), tap = toggle mine.
- **Reply quote** inside the bubble on top: a 3 dp bar + the name + one line (photo / voice: "📷 Photo" / "🎤 Voice message"); tap jumps.
- **Pinyin / translation** once toggled from the menu: pinyin over the words (chips) and the translation as a muted line
  inside the bubble under a hairline. Tapping a Chinese word still opens the word sheet (#493).
- **Link preview** (`firstLink(text)`): a card under the text inside the bubble — image (if any) on top, site name,
  title, 2-line description; tap opens the link. `GET /api/link-preview?url=` → `{ url, title, description, image, site_name }`
  (worker fetches the page — http(s) only, public hosts only, ≤ 512 KB, 5 s, Open Graph / Twitter / <title>; cached a day;
  404 when nothing usable). Clients cache previews per URL (web localStorage LRU 200; Lab JsonCache `chat/link/<hash>`).
- **Header**: ← · name (+ "typing…") · 📹 call · ⋯ (make flashcards, pinyin for all, translations for all; a Claude
  practice chat adds voice settings and "All practice chats"). No rename / new conversation: one chat per pair. No "+ Cards" button any more (it is in ⋯ and in the message menu).
- **Jump to latest**: the round ↓ button bottom-right while scrolled up, with the "N new" badge.

## Message menu (`messageMenu`, `shared/chats/messageMenu.ts`; Lab `MessageMenu.kt` parity-tested)
- Phone: **long-press** (450 ms, haptic) → the bubble lifts (the rest dims) with the **reaction bar** (👍 ❤️ 😂 😮 😢 🙏 +)
  above it and the action list below (a bottom sheet on narrow screens). Web desktop: **right-click** opens it as a popover
  at the pointer; **hovering** a bubble shows a small 😊 (react) and ⋯ (menu) beside it.
- Items, in order (the function decides which apply): **Reply · Copy · Translate / Hide translation · Pinyin / Hide pinyin ·
  Explain · Save as flashcard · Make flashcards from selection · Check my Chinese (my own, learner) · Correct / Edit
  correction · Remove correction (tutor, on the student's text) · Make a card from the correction · Read aloud ·
  Word by word (Claude practice chat) · Discuss with Claude · Pin / Unpin · Edit / Edit caption · Delete · Select**.
  Items needing the network are disabled offline ("Needs internet").
- **Explain** → a sheet with the sentence, its translation and `SentenceWordBreakdown` (web) / `SentenceBreakdown` (Lab):
  one word per row (tap → add that word as a card) + "+ Add whole sentence as card". Data = `POST /api/sentences/explain-text`
  (cached on the device by text like the Coach's Explain).
- **Save as flashcard** → the whole message as ONE card: the Explain breakdown made into a sentence card with
  `breakdownSentenceCard` (fun_facts glossing every word = CARD_STANDARD for a sentence), opened in the add-card sheet
  (deck picker, duplicate warning) → `POST /api/decks/:id/notes` (content service).
- **Make flashcards from selection** / **Select** → selection mode with this message ticked; the bar at the bottom:
  "N selected" · Copy · Make flashcards (→ the existing review sheet, `…/flashcards/propose`).
- **Swipe right** on a bubble (touch) → reply (the bubble follows the finger up to 72 dp, a ↩ fades in, haptic at the
  threshold 56 dp).

## Composer (one row)
`[ + ]  [ 😊  Message…            ✓ ]  [ 🎤 | ➤ ]`
- **+** opens the attach sheet: 📷 Camera · 🖼 Photo · 💡 Help me say it (+ later: 📄 File).
- **😊** inside the field: the emoji panel (recent + all) inserting at the caret.
- **✓** inside the field (learner, the draft has Chinese): Check my Chinese before sending (#493's panel).
- **🎤 → ➤**: the mic becomes Send as soon as there is text. **Hold** the mic to record (timer + red dot + level);
  release = send; **slide left** ≥ 100 dp = cancel ("‹ Slide to cancel"); **slide up** ≥ 80 dp = lock (hands-free, then
  ■ stop → preview / ➤ send / 🗑). A quick tap shows "Hold to record" and starts nothing.

## Voice-first composer (dictate the message — the default)
Jerome: "the default should be speaking". The composer opens on the voice side (shared/voice/dictation.ts, the same
controller / live Soniox stream / upload fallback as the study cards; web `components/chat/DictationComposer.tsx` +
`hooks/useVoiceDictation.ts`, Lab `ChatComposer.kt` `DictationRow`):

| State | Row |
|---|---|
| idle | `[ + ] [ ⌨️ ] [ 🎤 Say it ............ ] [ 〰 ]` |
| listening | `[ ✕ ] [ 我明天下午有空… (live, grey tail) ] [ ⏹ ]` — the other side sees "typing…" |
| review | `[ 🔁 ] [ 我明天下午有空，三点可以吗？  ✏️  ✓ ] [ ➤ ]` |
| failed | `[ ⌨️ ] [ Couldn't transcribe — tap to retry ] [ 🔁 ]` (or "Didn't catch anything") |
| typing | the composer above, with a 🎤 in the pill to go back to speaking (typed text kept, the take added to it) |

- **Two microphones, two jobs, never the same glyph.** 🎤 **Say it** (the wide blue button) writes TEXT. The round
  **waveform** button records a **voice message** — hold / slide / lock exactly as before; a tap explains "Voice message:
  hold to record, release to send. To write it by speaking, tap 🎤 Say it." It is ONE element in the row on both sides
  (web: one call site outside the row's ternary; Lab: the `mic` branch), so a hold survives the row turning into the
  recorder. Claude role-play chats have no voice messages: only dictation.
- **Review**: tap the text or ✏️ = Edit (into the typing box, keyboard up); ✓ = Check my Chinese on what was said (the
  learner; its "Use this" goes into the typing box, "Send as is" sends the transcript); ➤ sends it as a normal text
  message (outbox, `client_id`, auto-check — nothing differs from typed). 🔁 says it again.
- **Drafts**: a saved draft opens the typing box; leaving on a review keeps the transcript as the draft (web). Typing
  sends also go through the voice box (`voice.submit()`), so `voice_input.used` { surface: chat, outcome: submitted |
  edited | typed | … } counts every send.
- Offline: speaking is off (the outbox still takes typed messages) — the typing box, no 🎤; mic blocked / not found → a
  one-line reason under the composer.
- The other free-text boxes where he writes are voice-first the same way (`VoiceTextInputView` / `VoiceTextFieldContent`):
  Ask Claude (`ask_claude`, Ask), Discuss with Claude (`chat_discuss`), the Sentence Coach's sentence box (`coach`: the
  review runs ✏️ Check / 🔍 Explain or Translate on what was said) and follow-up (`coach_chat`, Send), Flag for tutor
  (`card_flag`, English hints). Enter still sends from the typing textarea of the chat-like ones
  (`components/voice/enterToSubmit.ts`).

## Voice bubble
▶/⏸, a real waveform (peaks of the decoded clip, 40 bars, cached per message; seeded bars until decoded), the elapsed /
total time, and a **speed chip 1× → 1.5× → 2×** (remembered on the device). Transcript + pinyin / translation as in #491/#493.

## Notes from the Lab app (round 2)
- A long press on a word chip (or on a voice transcript) opens the same menu as the bubble — otherwise a long press on
  Chinese text would only ever hit a chip.
- "A quick tap" on the mic = released within 250 ms; the menu is a bottom sheet at every width (the message is shown
  lifted inside it); the voice transcript stays a card under the bubble.
## Round 2 — PR 3: the rest of a normal chat app (migration 0095_chat_forward.sql)

```sql
ALTER TABLE messages ADD COLUMN forwarded_from TEXT;   -- the source message of a forward
```
```ts
type ChatAttachment = /* image | voice as before */
  | { kind: 'file'; name: string; bytes: number; mime: string }                    // ≤ 20 MB
  | { kind: 'video'; bytes: number; mime: string; duration_ms?: number | null;
      width?: number | null; height?: number | null };                             // ≤ 25 MB
```
- **Files** — `POST /api/conversations/:id/media?kind=file&name=<file name>&client_id=&caption=`. The extension decides
  (`FILE_TYPES` in `worker/src/services/chat/media.ts`: PDF, Word / Excel / PowerPoint / ODT, txt / csv / md / rtf, zip,
  .apkg, epub, mp3 / m4a, pictures) — never HTML / SVG / scripts; a `.pdf` must start with `%PDF-`; the name is cleaned
  (`cleanFileName`: no path, no control characters, ≤ 200). Served by `GET /api/chat-media/:id` with
  `Content-Disposition` (`inline` for a PDF, else `attachment`, `filename*=` UTF-8), `X-Content-Type-Options: nosniff`
  and `Content-Security-Policy: sandbox`. Bubble: icon by type, name, size · type; a tap downloads it (with the session's
  auth) and opens a PDF in a new tab / saves anything else. Clients download a file only when it is opened.
- **Video clips** — `kind=video&duration_ms=&width=&height=` (the sender's device reads length and shape); MP4 / WebM /
  MOV by their magic bytes. Bubble: the platform player, sized by the clip's shape.
- **Several photos at once** — the photo picker takes up to 10; the compose sheet shows them as a grid (✕ drops one),
  the caption goes with the first; each photo is its own message (own client_id, own outbox row).
- **Forward** — menu → Forward (or Select → Forward for several, oldest first) → "Forward to…" lists every person I
  chat with (one chat each, newest first, "· this chat" marked; not the Claude practice chats) →
  `POST /api/messages/:id/forward { conversation_id, client_id }` → a new message from ME there, same text / caption,
  the media copied to its own `chat-media/<conv>/<newId>.<ext>` (a voice message keeps its transcript), `forwarded_from`
  set, idempotent by client_id; 400 no conversation, 403 not a member of either, 409 deleted, 410 the file is gone.
  Shown as "↪ Forwarded" on top of the bubble.
- **Message info** — menu → Info: from, sent, edited, "Read by <name>" (from the read marker: Yes ✓✓ / Not yet),
  forwarded, pinned, corrected, the attachment (photo size, voice length + transcript state, file name, video length,
  bytes), characters, reactions with who.
- **Drafts per conversation** — the compose box keeps what was typed per conversation on the device
  (web `services/chatDrafts.ts` localStorage, newest 50; Lab JsonCache), restored when the chat opens, cleared on send.
- **Offline queue indicator** — while this chat's outbox holds sends the header subtitle says
  "🕓 1 message waiting for a connection" (offline) / "🕓 Sending 2 messages…" (online); each pending bubble keeps its 🕓.
  (Web: the app-wide "Offline" badge is hidden on the chat page — it covered Send.)
- The message menu gains **Forward** (after Copy) and **Info** (after Pin) — `messageMenu` in shared/chats/messageMenu.ts.

## Photo albums (migration 0118_chat_albums.sql)

Several photos picked together arrive as ONE bubble the person can tap and swipe through (WhatsApp / Signal style).

```sql
ALTER TABLE messages ADD COLUMN album_id TEXT;            -- photos picked together share it (client-chosen, client_id shape)
ALTER TABLE messages ADD COLUMN album_index INTEGER;      -- 0-based place in the album
ALTER TABLE messages ADD COLUMN album_notified_at TEXT;   -- set on the ONE photo that sent the album's notification
```
- **Still one message per photo.** Forward, delete, reactions, read receipts, info all keep working per photo; an album is
  only how consecutive messages render. The sender's app gives every photo of a multi-select its own `client_id` and
  outbox entry plus the shared `album_id` / `album_index` and `album_count` (2–10):
  `POST /api/conversations/:id/media?kind=image&…&album_id=&album_index=&album_count=` (400 on a malformed set; ignored on
  non-photos). The outbox sends a conversation's entries in order, so an album queued offline stays together. The caption
  and the reply ride on the FIRST photo (as before albums).
- **Grouping** — `layoutBubbles` (shared/chats/bubbles.ts; Lab `ChatBubbles.kt`, parity-tested by
  `parity/fixtures/chat-albums.ts`) emits `kind: 'album'` items with `messageIds` + `captionId`:
  consecutive messages from one sender with the same `album_id`; a deleted photo is hidden inside its album, a run with
  no photo left is one "Message deleted" bubble, an album left with one photo is a plain photo bubble. **Photos sent
  before albums** (no album id) group when they are consecutive photos from one person on one local day, each within
  `ALBUM_LEGACY_GAP_MS` (10 s) of the previous, and none but the first has a caption. An album is one bubble of its
  group; its tick is the worst of its photos' (failed › pending) else its last photo's; the caption shown is the last
  photo with one.
- **Bubble** — `albumTiles(n)`: 2 side by side, 3 = one big + two small, 4 = 2 × 2, 5+ = 2 × 2 with "+N" on the last
  tile; one rounded bubble, fixed size per layout (loading placeholders never move the thread), time + ticks inside on
  the last tile (on the caption line when there is one). Web `components/chat/AlbumBubble.tsx` (+ `chat-album.css`), Lab
  `ui/chat/ChatAlbumViews.kt` (`ChatRow.Album`, pending outbox photos join their album with 🕓 per tile).
- **Viewer** — a tap opens the photo tapped, swipe left / right through the album, "3 / 5" (`albumCounter`), pinch /
  double-tap zoom (a zoomed photo pans instead of swiping). Web: pointer swipe, ‹ › arrows where there is a mouse,
  arrow keys, Escape; the Android back gesture closes only the viewer (`useBackLevels`); Save / Forward / Delete (mine)
  of the photo on screen. Lab: `HorizontalPager` in a Dialog (back closes it), Share / Forward / Delete (mine).
- **Menu** — long-press an album: `albumMenu(messageMenu(head), n)` (shared; Lab `MessageMenu.albumMenu`, parity-tested):
  Reply, Copy / Explain / Save as flashcard (the caption), **Forward all N** (each photo forwarded with ONE new album id —
  `POST /api/messages/:id/forward { …, album_id, album_index, album_count }` — so it is an album there too), Pin, Info,
  Edit caption, **Delete all N** (confirm "Delete these N photos?"). The single-message actions act on the album's
  **head** = its caption's photo, else its last. **Reactions go on the album's LAST photo** (and the bubble shows that
  photo's reactions).
- **Notifications** — one per album, not one per photo: the first photo of an album to reach the worker claims it
  (`claimAlbumNotification`: one atomic `UPDATE … album_notified_at WHERE NOT EXISTS (a claimed photo of this album)`) and
  FCM / Web Push / e-mail / the bell / ntfy say **"📷 3 photos[: caption]"** with the declared `album_count`; FCM data
  carries `album_id` + `album_count`. The other photos only go out live (the ChatHub `message` event stays per message,
  now with `album_count`). A re-sent photo (same client_id) returns 200 and notifies nothing. The inbox row
  (`GET /api/me/chats`) counts the album's photos and shows its caption; `GET /api/me/chat-inbox` lists an album once
  (its first photo, `album_id`, `album_count`). The Lab keys a notification line by `album:<conv>:<album_id>`
  (`IncomingChat.lineKey`), so FCM, the live socket and the inbox check never add a second line. `chatMessagePreview`
  takes `album_count` (Lab `ChatInbox.messagePreview`, parity-tested). Listening mode is unaffected (photos are never hidden).
- Analytics: `chat.album_sent { count, offline }`, `chat.album_viewer_open { count, index }`.

## System messages (migration 0132_chat_system_messages.sql)

Jerome (Lab screenshot of his chat with Minghui): the lines the PLATFORM posts on someone's behalf read as if the
person typed them, in the first person — "I've set your new cards to 2 a day (+5 extra) 📚", "📹 I started a video
call — join here: …". They are now **system messages**: visibly different, third person, from the viewer's side.

```sql
ALTER TABLE messages ADD COLUMN system_kind TEXT;   -- NULL = an ordinary message
ALTER TABLE messages ADD COLUMN system_data TEXT;   -- JSON, per kind (shared/chats/system.ts)
CREATE INDEX idx_messages_system ON messages(system_kind) WHERE system_kind IS NOT NULL;
```

**Kinds** (the person the platform speaks for stays the sender — permissions, the one chat, unread counts, receipts):

| kind | posted by | data | the recipient reads | the sender reads |
|---|---|---|---|---|
| `study_budget` | the tutor's "Daily new cards" change (`PUT …/student-study-budget`) | `new_cards_per_day`, `secondary_cards_per_day`, `is_default` | 📚 Minghui set your new cards to 2 a day (+5 extra) | 📚 You set Jerome's new cards to 2 a day (+5 extra) |
| `call_started` | `POST /api/calls` (the Join link) | `call_id`, `ended?`, `missed?` | 📹 Minghui started a video call · **Join** → Video call ended / Missed video call from Minghui | 📹 You started a video call · **Join** → Video call ended / Video call · Jerome didn't join |
| `card_flag` | the student's Flag for tutor (`POST /api/card-flags`) | `flag_id`, `note_id`, `hanzi`, `pinyin`, `english`, `message` | 🚩 Jerome flagged 银行 for you + “their note” · **Open card** (her view of his card) | 🚩 You flagged 银行 for Minghui + the note · **Open card** |
| `flag_reply` | the tutor's reply to a flag | `flag_id`, `note_id`, `hanzi`, `reply` | 🚩 Minghui replied about 银行 + “her reply” · **Open card** | 🚩 You replied about 银行 + the reply |
| `install_howto` | Send how-to (`POST …/send-howto`) | `app_url` | 📲 Minghui sent you how to install the app · Show the steps | 📲 You sent Jerome how to install the app |
| `group_class` | the group class's "send the link" | `group_name`, `session_id` | 🧪 Minghui started the group class “周三班” · **Join** | 🧪 You sent Jerome the link to the group class “周三班” |

Quoted words (a flag's note, a reply) are the person's own and are never rewritten. The invite's `welcome_message`
is the inviter's own words and stays an ordinary message; the MCP `send_message_to_student` and the session-notes
agent's draft messages are typed by / for the tutor and stay ordinary too. There are no automated homework notices.

- **One definition**: `systemMessageView(msg, { viewerIsSender, otherName, relationshipId })` → `{ kind, icon, text,
  quote, body, action, quiet }` and `systemMessageText` (one line: Copy, previews) in `shared/chats/system.ts`; Lab
  `core/…/chat/SystemMessages.kt`, parity-tested (`parity/fixtures/chat-system.ts`). An unknown kind (a newer server)
  shows the stored text as a plain system row; malformed data falls back the same way.
- **`content` is the readable fallback**: the RECIPIENT's view in the third person (`systemFallbackContent`, worker
  `services/chat/system.ts` `postSystemMessage`), plus what an older app needs — the call / group-class "— join here:
  <url>" (old Lab builds still find the Join link) and the install steps. So e-mails, Web Push, FCM, the bell, ntfy
  and old app versions all read "Minghui set your new cards to …" — nobody says "I" any more.
- **Rendering** (web `components/chat/SystemMessageRow.tsx`, Lab `ui/chat/ChatSystemViews.kt`): a centred, compact,
  muted row like the day pills — never a bubble: no ticks, reactions, swipe-to-reply, listening-mode hiding, read-aloud,
  word chips or auto-check. `layoutBubbles` gives it `kind: 'system'` and keeps it out of groups (it ends the group
  before it); `messageMenu` gives it Copy only (long press / right-click), which copies what THIS person reads. An
  ended call is quieter (no background).
- **Calls**: `markCallEnded` sets `ended`; the CallRoom's end (`finishEnd`) also sets `missed` (nobody but the caller
  ever joined) and sends `message_updated`; `updated_at` is bumped so `?since=` polling picks it up.
- **Inbox / previews**: `/api/me/chats` rows carry `system_kind` / `system_data` and the server's preview is already
  from my side; `chatRowPreview` re-reads it (never "You: …"); `/api/relationships/:relId/conversations` carries them
  for the student / tutor page's "Messages" row; `/api/me/chat-inbox` and FCM data carry `system_kind` (the Lab never
  masks one as "🎧 New message"). The server never makes word chips, translations, read-aloud clips, corrections or
  forwards of a system message, and refuses to edit one (409).
- **Existing rows**: the migration tags the messages the code wrote by their EXACT templates ("I've set your new cards
  to N a day (…) 📚", "… back to the usual …", "📹 I started a video call — join here: …/calls/<id>", "🚩 Flagged 字
  (pīnyīn · meaning): …" matched to its `card_flags` row when the word is unchanged, "🚩 About 字: …", the install
  how-to, the group-class link) and fills the data it can parse; anything else stays an ordinary message. Their stored
  text is left as it was (older apps keep showing it).
- Analytics: `chat.system_action { kind }` (Join / Open card).

## Chats tab (the inbox)

The bottom tab bar's **Chats** tab (it replaced Decks; Decks is now the first row of More, Home's
"All decks →" and `/decks` as before) opens `/chats` (web `pages/ChatsPage.tsx`, Lab `ui/chats/`):
one row per person (one chat per pair) across every active relationship — round avatar (picture,
else an initial on a colour), the person's name (Claude practice chats add their title when there
are several), the last message preview ("You: …", 📷 Photo, 🎤 Voice message, Message deleted),
a relative time (14:32 / Yesterday / Mon / 28 Sep / 28 Sep 2025) and a bold unread count. Newest
activity first; Claude role-play chats (the same `conversations` rows) in their own "Practice with
Claude" section. Search filters by name, title and last message. ✏️ → the person picker (when
there's more than one) → `/connections/:relId/chat` → THE chat with them. A row opens the chat with router state
`{ from: '/chats' }`, so ← returns to the inbox (`chatBackTarget`).

- `GET /api/me/chats` → `{ server_time, conversations: ChatListRow[] }` — ONE query
  (`getChatList`, `services/chat/reads.ts`): conversation + relationship + the other user + the last
  message (correlated subquery on `messages(conversation_id, created_at)`) + my unread count.
- The rules (sorting, title, preview, relative time with an explicit UTC offset, search, the badge
  count, live updates) are `shared/chats/inbox.ts`; the Lab's `core/…/chat/ChatInbox.kt` is
  parity-tested against it. `chatMessagePreview` is also the server's `messagePreviewText`.
- Offline: the list is cached (web localStorage `chat-list-v2:<user>` (v2 since one chat per pair), `hooks/useChatList.ts`; Lab
  JsonCache) and renders instantly; refreshed on open, focus and every minute. While the inbox is
  open it holds the ChatHub socket: `message` / `message_updated` / `read` events update the cached
  list (`applyIncomingMessage` / `applyReadMarker`; an unknown conversation → refetch).
- The tab badge = conversations with people (not Claude) that have unread messages
  (`unreadConversationCount`).

## Chats tab — one list for people and Claude

Jerome: "Unify the coach page and the chats page. Really easy to get to the coach, but also easy to
message your tutor(s)." The Chats tab (`/chats`, web `pages/ChatsPage.tsx`) is ONE list of the chats
with people (`GET /api/me/chats`, above) and the chats with Claude (`GET /api/claude/threads`, "Claude
threads" below), merged by ONE pure rule — `mergeInbox` in `shared/claude/inbox.ts` (Lab core
`claude/ClaudeInbox.kt`, parity-tested by `parity/fixtures/claude-chats.ts`):

- **Rows** (compact since Nov 2026 — Jerome on the first version: "The vertical space is too much;
  compress things down"): kind `tutor` (they teach me), `student` (I teach them) or `claude`. Each row
  is ONE line, ~60 px / dp: the avatar (40, a photo / initial, ✦ for Claude), the name or title (one
  line, ellipsis), the time on the right, the unread count. **No preview line, no outlined card, no
  kind label** — the sections and the avatars carry the kind (never colour; Jerome is red / green
  colour-blind), and the kind in words is there for screen readers (`inboxRowLabel`: web a hidden
  ", Tutor", Lab the avatar's content description).
- **Sections** (`inboxSections`): the people first — a learner's UNREAD tutor chats pinned on top,
  then by newest activity — then a thin full-width light-grey divider (only when both are there), then
  the Claude chats, newest first (a thread's last message, else its creation; ties by key). Archived
  threads are left out. The All · Tutor · Claude filter chips are gone (`chats.filter` is marked
  replaced): tutor chats are persistent, one per person, and always on top.
- **A Claude row** adds ONE context emoji after its title (`contextBadge(…).icon`): 📇 card, 📖
  reader, 🧩 exercise, 🎭 practice, 💬 message, ✏️ check, 🔍 explain, 🔤 translate. Tapping the emoji
  (a 36–40 px target, aria-label / content description = the full text) opens a small popover — the
  full text ("📇 Asked on card · 银行") and, when it leads somewhere, **Open card ›** / **Open story ›**
  / **Open lesson ›** (`contextOpenLabel` over `headerChipFor`'s link: the card hub, the reader at that
  page, the lesson player); Escape / a tap elsewhere closes it (web), a dropdown on the Lab. Tapping
  the row opens `/chats/claude/:id` with `{ from: '/chats' }`. Instead of the time a row says
  `claudeRowStatus`: "✦ Writing…" while Claude writes, "⚠ Failed" (open to retry), "🕓 Waiting" for
  one started offline.
- **Practice chats appear once**: an `is_ai` conversation (an old Claude role-play chat) is dropped
  when the device has its `practice` thread (`pc-<conversation id>`, the server's backfill) and is
  otherwise a Claude row of its own that opens the old chat.
- **Search** (`filterInbox`) looks at names, titles, the last messages (not shown, still searchable)
  and the context texts.
- **The box at the bottom** (`components/chats/ChatsComposer.tsx`; `.page-footer`, so it sits above
  the tab bar once the list is long), Claude.ai style, voice-first and compact. It ALWAYS goes to
  Claude — the "To: ✦ Claude ▾" line is gone (✏️ New chat, top right, reaches a person). Idle it is
  one 44 px row: ✏️ Type · 🎤 Say it. Placeholder "Ask Claude anything…"; the main button is **Ask**
  (Enter). **✏️ Check + 🔍 Explain (Chinese) / 🔤 Translate (English) appear only once there is text**
  — typed (then beside Ask, one row) or a finished take (under its review; never mid-speech)
  (`ClaudeChatComposer intentsOnlyWithText`, `composerFor('general', …)` + `coachButtons`). Sending =
  `startClaudeThread({ context: general, intent })` → the new thread opens
  (`/chats/claude/:id?source=chats`) with the reply streaming; offline it is queued in the Claude
  outbox and the thread opens under its client id. ✏️ (top right) = "New chat with…": ✦ Claude
  (focuses the box), 🎭 Practice a situation…, or a person.
- **The tutor's view** (a tutor account or an account with students — `useNavRole`): the same layout
  — her students (and her own tutor) first, newest first, no pinning; the divider; her Claude chats,
  unfolded (the folded "✦ Your Claude chats (N)" header was dropped: with one-line rows the divider
  already separates them, and the fold cost a tap and a row of its own). A student's row keeps
  "✦ Asked Claude 3× today" under it. Her box offers Ask · Translate only (the Coach's Check / Explain
  are a learner's tools).
- **Offline / live**: the people list from its localStorage cache (above); the threads from Dexie
  `claudeThreads` (the thread view's cache), refreshed by `services/claudeInbox.ts`
  `syncClaudeThreadList` — the whole list the first time (or when the table is empty), then
  `?since=<server_time>` (cursor per account in localStorage) with `deleted_ids` — on open, focus,
  `online`, every minute, a socket (re)connect and every `claude_turn` that finishes; a turn starting
  marks its row "✦ Writing…" at once (`useClaudeInbox`).
- **Coach entry points** (`pages/CoachEntry.tsx` `coachEntryTarget`): `/coach` (and the widget's
  `?focus=1`) → `/chats?compose=1` (the box, typing); `?c=<id>` → `/chats/claude/<id>`;
  `?text=&action=` (or English text, which can only be translated) → a new thread with that intent;
  Chinese `?text=` without an action / `?draft=` → the box with the text. Two exceptions keep the
  Coach page (`SentenceCoachPage`), as #690 left them: "Open in Coach" from a chat message
  (`from_message`, reuses the stored auto-check) and anything opened from a study card (its return
  path is set → "Back to your card"); once shown, the Coach page keeps its own `?c=` for that visit.
  More → "✦ Ask Claude / Coach" → `/chats?compose=1`. A mistake lesson's ← goes back to its thread.
- **Analytics**: `chats.open { kind }`, `chats.context_info { context_kind, action: show | open }`,
  `chats.compose_send { intent, offline, spoken }` (+ `claude.message_send`); `chat.inbox_open`
  counts both kinds. `chats.filter` and `chats.compose_to_person` are kept in the catalogues for old
  builds, `replacedBy: 'chats.open'`.
- **Lab app** (`android-lab/app/…/ui/chats/`): the same screen — `ChatsScreen` (one-line rows over
  core `ClaudeInbox`, the divider, the context emoji's `DropdownMenu`), `ChatsComposer` (the
  voice-first box: `VoiceTextFieldContent(compact = true, submitRowExtra = …)`), `ChatsViewModel`; the thread list in the JsonCache
  (`data/claude/ClaudeThreadList.kt`: whole once, then `?since=` + `deleted_ids`; every thread response
  the thread screen caches is written over its row; threads started offline from their own entries;
  synced after every core sync too). Route `/chats?compose=1&text=`; `/coach` → `CoachEntry` in
  `ui/coach/CoachNav.kt` (the study card's links carry `from=card`, the Coach page's own `from=coach`).

## One chat per pair (migration 0102_one_chat_per_pair.sql)

Jerome: "Make it so there's only one chat between each pair of people — each student–tutor combination."
A tutor relationship has exactly **one** human conversation. (Claude role-play / practice chats are not
tutor–student chats: they stay in "Practice with Claude" and may be several.)

```sql
ALTER TABLE conversations ADD COLUMN merged_into TEXT;   -- set on a conversation merged into its pair's one chat
CREATE UNIQUE INDEX idx_conversations_one_human_per_relationship
  ON conversations(relationship_id) WHERE merged_into IS NULL AND COALESCE(is_ai_conversation, 0) = 0;
```

**The merge** (in the migration, run once by CI): per relationship with several human conversations the
**primary is the most recently active one** (newest message, else last_message_at, else created_at;
ties → oldest) — the chat both people were last using, so the device state keyed by its id (drafts,
pinyin / translation toggles, notification grouping) carries on. Every message moves into it (`UPDATE
messages SET conversation_id`) and with them everything keyed by message: reactions, pins, corrections,
words, replies, discussions, forwards, attachments (the R2 key `chat-media/<oldConv>/<msg>.<ext>` lives in
`messages.attachment` and is served by message id, so it never moves). Read markers: the furthest per
person (`max`). In-app notifications point at the primary. The rest are marked `merged_into = <primary>`
(never deleted). Times are compared with `julianday()` (old rows use `datetime('now')`, new ones ISO).
A conversation in a relationship with the Claude user is flagged `is_ai_conversation = 1` first.

**API**
- `POST /api/relationships/:relId/conversations/open` → `{ conversation_id, created }` — THE chat (get-or-create,
  race-safe through the unique index: `INSERT OR IGNORE`, then read). `services/conversations.ts`
  `openRelationshipConversation` is the one server path: call Join links, card-flag mirrors, the welcome
  message, the install how-to, budget changes, the session-notes agent and the MCP all post through it.
- `POST /api/relationships/:relId/conversations` — with a person returns the one chat (200; 201 when made now;
  `title` ignored); with Claude a new practice chat (201).
- `GET /api/conversations/:id` → the conversation; a merged-away id answers with the primary and
  `merged_from: <the id asked for>`.
- **Every `/api/conversations/<merged id>/…` request is served as the primary** (`mountMergedConversations`,
  `routes/one-chat.ts`): re-dispatched inside the worker with the new id — no redirect, so POST bodies and the
  Authorization header survive (old pushes, e-mail links, cached ids, outbox sends). Response header
  `X-Conversation-Id: <primary>`. `POST /api/messages/:id/forward` resolves a merged target the same way.
- `PATCH /api/conversations/:id { title }` → 410 on a chat with a person (Claude practice chats can still be renamed).
- `GET /api/relationships/:relId/conversations`, `/api/me/chats`, `/api/me/chat-inbox` never list merged rows.

**Clients** (web + Lab): no "New conversation", "Add a title / Rename" or "All conversations"; the inbox has
one row per person (`chatRowTitle` drops the title for people); ✏️ → pick a person → their chat; the
student / tutor page shows ONE "Messages" row (last message, unread) instead of a list; `/connections/:relId/chat`
opens the one chat (`/chat/new` and `?new=1` land there too; with Claude they open the Chats tab's "🎭 Practice a
situation" sheet — `/chats?practice=1` — since role-plays are Claude threads, "Practice with Claude").
Opening `/connections/:relId/chat/<merged id>` swaps the URL to the primary (carrying an unsent draft along),
so live events, read markers and notifications line up.

---

## Listening mode (migration 0099_chat_listening.sql)

Jerome: "Hide the messages initially but let me play them out loud, so I can try my listening comprehension on a
new message. A long click on the hidden message reveals it, a single click plays it."

```sql
CREATE TABLE chat_listening (conversation_id, user_id, listening INTEGER, since TEXT NULL, updated_at, PK (conversation_id, user_id));
ALTER TABLE users ADD COLUMN chat_listening_default INTEGER NOT NULL DEFAULT 0;   -- Settings → Chat
```

**Rules** — `shared/chats/listening.ts` (Lab `core/…/chat/ChatListening.kt`, parity-tested by
`android-lab/parity/fixtures/chat-listening.ts`):
- The setting is per person and conversation: `{ on, since }`. No row → the account default (`chat_listening_default`)
  with `since = null` ("undecided"); `effectiveListening(row, defaultOn)`.
- A message hides (`shouldHideMessage`) when the mode is on, it is a **candidate** (`listeningCandidate`: the other
  person's, not deleted, no attachment — photos / voice memos / files / videos stay as they are — and it contains
  Chinese), it is not revealed on this device, and `created_at > threshold`. Threshold (`listeningThreshold`) =
  `since`, or — while undecided — the read marker the chat was opened with (what was unread hides). The client
  then stores that marker as `since` (one PUT), so the choice is stable on every device.
- Turning it ON from the menu: `since = sinceWhenTurnedOn(messages)` = the newest message on screen — history stays,
  anything newer hides. **Hide all**: `since = HIDE_ALL_SINCE` (1970) — every candidate hides (revealed ones stay).
  OFF shows everything (revealed ids are kept).
- Revealed ids are device-local per conversation (`addRevealed`, newest 500; web localStorage
  `chat-listening-revealed-v1:<conv>`, Lab JsonCache `chat/listening/revealed/<conv>`). Never synced.
- The inbox and notifications never spoil a hidden message: `LISTENING_PREVIEW` = "🎧 New message".
  Inbox: `listeningPreview(row.last_message, { setting, readMarker: row.my_read_at, revealed })` (rows now carry
  `last_message.attachment_kind` and `my_read_at`). Push / FCM / e-mail / the bell row / ntfy: the worker's
  `notificationPreviewFor` (the recipient's setting; a new message is always after `since`).

**API** (`routes/chat-listening.ts`):
- `GET /api/me/chat-listening` → `{ default_on, conversations: [{ conversation_id, on, since, updated_at }] }`
- `PUT /api/conversations/:id/listening` `{ on, since? }` (ISO UTC or null) → the row; member only (403 / 404), 400 bad body
- `PUT /api/profile/chat-listening` `{ on }` → `{ default_on }`
- `GET /api/me/chat-clips[?per_conversation=20]` → `{ clips: [{ message_id, conversation_id, text, voice_id, speed }] }` —
  the other person's newest Chinese text messages in each chat with a person, in the voice the CALLER hears them
  (`chatReadAloudVoice`), for background prefetch.

**Audio = the one chat read-aloud path** (`shared/chats/voice.ts`, "Chat read-aloud voice"): the hidden bubble's tap
plays exactly what Read aloud plays — the sender's `voice_gender` over the listener's conversation voices, speed
`CHAT_READ_ALOUD_SPEED`, `POST /api/practice/tts` with the server's R2 `tts-cache/` (by text + voice + speed), device
cache by the same triple (`getTTSWithCache`; Lab the same cache as Read aloud).
- **Pre-generated** (`services/chat/message-audio.ts` `pregenerateMessageClip`, waitUntil): after a Chinese text
  message is sent, forwarded or edited, the clip the OTHER person will hear is made into `tts-cache/` — so their tap
  (or prefetch) is a cache hit. An edit is new text → a new clip. Claude role-play chats are skipped.
- **Prefetched on the device** (both apps): on chat open and as messages arrive (`prefetchSelection(messages, me, 20)`,
  ~2.5 s after a change so the server's clip is usually there), on a live `message` event while a chat / the inbox
  is open (→ `/api/me/chat-clips`), and in background sync (`/api/me/chat-clips`). A tap then plays at once, offline.

**Reused by Ask Claude** (docs/STUDY_SESSION.md "Ask Claude" → 🎧 Listen first): the study card's Ask Claude sheet
hides Claude's Chinese answers with this same bubble, player, 0.75× chip and Read-aloud clip path (in Claude's fixed
voice, `ASK_CLAUDE_VOICE`); its setting is `users.ask_claude_listening`, its rules `shared/study/askClaude.ts`. Unlike
the chat, a new answer plays once by itself.

**UI**
- Chats with a person only (a Claude role-play chat's replies are spoken already: no toggle there).
- Chat header ⋯ → **🎧 Listening mode** (a checkbox item; on → off), and while on **🙈 Hide all messages**.
  Settings → Chat → **Listening mode in new chats** (the default). The header subtitle shows "🎧 Listening mode".
- A hidden bubble: the normal received bubble (same size class, grey), the text replaced by 🎧 + 24 bars
  (`listeningBars(id)`, stable per message) + the duration (`formatListeningDuration` of the clip, else
  `~estimateSpeechSeconds(text)`), and the hint "Tap to listen · hold to reveal". Time / reply quote / reactions as usual.
- **Tap** plays (bars animate, ▶ → ■; a tap while playing replays from the start). A small **0.75×** chip on the
  bubble toggles slow playback (remembered on the device). **Long-press** (same 450–500 ms) reveals with a haptic and an
  un-blur animation (blur 8 px → 0, 260 ms) — it does NOT open the message menu; once revealed, long-press opens the
  menu again. A small **👁** button beside the bubble reveals it too (accessibility). Offline with no cached clip:
  "Audio not downloaded yet" notice.
---

# Auto-check — "How to say it better" (migration 0101_chat_auto_check.sql)

Jerome: "When a student sends a message, automatically check if there can be improvements. If so, show a slight visual
indicator… When they long-press the message, the top option should be 'understand how to make it better'."

```sql
ALTER TABLE messages ADD COLUMN auto_check TEXT;        -- JSON AutoCheckResult (shared/chats/autoCheck.ts) incl. the text it was about
ALTER TABLE users ADD COLUMN chat_auto_check INTEGER;   -- NULL = default (on for the learner side), 1 = always, 0 = never
```
- **When**: after a text message is sent (live or replayed from the outbox — same `POST …/messages`, a repeated client_id is
  not checked again) or edited, `autoCheckMessageInBackground` (`worker/src/services/chat/auto-check.ts`) runs in
  `waitUntil` beside the translation / word chips. One `structuredCall` (`claude-sonnet-5`, Haiku on the last try, forced
  `check_message` tool, thinking off, the chat's last 6 lines as context, `CARD_STANDARD` for the cards). ≈ 2k tokens in,
  80–500 out ≈ $0.005–0.009 per check.
- **Who** (`autoCheckApplies`): the student side of a tutor chat and the person in a Claude practice chat by default; the
  account switch wins either way. **Skipped** (`autoCheckSkipReason`): no Chinese / emoji only, ≤ 2 content characters,
  more English words than Han characters, > 400 characters. A photo / file / video is checked on its **caption** and a
  voice message on its **transcript** once it exists (`autoCheckText`; before Oct 2026 every media message was skipped —
  see "Chat ↔ Coach").
- **Result** `{ text, status: ok | improvable, corrected, corrected_pinyin, corrected_english, mistakes: [{ quote, fix, why,
  card }], alternative, severity: minor | moderate | major, card, checked_at }`. The prompt flags only grammar errors, wrong
  words and clearly unnatural phrasing; `normalizeAutoCheck` turns an "improvable" that only changes punctuation into ok and
  drops cards that break a HARD card rule. Written only while the message still has that text; an edit clears it
  (`auto_check = NULL`) and re-checks; delete clears it. Idempotent: a stored result for the current text is not redone.
- **Delivery**: the message's `auto_check` (served only while `text` = content, and ONLY on the sender's own view — the
  tutor never gets it) through `message_updated` and `?since=`, so both apps get it live and offline.
- **Indicator** (`sayBetterState`, Lab `SayBetter.kt` parity-tested): on my own bubble a small amber ✎ in the meta row
  (shown even when the bubble isn't the last of its group), label "Could be better — hold to see". The tutor's correction
  takes precedence: state `corrected`, "<tutor> corrected this — hold to see".
- **Menu**: `say_better` "✨ How to say it better" is the FIRST item when improvable or corrected; a current auto-check
  (ok or improvable) replaces "Check my Chinese".
- **Sheet** (web `components/chat/SayBetterSheet.tsx`, Lab `ui/chat/`): You wrote (character diff, highlighted not struck —
  a line through 了 reads as 子) · Better (pinyin, English, ▶ via the conversation TTS) · each mistake "你说 X → Y" + why
  (+ card) · More natural · **+ Add as flashcard** (the add-card sheet with `card`) · **Ask Claude about this** (Discuss
  with Claude). Built from the stored result, so it works offline.
- **Setting**: `PUT /api/profile/chat-prefs { chat_auto_check: true | false | null }`; `/api/auth/me` → `chat_auto_check`
  (null = default). Settings → Chat → "Check my Chinese automatically" shows `autoCheckSettingShown` (on unless a tutor account).
- E2E seam: `POST /api/test/chat-auto-check { message_id, result? }` runs the real store + broadcast with a canned answer.

# Chat ↔ Coach (migration 0114_coach_background.sql)

Jerome: "Every message I send should be checked — I sent one with a photo and got nothing. When it finds something, give
me a clear way into the Coach. And Coach replies shouldn't die when I press back."

**Why the photo wasn't checked**: `autoCheckMessageInBackground` returned `skipped` for any message with an attachment,
and the media upload route (`POST /conversations/:id/media`) never scheduled a check at all. Now the checked text is
`autoCheckText(msg)` (`shared/chats/autoCheck.ts`): the caption of a photo / file / video, a voice message's transcript
once `transcript_status = 'done'` (the transcription job runs the check when it finishes), else the text. The result is
stored as before, served while `auto_check.text === autoCheckText(msg)`, and written only while the content AND the
attachment JSON are unchanged. `sayBetterState` (✎ + "How to say it better") follows the same text, so photo captions and
voice transcripts get the mark and the sheet ("You wrote" = the caption / transcript).

**Open in Coach** (web + Lab, same rules):
- `openInCoachRequest(msg, viewerId)` → `{ text, action }`: my own message is CHECKED, anyone else's EXPLAINED; null
  without Chinese. `coachDeepLink(req, messageId)` → `/coach?text=…&action=check|explain&from_message=<id>`.
- Message menu item `open_coach` "🎓 Open in Coach" (`messageMenu`): any message with Chinese (my own only when I'm the
  learner) — SECOND, right after "How to say it better" when that shows, else after "Save as flashcard".
- A small "🎓 Open in Coach" chip UNDER my bubble when the auto-check found something (`showCoachChip`: improvable, current
  text) — the bubble itself stays clean — and an "Open in Coach" button in the How-to-say-it-better sheet.
- The Coach runs a deep link with an explicit action at once (`coachDeepLinkAction`, shared/coach/actions.ts: an explicit
  valid action runs; without one only English runs — translate — and Chinese waits on its two buttons).
- `POST /api/coach/conversations { …, chat_message_id }`: when the message is MINE and its stored auto-check is about this
  very text, the check result becomes the analysis (`coachAnalysisFromAutoCheck`) — 201, no Claude call; the conversation
  remembers the message (`coach_conversations.source_message_id`), so opening it again returns the same conversation
  (200, `reused: true`). Someone else's message is never read for its check.
- Analytics `chat.open_in_coach { source: menu | chip | sheet, action }`.

**Coach replies keep going when you leave** (`worker/src/services/coach-replies.ts`, routes `worker/src/routes/coach.ts`):
- With `background: true` (both apps send it; older clients still get the inline answer) the start and every follow-up
  store the learner's message plus a PENDING assistant message (`coach_messages.status = 'pending'`) and return at once
  (202). `coach-reply-queue` (`max_batch_size = 1`, `max_batch_timeout = 0`) runs `runCoachReply`: claim (`attempts`,
  `started_at`), the first analysis (check / explain / translate) or the follow-up agent (a `coach` turn of the Claude agent harness,
  `services/claude-agent/`), then the tool actions through the content service (`applyCheckpointed`). Checkpoint: the model's answer + actions are saved BEFORE any action runs and
  `applied` after each, so a redelivery never asks Claude again nor makes a card twice. Busy / dropped model (429 / 5xx /
  network) → `retry` (another delivery 10 s later), ≤ 3 attempts; a refusal or the last attempt → `status = 'failed'` with
  a readable `error`. `POST …/messages/:id/retry` re-queues it (checkpoint kept). A reply pending > 10 minutes (a lost
  delivery) is swept to failed when the conversation / list is read. Without the queue binding it runs in `waitUntil`.
- Clients: a pending first answer shows the loading card ("You can leave — the answer will be here when you come back"), a
  pending follow-up "Thinking…"; the conversation polls every second while anything is pending, every 2.5 s once it
  has been pending 15 s (`coachReplyPollMs`, `shared/coach/poll.ts`; Lab `CoachActions.replyPollMs`); failed → the reason +
  Retry; the list shows "Thinking…" (`pending_reply`) / "⚠ Reply failed — open to retry" (`failed_reply`) and polls while
  any is thinking. Sending is disabled while a reply is pending (409 server-side). Offline: the send fails with "You're
  offline — the coach needs a connection" and the typed text is kept (not queued). Analytics `coach.reply_resumed` (opened
  a conversation still thinking from an earlier visit), `coach.reply_retry`.
- E2E_TEST_MODE: a stand-in model (2.5 s per answer, a tiny lexicon for Explain) so tests can leave the page first.

**The Coach conversation — no chips, tappable words, 🎤 Practise saying it** (Jerome, Oct 2026: "The Say it button is
confusing — it looks like I should practise the sentence above … Get rid of the 'Cards go to' selector and all the other
buttons here. I'm not going to add full sentences as flashcards anymore … Make the text clickable so I can go into the
character / word graph … When there's the big text at the top, I want to practise saying it"):
- **No quick-action row and no "Cards go to" deck picker** (web + Lab). Gone: the chat-prompt chips (🃏 Make a card ·
  📝 Card for the whole sentence · 💬 More examples · 🔀 Other ways to say it · 🔍 Explain the grammar), "⚡ Study … today"
  (the sentence-bump picker, `shared/decks/sentence-bumps.ts`, deleted with its Lab port), "➕ Add new words (N)" and
  "🃏 Card for this sentence" — and Explain's "+ Add whole sentence as card" in the coach (the chat's Explain sheet keeps
  it). Claude still makes cards / bumps / lessons through its chat tools when asked. Analytics `coach.quick_action`,
  `coach.add_new_words`, `coach.sentence_card` are now old paths. (`shared/coach/newWords.ts` + the Lab's
  `CoachNewWordsSheet` stay: the Lab's podcast episodes use them.)
- **"🎯 Mini lesson on this mistake"** moved from the chip row onto the check's own card (a full-width button under the
  critique, `coach-mistake-lesson`); same rules as below.
- **The follow-up composer's 🎤 says "🎤 Respond"** (`COACH_RESPOND_LABEL`; `sayLabel` on the web's `VoiceTextInputView`,
  the Lab's `VoiceTextFieldContent`) — only there: the other voice-first boxes keep "Say it".
- **Every Chinese text is tappable into the language explorer** (by word, the device segmenter; web
  `components/coach/CoachText.tsx` `CoachZh` / `CoachMarkdown`, Lab `ui/coach/CoachText.kt`): the big sentence (the
  correction, the translation, Explain's sentence), each "Other ways to say it", the critique / usage note / notes, the
  legacy explanation blocks and Claude's Markdown replies (text nodes inside paragraphs, lists, bold… — code and links
  untouched; the Lab's `MarkdownText(chinese = MdChinese(…))`). A word → the Word view (+ Add as card / ⚡ Study it today /
  Open card there).
- **🎤 Practise saying it** beside each big sentence and each alternative (`shared/coach/practise.ts`, Lab
  `core/…/CoachPractise.kt`, parity-tested; web `components/coach/PractiseSentence.tsx`, Lab `ui/coach/CoachPractise.kt`):
  ▶ plays the sentence (the lessons' cache-first practice TTS, `useLessonSpeak` / `LessonSpeaker`); 🎤 records a take
  through the voice boxes' pipeline (`useVoiceDictation` / `rememberVoiceDictation`, surface `coach_practise`,
  `autoSubmit`: live Soniox words while speaking, the upload fallback, "Couldn't transcribe — tap to retry" with the same
  take); ⏹ / 🎤 again, Enter, or a tap anywhere on the card (web: any pointer-down outside 🎤 while recording; Lab:
  `practiseTapToStop` on the card, which never consumes the tap) stops it. The take is checked like a spoken answer on a
  typing card: `tidySpokenTranscript` then `checkSpokenAnswer` (punctuation ignored, homophones by sound, other tones =
  close), shown in the compact "You said" row (`YouSaidRow` / `SpokenResultRow`: ✓ Match · ✓ Sounded right — written
  differently · ≈ Contains / Close — tones off · ✕ Didn't match, the differing characters marked), then 🔁 Try again. No
  review event, no recording kept. Offline: "Practising needs a connection." (🎤 disabled); a refused microphone says
  so and stays tappable. Analytics `coach.practise_say { result: match | sound | contains | close | wrong | failed | empty }`
  (+ `voice_input.used { surface: coach_practise }`).
- Lab: core `SayBetter.kt` / `MessageMenu.kt` / `CoachActions.kt` / `CoachPractise.kt`, parity-tested
  (`parity/fixtures/chat-round2.ts`, `coach.ts`).

**"🎯 Mini lesson on this mistake"** (Jerome: "From the coach menu, I want to start a mini lesson that's just for the
thing I typed in wrong … a few variants, a few different exercise types … then optionally save that to my mini lesson
queue"; `shared/coach/mistakeLesson.ts`, `worker/src/services/mistake-lesson.ts`):
- The button sits on the check's card (under the critique) after a ✏️ Check my sentence that found a mistake —
  `coachMistakeLessonOffered`: not `isCorrect` and the correction differs from what he wrote beyond spaces / punctuation
  (a seeded "Open in Coach" check counts too). Nothing for a sentence that was already right, for Explain or Translate.
- `POST /api/coach/conversations/:id/mistake-lesson` → 202 with a pending assistant message `content_type =
  'mistake_lesson'`, written by the SAME `coach-reply-queue` job (`runCoachReply` → `writeMistakeLesson`): claim,
  retries on a busy model, failed → a readable reason + Retry (asking again re-queues the same row), the 10-minute sweep.
  ONE per conversation: asking again returns it (200 `existing`), so reopening never regenerates it. A lesson being
  written doesn't block follow-ups (the 409 and the clients' "reply pending" ignore it). The chat history gets one line
  ("I wrote a mini lesson on this mistake: …"), never the spec.
- The writer: forced `create_lesson_spec`, thinking off, the lesson writer model (`LESSON_WRITER_MODEL`, as the
  companion lessons), `validateLessonSpec` + `mistakeLessonProblems` (a note first; 8–11 exercises after it; ≥ 4 types; a
  recognition exercise; a production exercise; no conversation / describe_image / oral_expression) with up to two repair
  rounds, then the 一 / 不 rule and the pinyin checker (`fixSpecPinyin`) before it is stored. The prompt gets what he
  wrote, the correction, the critique (+ issues, alternatives) and asks for: ONE note (✗ what he wrote / ✓ what a native
  says, why, the pattern with a real example, 3–4 examples: the corrected sentence then VARIANTS), then exercises chosen by
  the kind of mistake — word order → scramble (the misplaced word its own tile); wrong word / measure word / particle /
  collocation → choice with HIS OWN mistake among the wrong options; a sound-alike character → listen_choice + a choice;
  always a "Which sentence is correct?" — then production: 2 translate (EN → ZH) of variants, a write_typed or dictation,
  one sentence_making. Variants change subject / object / time / place at his level; wrong Chinese only in the note (✗)
  and as wrong options. A refusal / an invalid spec after the repairs is not retried (it would cost the same).
  E2E_TEST_MODE: `fakeMistakeLessonSpec` (and the fake check corrects 我昨天去了商店买东西了).
- The card in the conversation: "🎯 Mini lesson · N exercises", title, ▶ Do it, Save to my mini lessons (→ "✓ In your
  mini lessons"). ▶ Do it opens `/coach/:conversationId/lesson/:messageId` (immersive): the real lesson player in
  PREVIEW — nothing recorded while he plays — with "＋ Save" in the top bar and, at the end, "Save it to your mini
  lessons? How well do you know this now?" + the four ratings (labels of a first finish) + ↻ Try again / Not now.
- `POST …/messages/:messageId/save-lesson { completion? }` → the normal create path (`createCustomLessonFromSpec`,
  source `coach`, so the queue / "New lessons a day" / "revisit later" treat it like any lesson), ONCE (the lesson id is
  stored on the message; a lesson deleted since is made again). A rating at the end sends `completion { id, correct,
  total, rating, completed_at, attempt }`, recorded exactly like an offline completion (idempotent by id): **he just did
  it, so it is scheduled from that rating** (Good → back in 2 weeks) instead of waiting as a new lesson. Like any lesson
  first finished today it counts toward today's "New lessons a day". Save without a rating = a NEW lesson in the queue.
  Once saved and on the device, ▶ Do it opens the lesson's own `/lessons/:id/play?from=coach` (its rating counts).
- Offline: asking needs a connection (says so); a lesson already written plays offline — the web keeps the last lesson
  per conversation in localStorage (`services/coachLessons.ts`; the card shows even when the conversation can't be
  fetched), the Lab app has the conversation in its JsonCache. Saving needs a connection.
- Analytics `coach.mistake_lesson_generate { existing }`, `coach.mistake_lesson_play { exercises, saved }`,
  `coach.mistake_lesson_save { done, rating }`, server `coach.mistake_lesson_written { exercises, types, rounds }`.
- Lab: core `CoachMistakeLesson.kt` (parity-tested in `parity/fixtures/coach.ts`), `ui/coach/CoachMistakeLessonUi.kt`,
  `LessonPlayer(previewSave = …)`.

## Ask Claude chat (the Coach's "💬 Ask Claude", migration 0143_coach_ask.sql)

Jerome: "the coach could actually be a really nice chat interface … a button that is just 'ask a
question' … tapping on the words to open up the map … a recap of all the words that I had to tap …
Claude's words — for me to be able to read them and have them checked … a nice little path to adding
a flashcard."

- **Entry**: the Coach page's 💬 Ask Claude card (web `pages/SentenceCoachPage.tsx`, Lab
  `ui/coach/CoachScreens.kt`) → `/chats/claude/new` (the Claude thread view, below). Past chats are in the
  Coach's Recent conversations with 💬 and open `/chats/claude/:id` (`/coach/chat/:id` and a `?c=` link to one
  redirect there, in both apps).
- **Data**: a coach conversation with `kind = 'ask'` (+ `action = 'ask'` for older apps; `kind` is the
  generic column other Claude chats can join). `coach_messages.answer_lang` = the language of a reply
  ('zh' plain Chinese / 'en' Markdown), written on the pending row from the turn's language — the
  中文 | EN choice sent with the message, else the account's `ask_claude_language`, and "in English
  please" for one turn (`turnLanguage`). `coach_messages.translation` = the English of a Chinese
  message, made on request.
- **Replies** go through the Coach's background path (`coach-reply-queue`, `runCoachReply`, claim,
  ≤ 3 deliveries, stale sweep, Retry; the page polls every second while one is pending, every 2.5 s
  after 15 s — `coachReplyPollMs`). The reply is a `general` turn of the Claude agent harness
  (`worker/src/services/claude-agent/`, called by `defaultCoachAskReply` in `services/claude-chat.ts` with
  `ClaudeChatContext { kind: 'ask', language, userId, knownWords? }`; CLAUDE.md "Claude agent harness"):
  `SONNET_MODEL`, thinking off, no tools, prompt caching on the static rules +
  the learner block + the conversation's tail; `server.claude_turn` surface `coach_ask`; the Ask Claude immersion rules without the card line (`GENERAL_IMMERSION_RULES` in
  `claude-agent/persona.ts`) + a sample of his started words in Chinese mode; a Chinese answer is stored as
  plain text (`plainAnswerText`). With 🎧 Listen first on, the reply's Read-aloud clip is made right
  after it is written (`pregenerateAskClip`). Each reply logs `[coach] ask reply {model_ms, since_sent_ms}`;
  the apps track `coach.ask_reply { ms, first }` (send → reply on screen).
- **Endpoints**: `POST /api/coach/ask { message, language? }` → 202 `{ conversation, messages: [user, pending] }`;
  follow-ups `POST /api/coach/conversations/:id/messages { message, language? }` (always background for an
  Ask chat); `POST …/messages/:messageId/translate` → `{ translation, cached }`;
  `POST …/flashcards/propose { words? }` → `{ cards }` (the chat's `propose_flashcards` tool + card
  standard, the focus words first, `already_have`; nothing saved). All under `/api/coach/` = the cost
  guard's `ai` group. E2E_TEST_MODE: `fakeCoachAskReply` (a Chinese answer about 成都 food),
  `fakeCoachTranslate`, `fakeCoachPropose`.
- **The screen** is context-agnostic pieces (web `components/claudeChat/`, Lab `ui/claudechat/`): the
  thread — Signal bubbles, word chips by the device segmenter → the language explorer, under each of
  Claude's Chinese messages ▶ (the Read-aloud clip in Claude's voice, `ASK_CLAUDE_VOICE`) · 拼 · EN ·
  **🎤 Read it back** (the graded readers' read-aloud: `useReadAloud` / Lab `rememberReadAloud` with
  their own voice surface and the `coach.ask_read_back` event; the message marked in place, one line,
  "You said ▸"), 🎧 Listen first hidden bubbles (Ask Claude's revealed store), English answers in
  Markdown — and the minimal voice-first composer. Header: ← · title · 🎧 · 中文 | EN · ⋯.
- **Words to recap** (`shared/coach/askChat.ts` `AskRecapWord { hanzi, pinyin?, gloss?, sentence,
  reasons: ('tapped' | 'said_wrong')[], reason_line? }`): every word tapped into the explorer and every
  word a Read it back found a real mistake in (tone off / wrong / missed), merged by hanzi, newest 200,
  kept ON THE DEVICE per thread (web localStorage `claude-chat-recap-v1:<thread>`, Lab JsonCache
  `claude-chat/recap/<thread>`). ⋯ shows **"📝 N words to recap"** only when N ≥ 1 (N = the chat's words
  not yet recapped, `chatRecapCount`) → `/chats/claude/:id/recap` (`/coach/chat/:id/recap` too): the READER WORD RECAP pass with the chat as
  its source (docs/STUDY_SESSION.md "Reader word recap" → "A chat as the source"): the cue is the sentence of
  the message the word came from, switches OFF by default, new words → the "From my chats" deck + Up next
  (`chat_recap`), words he has → ⚡ (`coach_chat`); after Done only words met since count. ⋯ → **🃏 Make flashcards from this chat**: the chat's review sheet
  with the recap words sent first and ticked (`askCardChecked`), one batch add.
- Rules parity-tested (Lab core `CoachAsk.kt`, `parity/fixtures/coach-ask.ts`).

## Claude threads (migration 0144_claude_threads.sql)

Every conversation with Claude in ONE store and ONE API — the base of the unified Claude chats (the Chats
tab with Claude threads beside the tutor chats, one thread view for every context, Ask on a card as a
thread). This part is worker + shared types only; the screens come later.

- **Store**: the Coach's tables, evolved — `coach_conversations` = a thread, `coach_messages` = its messages
  (storage names only; ALL SQL in `worker/src/services/claude-agent/store.ts`). A thread has a **context**
  (`shared/claude/context.ts`): `general` (the Coach, its 💬 Ask chat, later the Chats composer), `card`
  (Ask Claude on a study card, `note_id`), `practice` (a Claude role-play — new ones carry the scenario / roles /
  level / persona voice, the old ones copied in carry their `conversation_id` and stay read-only; "Practice with
  Claude") or `chat_message` (Discuss with Claude about one chat message). `context_json` keeps the
  descriptor + a snapshot (`label` 银行, `sublabel` the deck) so the inbox draws "📇 Asked on card · 银行"
  without a fetch (`contextBadge`). A learner's message has an **intent**: `ask`, or — only as the first
  message of a general chat — the Coach's ✏️ `check` / 🔍 `explain` / `translate` (still `coach_conversations.action`
  for older apps). Inbox fields: `last_message_at`, `preview`, `unread` (replies finished since the thread was
  last opened), `changed_at` (the `?since=` cursor); `archived_at`; `deleted_at` = a tombstone (messages gone,
  text cleared — the next `?since=` list reports it in `deleted_ids`). The Coach page lists only general threads.
- **The older chats, copied in lazily** (`claude-agent/backfill.ts`): on a user's first `GET /api/claude/threads`
  (stamped in `users.claude_threads_backfilled_at`), note_questions → `card` threads grouped like the apps
  always showed them (`groupQuestionThreads`: one card's questions ≤ 30 min apart; `nq-<first id>`), the
  practice chats → `practice` threads (`pc-<conversation id>`, read-only), message_discussions → `chat_message`
  threads (`md-<id>`). Fixed ids + `INSERT OR IGNORE` + `legacy_id`: a re-run (admin
  `POST /api/admin/claude-threads/backfill`) never duplicates, never brings back a deleted thread. The old tables
  stay as they are. Dual-writes keep both sides complete while old apps exist: `POST /api/notes/:id/ask` appends
  its Q&A to the card's thread (same 30-minute rule), `PUT /api/messages/:id/discussion` adds the new messages to
  its thread, and a card turn through the new API also writes `note_questions` (so the note history, the learner's
  card hub and `/api/me/claude-chats` — which read `note_questions` — see it). The TUTOR's views read the threads
  (see "What your tutor sees" below).
- **A reply is never lost** (`claude-agent/thread-turn.ts`): the POST stores my message + a pending reply in one
  batch and answers 202; in the same request a watchdog `{ kind: 'claude_turn', messageId }` goes on
  `coach-reply-queue` (45 s) and the reply starts inline (waitUntil — no queue hop). The runner claims the row with a
  **lease** (`lease_until`, 40 s; renewed by every partial write and by stream activity). The answer + its tool
  actions are checkpointed before any action runs (a resume never asks Claude again nor makes a card twice). The
  watchdog finds the reply done (ack), still leased (again in 45 s) or abandoned — the isolate killed mid-stream —
  and resumes it. A busy model → another go in 5–10 s; a refusal or the third attempt → failed with a readable
  reason, and Retry. While written, a reply stays `status = 'pending'` (older apps show "Thinking…") with the text
  so far in `content`. The Coach's structured first replies (check / explain / translate) and mistake lessons stay
  on `runCoachReply` (not streamed).
- **Live**: the model is streamed (the harness's `TurnOptions.stream`); `claude-agent/live.ts` pushes the WHOLE
  text so far to the thread owner's sockets on the ChatHub (`broadcastToUser`, never anyone else) at most every
  120 ms, and writes it into the row at most every 400 ms for the apps that poll:
  `{ type: 'claude_turn', thread_id, message_id, seq, status: 'thinking' | 'tool' | 'streaming' | 'done' | 'failed', text?, tool?, error? }`
  (`shared/claude/api.ts`; keep the highest `seq`; a dropped frame never matters). Poll fallback:
  `GET /api/claude/threads/:id?since=<server_time>` → the messages written since + every pending one
  (`streaming: true` = text so far). `server.claude_turn` gains `first_token_ms` and `inline`.
- **API**: see CLAUDE.md "Claude threads". E2E_TEST_MODE streams a stand-in answer in three chunks
  (`claude-agent/fake.ts`), checked before any key.
- **Memory — the same Claude in every chat** (migration 0145_claude_memory.sql; `claude-agent/memory.ts`,
  `tools/memory.ts`; Jerome: "I should be talking to the same agent each time, and it should be able to read
  other chats in a way that won't blow up its context window"). Four layers, each with a hard budget:
  - **Thread summary** (`coach_conversations.summary`, `summary_upto` = the last message it covers,
    `summary_at`): ≤ ~80 words + "Topics: 银行, 把 sentences", rewritten after a reply when ≥ 2 messages are
    new — incrementally (the summary so far + only the new messages, the newest ~8,000 characters). A cheap
    background call (`MODEL_POLICY.summary` via `structuredCall`, forced tool, thinking off), never in the
    reply's way: after a thread reply (`startThreadTurn` / the queue delivery), a Coach / Ask-chat reply
    (`runCoachReply` on coach-reply-queue), an Ask on a card (after its dual-write into the card thread) and a
    saved Discuss with Claude.
  - **Learner digest** (`claude_learner_memory`: `digest` ≤ ~600 tokens — Working on / Keeps confusing /
    Interests / Level & preferences —, `threads_index` = the 20 most recent chats with a one-line summary,
    built in code; `watermark`, tokens so far): rebuilt by the daily cron (03:17 UTC: first the summaries of
    threads active in the last 30 days that are behind, ≤ 60 calls, then every learner with new summaries)
    and on demand after 5 new summaries (the very first after the first one).
  - **In every prompt**: "What you know from earlier chats" — the digest (≤ 500 tokens there) + as many index
    rows as fit (short ids), ≤ 800 tokens — joined to the cached learner block (no new cache breakpoint; it
    changes only when the digest is rebuilt). Every context (general, card, coach, chat_message).
  - **Look-ups** (read tools in every context): `search_my_chats { query, limit ≤ 5 }` — titles, summaries and
    messages of the learner's OWN live chats (any term, ranked by the terms matched, then recency; the chat
    asking left out) → per chat its id, title, badge, date, summary and ≤ 2 excerpts of 200 characters, ≤ 1,500
    tokens in all; `read_chat { thread_id (or a unique ≥ 8-character prefix), around?, max_messages ≤ 20 }` →
    the summary + the messages (each ≤ 400 characters) centred on `around` or the latest, ≤ 3,000 tokens.
  - **Compaction**: a thread whose history is over ~12,000 tokens (a conservative estimate: one token per Han
    character, one per three other characters) is sent as its FIRST message (the context's framing: the card's
    facts, the Coach's sentence, the discussed message) + the last 6 turns; the left-out middle is described in
    the context block by the thread's summary (or, before there is one, the left-out questions) with the
    read_chat hint.
  - Costs (Haiku 4.5 rates): a summary ≈ 1–3k input + ~150 output tokens ≈ $0.002–0.004; a digest ≈ 4–8k input +
    ~400 output ≈ $0.006–0.010. `server.claude_memory { kind: summary | digest, input_tokens, output_tokens, ms }`
    + the ai-usage capture; per learner totals on the memory row. E2E_TEST_MODE: a deterministic stand-in writes
    both (checked first). Privacy: only the learner's own Claude chats — never `student_profiles` (tested); the
    memory row goes with the account (`DELETE_STEPS`).

## What your tutor sees (migration 0146_claude_tutor_visibility.sql)

Privacy first: the tutor reads only the chats with Claude the learner lets her read — never writes in them, never sees
the rest (not even that they exist). Rules `shared/claude/visibility.ts` (Lab core `claude/TutorVisibility.kt`,
parity-tested by `parity/fixtures/claude-tutor-visibility.ts`); server `services/claude-agent/tutor-view.ts` (the same
rule in SQL, `tutorVisibleSql`), routes `routes/claude-tutor-view.ts`.

- **The account's choice** `users.claude_tutor_visibility`: `card_only` (NULL — the default: the questions asked on a
  study card, what tutors always saw), `all` (every chat — card questions, role-plays, readers, exercises, plain chats),
  `none`. Learner Settings → Chat → "✦ Your tutor can see your chats with Claude" (web `ChatSettingsSection.tsx`, Lab
  `ui/chat/ClaudeTutorVisibilitySettings.kt`; not for a tutor account); `PUT /api/profile/claude-tutor-visibility
  { claude_tutor_visibility: 'card_only' | 'all' | 'none' | null }`, on `/api/auth/me`.
- **One chat's own choice** `coach_conversations.tutor_visible` (migration 0144): the thread ⋯ → **👁 Share with my
  tutor** / **🙈 Hide from my tutor** (`PATCH /api/claude/threads/:id { tutor_visible }`; online only). 1 / 0 wins over
  the account; flipping back to what the account says stores NULL (`nextTutorVisible`), so a later account change
  applies to it again. While she can read it the full-screen thread shows "👁 Your tutor can read this chat" under the
  header (not the compact sheets — ⋯ says Share / Hide there).
- `tutorCanSee(thread, setting)`: `tutor_visible` true / false wins; else `all` → yes, `none` → no, `card_only` → only
  `card` threads. Practice and plain chats are private unless shared.
- **The tutor's API** (the tutor of an ACTIVE relationship only: 403 for the student / anyone else, 404 for a missing or
  pending relationship): `GET /api/relationships/:relId/claude-threads?limit=&before=&note_id=` →
  `{ threads: TutorClaudeThread[], visibility, total, next_cursor }` (chats with something said in them, newest
  activity first; the student's older chats are copied in first, once, so a student on an older app shows his card
  questions); `GET /api/relationships/:relId/claude-threads/:id` → `{ thread, messages }` — read-only, trimmed
  (finished text / analysis messages only: no client ids, leases, meta, the check of his own Chinese, unread counts;
  the context without chat / message ids or the persona's voice). A private, deleted or missing chat is the same 404.
- **Older apps**: the tutor's `GET /api/relationships/:relId/claude-chats` and her card hub's `questions` are served
  from the VISIBLE card threads in the old row shape (`tutorCardQuestions`: each question + the reply after it, the old
  `note_questions` id where it came from there) — a hidden chat never reaches an old build either.
- **Tutor UI** (web + Lab): the student page's **✦ Asked Claude** (web `components/tutor/ClaudeChatsSection.tsx` +
  `StudentClaudeThreads.tsx`, Lab `ui/teaching/StudentClaudeThreads.kt`): the four newest visible chats — title, last
  line, when · N messages, "👁 shared with you" — with the context chip (📇 card → her card hub view of the note; 🎭 practice,
  📖 reader, 🧩 exercise as labels); All chats → `/connections/:relId/claude-chats`. A row opens the READ-ONLY thread
  `/connections/:relId/claude/:id` (immersive): the learner's own thread view (web `ClaudeThreadView` `tutorView`, Lab
  `ClaudeThreadScreen` with `tutorView`) without composer, chips, 🎧 / 中文 | EN or ⋯ and with "Read only · Jerome's chat
  with Claude — only Jerome can write in it." Empty list: what he shares, never what he keeps (`tutorEmptyText`).
- **"✦ Asked Claude 3× today"** under the student on the Students dashboard card and the tutor's Chats-tab Students row
  (→ his shared chats): `claude_today` on the student overview = the visible chats he wrote in since the start of HIS
  day (`users.time_zone`, else the tutor's offset).
- **MCP**: `list_student_claude_chats` lists the visible threads (name and `answer_chars` kept; per conversation
  `thread_id`, `context_kind`, `badge`, `word` + `card_path` for a card, `questions` = his message + Claude's reply —
  Claude's role-play opener has question null), with `visibility` + a one-line `visibility_note`;
  `get_student_claude_thread { relationship_id, thread_id, max_chars? }` = one whole chat. `list_conversations` /
  `get_conversation_messages` pass `?exclude_ai=1`: practice chats already copied into the threads are left out / 404.
- Never in any of it: the tutor's private student profile (`student_profiles`; tested on every tutor and learner
  response). Analytics `claude.share_with_tutor { on, scope: thread | account, visibility?, context_kind? }`,
  `tutor.claude_thread_open { context_kind, source }`.

## Reader and exercise threads (web + Lab)

Jerome (Nov 2026): "add a chat with a graded reader or a chat with whatever exercise … you're talking to a unified
Claude, but it is aware of the context you're invoking it from." Two more contexts of the same thread store, screen and
harness (`contexts/reader.ts`, `contexts/exercise.ts`; CLAUDE.md "Claude agent harness"):

- **`reader`** `{ reader_id, page_id?, page?, looked_up?, said_wrong? }`, ref `reader:page`. The reading view's **💬** (end
  of the "📖 GRADED READER" row — every reading view: `/readers/:id`, the session's reader, a homework pass, the Lab's
  Today's story) opens the PAGE's thread in a sheet (web `components/claude/ContextClaudeSheet.tsx`, Lab
  `ui/claude/ContextClaudeSheet.kt` via `ui/readers/ReaderClaude.kt`), with the words of this reading's word recap run on
  that page (`readerPageWords`). Chips: (The words I looked up) · What does this page mean? · Explain the grammar in this
  sentence · Quiz me on this page. Badge "📖 Reader · 成都 p.3" → `/readers/:id?page=3`.
- **`exercise`** `{ lesson_id, exercise_key, exercise_type?, answer? }`, ref `lesson:s0e1`. A real run of one of his
  stored lessons: the player's top-bar **💬** (any exercise) and the answer check's **💬 Ask Claude** (his answer + the
  check ride along) open the exercise's thread (web `components/lessons/ExerciseClaude.tsx`, Lab
  `ui/lessons/ExerciseClaude.kt`); previews / the catalogue / a Coach mistake lesson keep the old inline "💬 Ask about
  this" (`POST /api/lessons/answer-check/ask`, kept for older builds). Chips by type and answer: Why is my answer wrong? /
  Is my answer OK? · Explain the right answer / the model answer / the word order / this note · Give me another example ·
  One more like this. Badge "🧩 Exercise · Translate" → the lesson.
- Both resume the context's thread from the last 30 min (`resumeThreadFor`), ＋ New chat; Ask only; the server checks the
  reader / lesson is the caller's (404 / 403) and labels the badge from its own rows (the stored spec's exercise type
  wins). A follow-up carries the fields as they stand now (`looked_up` / `said_wrong`, `answer`; null clears) →
  `setContextFields`. `GET /api/claude/threads?context_kind=&context_ref=` lists one context's threads. Claude's cards go
  into the deck it picks from the listed ones (the Coach's applier). Analytics `reader.ask_claude`, `lesson.exercise_ask`
  (`lesson.answer_ask` → replaced by it). Rules `shared/claude/context.ts` + `contexts.ts`, Lab core `ClaudeChats.kt`
  (parity-tested).

## Claude thread view (web + Lab)

ONE screen for every chat with Claude, whatever its context (the unified-Claude-chats plan §6.3–6.4):
web `components/claude/ClaudeThreadView.tsx` at **`/chats/claude/:id`** (immersive, `pages/ClaudeThreadPage.tsx`;
`variant="sheet"` = the same screen without page chrome — **Ask Claude on the study card**,
`components/claude/CardClaudeSheet.tsx`, docs/STUDY_SESSION.md "Ask Claude"). Lab:
`ui/claude/ClaudeThreadScreen.kt` (+ `sheet = true`) / `ClaudeThreadViewModel.kt` / `ClaudeThreadNav.kt` (the same
routes), `data/claude/ClaudeThreads.kt` (JsonCache `claude/t/<id>` + Outbox kind `claude-message`, below), the
`claude_turn` frames from `ChatLive.claudeTurns`; its rules are core `core/…/claude/ClaudeChats.kt` (parity-tested).

- **Routes**: `/chats/claude/new` starts a thread — a plain chat by default, `?context=card&note_id=&label=`
  for a card, `?context=chat_message&message_id=&conversation_id=`; `?text=&intent=ask|check|explain|translate`
  sends at once, `?draft=` only fills the box. `/coach/chat/:id` (the Coach's 💬 Ask chats — the same rows: a
  coach conversation IS a thread) redirects to `/chats/claude/:id`; the Coach's 💬 Ask Claude card opens
  `/chats/claude/new`; a `/coach?text=&action=` deep link (no `from_message`, not from a study card) starts a
  general thread with that intent and opens it. "Open in Coach" from a chat message (`from_message`, reuses the
  stored auto-check) and the study card's ✎ Check in Coach ("Back to your card") stay on the Coach page for now.
- **Header**: ← · title · 🎧 Listen first · 中文 | EN · ⋯ (the sheet's own items first — the card's 🕘 Earlier /
  ＋ New chat, a reader page's ＋ New chat —, then 🃏 Make flashcards from this chat, 📝 N words to
  recap → `/chats/claude/:id/recap`). The **sheet variant** (a card / reader page / exercise / chat message's Claude
  sheet) is compact: near full height, a slim grab handle instead of ✕ (tap / drag down / back / Escape close it), one
  header row, no context chip, no "can read this chat" line. On the page, under the header, the **context chip** (`headerChipFor`, `shared/claude/contexts.ts`):
  "📇 Asked on card · 银行" → the card hub `/cards/:noteId`, "💬 From a chat message" → that chat
  (`/connections/:relId/chat/:convId`, looked up from the conversation), "🎭 Practice · 点菜" (no link; a role-play
  adds "✦ Claude plays 服务员 · You: 客人" under it). An old practice chat copied in (`pc-<id>`, `read_only`) has a
  read-only banner and no composer (`PRACTICE_READ_ONLY_NOTE`). Colour is never the only signal: icon + words.
- **Messages**: the context-agnostic `components/claudeChat/` pieces (word chips → explorer, ▶, 拼 / EN, 🎧,
  🎤 Read it back, words to recap per thread). A reply being written **streams**: the ChatHub `claude_turn`
  frames (`services/chatLive.ts`) patch the pending row's text (highest `seq` wins; `applyTurnEvent`) and the
  bubble shows it with a caret and what Claude is doing (`turnStatusLine`: "Looking through your cards…" while a
  read tool runs). Poll fallback (`claudeReplyPollMs`): while a reply is pending and no frame came in the last
  3 s (socket down, a Check / Explain / Translate reply — not streamed), `GET …?since=` every **400 ms for the
  first 10 s, then 1.5 s**; while frames arrive, only a 1.5 s safety net. A poll's shorter text never overwrites
  a longer streamed one (`mergeMessage`). Coach results — ✏️ Check (+ 🎯 mini lesson), 🔍 Explain, Translate,
  the mistake-lesson card, tool-result chips — are the Coach's own cards, moved to
  `components/coach/CoachResults.tsx` (shared with `SentenceCoachPage`).
- **Suggestion chips** (`chipsFor`): card = Ask Claude's quick questions (`cardChips`, was `askQuickActions` —
  still exported under that name), general = A useful phrase · Quiz me · A short story, chat message = What does
  it mean · Is it natural · How to reply · Make flashcards, practice = 💡 hint · 🆘 How do I say… (`fill`: into the
  box, to be finished) · ✏️ Correct my last message (offered every time); the others ONLY before the thread's first
  message (`chipsFor(…, { started })` — Jerome, Nov 2026: "once we have sent a message, we don't need the suggestion
  pills"), never one already used in the thread. Claude's bubbles take the whole width of the thread (fewer line breaks
  in long Chinese); my own stay narrower, on the right.
- **A reply is drawn in the language it is WRITTEN in** (`replyLanguage` in `shared/study/askClaude.ts`, Lab
  `AskClaude.replyLanguage`, parity-tested; applied to every Claude bubble by `ClaudeChatThread` on both apps): the
  stored `answer_lang` is what the turn was ASKED for, so a question asking for English ("把说明改成英文") stored 'en'
  while Claude answered in Chinese — that bubble was Markdown with no word chips or ▶ / 拼 / EN / 🎤 (Jerome, Nov 2026,
  the second reply after a card edit). Asked in Chinese stays Chinese; otherwise text with at least twice as many Han
  characters as Latin words is Chinese. The worker stores it the same way when a reply finishes (`finishTurn`
  in `claude-agent/thread-turn.ts`, the Coach's 💬 Ask reply in `coach-replies.ts`), so `answer_lang` = the language
  the reply is written in and the 🎧 Listen-first clip is made for it; the apps' rule stays for older rows.
- **The composer is compact** (`ClaudeChatComposer compact` → `VoiceTextInput compact`; Lab
  `VoiceTextFieldContent(compact = true)`): voice first (✏️ Type · 🎤 Say it on one 44–48px row); typing is ONE row —
  a box that starts at one line and grows to four, 🎤, and a round ➤ (aria "Send") — no separate full-width Send row.
  The Chats tab's composer keeps the full box for now. The 💬 feedback button is hidden on `/chats/claude/:id` and
  while a Claude sheet is open (it sat on the ➤).
- **Composer** (`composerFor`): Check / Explain / Translate only START a general chat (the server answers them
  with the Coach's structured reply), so a NEW general chat shows Send (= Ask) + the Coach's buttons for what is in
  the box (`coachButtons`: Chinese → ✏️ Check · 🔍 Explain, English → 🔤 Translate, with the hint line); every
  other thread — and a general one with messages — is Ask only.
- **Offline-first** (`services/claudeThreads.ts`, Dexie **v37** `claudeThreads` / `claudeMessages` /
  `claudeOutbox`; `hooks/useClaudeThread.ts`): every thread and message is cached as fetched (whole the first time,
  then `?since=` from the stored `server_time`), so a thread reads offline. A message sent without a connection
  (or whose request didn't get through / 5xx / 429) goes to the outbox with client ids and shows at once with
  "🕓 Will send when you're online"; a thread started offline lives under its client id until
  the server has it, then its rows move to the server id and the screen follows (`resolveThreadId`).
  `flushClaudeOutbox` sends in order on `online`, when a thread opens and in every sync; the server is idempotent
  by client id; a refusal (4xx) marks the message "Couldn't send" with ✕; a 409 (a reply still being written)
  waits for the next run. Lab: the generic Outbox carries them (drained on reconnect and in every sync); a
  `claude-message` 409 stays pending (`Outbox.WAIT_ON_CONFLICT`) instead of counting as done; a message written in a
  thread that isn't on the server yet is held on the phone and queued once the `claude-threads` sync step (or the
  open screen) has the thread's server id (`resolveLocal`: the create re-sent, idempotent by its client id).
- **Message menu + my checked Chinese** (every thread, Nov 2026 — ported from the old card sheet): a long press /
  right-click / the hover ⋯ on any finished bubble opens the chat's message menu (`askClaudeMenu`: Copy · Translate ·
  Pinyin · Explain / Save as flashcard · Open in Coach · Read aloud); my message carries the server's "check my
  Chinese" when it ran (a card question: `auto_check` on `ClaudeThreadMessage`) → the ✎ mark, "✨ How to say it
  better" first in the menu (its "Ask why" fills the composer), the 🎓 Open in Coach chip.
- **Ask Claude on a study card** = the card's thread in this screen's sheet variant (docs/STUDY_SESSION.md "Ask
  Claude"): resumes the card's thread from the last 30 min, ⋯ → "🕘 Earlier about 银行 · N chats" / ＋ New chat, the typed
  answer sent with each question (`typed`), Claude's card tools applied on the device once per reply with "✓ Claude
  edited this card · Undo" (`shared/claude/cardTools.ts`), a chip sends `quick: true` (not checked).
- **Analytics**: `claude.thread_open { context_kind, source, resumed }`, `claude.message_send { context_kind,
  intent, offline, chip, spoken }`, `claude.reply_shown { first_text_ms, done_ms, via: socket | poll, intent,
  context_kind }`, `claude.thread_action { action: new | switch, context_kind }`, `claude.undo_card_edit` (+ the
  Kotlin mirror); a card question also `study.ask_claude { …, via: 'thread' }`.
- **Resuming** (`resumeThreadFor`, for the card sheet / Chats tab PRs): a card resumes its newest thread whose
  last message is within 30 minutes (the server's card-question rule), a chat message / an old copied practice chat
  always its one thread, a plain chat and a new role-play never.
- Tests: `shared/claude/contexts.test.ts`, `ClaudeChatsParityTest` (`parity/fixtures/claude-chats.ts`),
  `components/claude/ClaudeThreadView.test.tsx` (streaming via a fake socket, the offline outbox, composer
  intents, the card chip), `services/claudeThreads.test.ts`, E2E `e2e/tests/claude-thread.spec.ts` (Coach → Ask →
  a streamed reply; a card thread's chip → the card hub; offline → queued → sent). Lab: `ClaudeThreadAppTest`
  (fake server + fake socket frames), `ClaudeThreadScreenTest` (+ Roborazzi `claude-thread-01…10`).

## Practice with Claude (role-play threads)

A role-play is a Claude thread in the `practice` context: Claude **plays someone** in a situation (a waiter, a
taxi driver, a new friend, or — from a study card — a friendly partner who weaves the card's word in) and the
learner talks to them in Chinese. Rules in `shared/claude/practice.ts` (Lab core `claude/ClaudePractice.kt`,
parity-tested by `parity/fixtures/claude-practice.ts`).

- **Started from**: the Chats tab ✏️ → "🎭 Practice a situation…" (`components/claude/PracticeSituationSheet.tsx`,
  Lab `ui/claude/PracticeSheet.kt`: seven ready-made situations `PRACTICE_SCENARIOS`, or his own situation · Claude
  plays · You are · Beginner / Intermediate / Advanced), a study card's ⋯ → "🎭 Roleplay this word"
  (`practiceFromCard`: `用「银行」聊天`, the note id — no Claude relationship needed any more), the old Claude page
  (Connections → Claude → 🎭 Practice a situation), and old "new chat with Claude" links (`/connections/<claude
  rel>/chat/new` → `/chats?practice=1`). Online only.
- **Claude speaks first**: `POST /api/claude/threads { context: { kind: 'practice', scenario, ai_role?, user_role?,
  level?, note_id? }, text: '' }` → 202 with ONLY a pending reply (`store.appendOpener`); the runner sends the
  persona `PRACTICE_OPENER` as the learner's (never stored) first turn. Titled "Practice: <situation>", badge
  "🎭 Practice · <situation>", `source: 'practice'`. A role-play never resumes (each start is a new scene).
- **The provider** (`worker/src/services/claude-agent/contexts/practice.ts`): `PRACTICE_SYSTEM_PROMPT` (static,
  cached: stay in character, Chinese only, 1–3 short sentences, graded, never correct in character, move the scene
  along), the known-words sample (cached per day), then the context block — situation, who Claude plays, who he
  is, the level's grading rule (`PRACTICE_LEVEL_RULES`), a card's word (hanzi / pinyin / English, ownership-checked).
  `MODEL_POLICY.practice` = Sonnet, thinking off, 1,500 tokens; streamed like every thread reply.
  **No tools** (one round): a tool would break character and add a round's latency; cards come afterwards (⋯ →
  Make flashcards from this chat, word chips → + Add as card / ⚡).
- **Help without leaving the scene**: the chips 💡 hint · 🆘 How do I say… (into the box) · ✏️ Correct my last
  message; a message starting with one of them, or asking "how do I say…" / 怎么说 (`isPracticeHelpRequest`), is
  answered briefly as a tutor and then the character's line follows. Its reply is stored in his Ask Claude language
  (`practiceReplyLanguage`); a role-play line is always `zh` (word chips, 🎧, read aloud).
- **The persona's voice**: the server picks it at creation (`practiceVoiceFor`: an app voice by the role's gender —
  她 / 阿姨 / waitress → female, 他 / 先生 → male — stable per situation) and keeps it on the thread's context
  (`voice_id`); ▶ / 🎧 read Claude's lines in it at `PRACTICE_VOICE_SPEED` (0.7). After a Chinese reply the clip is
  made in the background (waitUntil, the R2 `tts-cache/` key `/api/practice/tts` serves) — never awaited.
- **Old practice chats** (`conversations.is_ai_conversation`) stay as they were copied: read-only `pc-<id>` threads.
  The old `ai-initiate` / `ai-respond` endpoints remain for old builds only. `GET /api/me/chats?exclude_ai=1` (both
  apps' Chats tab) leaves out the old chats already copied into the threads (a not-yet-copied one still comes).
- Analytics: `claude.practice_start { source: chats | card | claude_page | chat_link, preset, level }`.
- Tests: `services/claude-agent/__tests__/practice.test.ts`, `routes/__tests__/claude-threads.test.ts` (a role-play),
  `routes/__tests__/chat-list.test.ts` (`exclude_ai`), `shared/claude/practice.test.ts`,
  `components/claude/PracticeSituationSheet.test.tsx`, `e2e/tests/claude-practice-discuss.spec.ts`, Lab
  `ClaudePracticeParityTest`, `ui/claude/PracticeDiscussTest.kt` (+ Roborazzi).

## Discuss with Claude (a chat message's Claude thread)

The message menu's **Discuss with Claude** opens the message's Claude thread (context `chat_message`) as a SHEET over
the chat — `components/claude/DiscussClaudeSheet.tsx`, Lab `ui/claude/DiscussClaudeSheet.kt` — the same thread view
as every Claude chat: the message quoted under the header, the chips (什么意思 · 自然吗 · 怎么回复 · 做卡片), Ask
only, the reply streamed. One thread per message: `resumeThreadFor` continues it whenever it was (the list comes from
`GET /api/claude/threads?context_kind=chat_message`, cached on the device); the first question makes it. Cards Claude
proposes (`create_flashcards` → a `propose_flashcards` tool result on the reply) are never saved by the server: the
sheet lists them ticked, a deck → Save. The thread shows in the Chats tab as "💬 About a message · …".
The old discussion sheet (MessageDiscussionModal / the Lab's DiscussSheet) is gone; `POST /api/messages/:id/discuss`
and `GET|PUT /api/messages/:id/discussion` stay for older builds. Analytics `claude.discuss_open { resumed }`
(replaces `chat.discuss`). Tests: `components/claude/DiscussClaudeSheet.test.tsx`, the E2E spec above, Lab
`PracticeDiscussTest`.

