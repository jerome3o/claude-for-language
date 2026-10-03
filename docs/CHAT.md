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
  messages. `message_updated` when they land.
- **Pinyin / Translate toggles** per message (pinyin from `words`; translation from `translation`), remembered per
  conversation on the device. A "Show pinyin for all" switch in the chat header menu.
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
- **Header**: ← · name (+ "typing…" / title) · 📹 call · ⋯ (search, make flashcards, pinyin for all, translations for
  all, rename, new conversation, …). No "+ Cards" button any more (it is in ⋯ and in the message menu).
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
- **Forward** — menu → Forward (or Select → Forward for several, oldest first) → "Forward to…" lists every conversation
  I have with a person (newest first, "· this chat" marked; not the Claude practice chats) →
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

## Chats tab (the inbox)

The bottom tab bar's **Chats** tab (it replaced Decks; Decks is now the first row of More, Home's
"All decks →" and `/decks` as before) opens `/chats` (web `pages/ChatsPage.tsx`, Lab `ui/chats/`):
one row per conversation across every active relationship — round avatar (picture, else an initial
on a colour), the person's name (+ the conversation title only when there are several chats with
that person), the last message preview ("You: …", 📷 Photo, 🎤 Voice message, Message deleted),
a relative time (14:32 / Yesterday / Mon / 28 Sep / 28 Sep 2025) and a bold unread count. Newest
activity first; Claude role-play chats (the same `conversations` rows) in their own "Practice with
Claude" section. Search filters by name, title and last message. ✏️ → the person picker (when
there's more than one) → `/connections/:relId/chat/new`. A row opens the chat with router state
`{ from: '/chats' }`, so ← returns to the inbox (`chatBackTarget`).

- `GET /api/me/chats` → `{ server_time, conversations: ChatListRow[] }` — ONE query
  (`getChatList`, `services/chat/reads.ts`): conversation + relationship + the other user + the last
  message (correlated subquery on `messages(conversation_id, created_at)`) + my unread count.
- The rules (sorting, title, preview, relative time with an explicit UTC offset, search, the badge
  count, live updates) are `shared/chats/inbox.ts`; the Lab's `core/…/chat/ChatInbox.kt` is
  parity-tested against it. `chatMessagePreview` is also the server's `messagePreviewText`.
- Offline: the list is cached (web localStorage `chat-list-v1:<user>`, `hooks/useChatList.ts`; Lab
  JsonCache) and renders instantly; refreshed on open, focus and every minute. While the inbox is
  open it holds the ChatHub socket: `message` / `message_updated` / `read` events update the cached
  list (`applyIncomingMessage` / `applyReadMarker`; an unknown conversation → refetch).
- The tab badge = conversations with people (not Claude) that have unread messages
  (`unreadConversationCount`).

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

# Auto-check — "How to say it better" (migration 0100_chat_auto_check.sql)

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
  more English words than Han characters, > 400 characters, photos / voice / files.
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
