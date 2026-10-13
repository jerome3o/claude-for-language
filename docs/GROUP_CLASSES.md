# Group classes — prototype (experimental, web only)

Minghui asked: *"Would it be possible for the teacher to teach group classes (e.g. 4–6 students)?"*
This is a **throw-away-able prototype** to find out what that would take. It is clearly labelled
🧪, reachable only from **More → Teaching → 🧪 Group class (prototype)** (tutor accounts, accounts with
students, admins), touches no 1:1 or student-facing flow, and can be switched off with the worker
var `GROUP_CLASSES = "off"` (every `/api/groups*` and `/api/group-sessions*` route then answers 404).
No Lab app work (`android-lab/PARITY.md` → "Not native").

## What the prototype does

| Piece | How |
|---|---|
| **Groups** | `/group-classes`: the tutor picks 2–6 of her **active** students and a name. Tables `class_groups`, `class_group_members` (each member row keeps the 1:1 `relationship_id` it came from; every read re-checks the relationship is still active, so a group never grants more than the relationships already do), migration 0122. Edit / delete (archive). Students see "Groups you're in" on the same page (by URL; there is no student entry point). |
| **Starting a class** | "📹 Start class & send the link" creates a `group_class_sessions` row (one live per group) and posts the link **into each student's existing 1:1 chat** (the normal `sendMessage` path, idempotent per class + student); "Start without sending" for testing. No group chat, no new notification channel. |
| **The call** | `/group-class/:id` (immersive). **Full-mesh WebRTC**: every browser holds one `PeerLink` (the 1:1 call's link class, unchanged) to every other browser; the lower client id of each pair makes the offer (`isPolite`). Signalling goes through a NEW Durable Object, **`GroupRoom`** (`worker/src/durable/group-room.ts`, binding `GROUP_ROOM`, migration tag `v4-group-room`), never through the 1:1 `CallRoom`. Same join tickets (scope `group:<session>`), STUN + the existing Cloudflare TURN key. Cameras are asked for small (640×360 / 320×180 at 15 fps, `groupCameraConstraints`) because each one is uploaded N−1 times. |
| **Layout** | Gallery grid sized for the biggest 16:9 tiles (`galleryGrid`), tutor first, me last; the **active speaker** gets a green ring (Web Audio levels every 250 ms, `nextSpeaker` with hysteresis); a shared screen or the spotlight goes big on top (`stageOf`). Side panel from 1024 px, a bottom sheet on phones. |
| **Tutor controls** | Mute a student / mute all / let them speak again, ⭐ spotlight, lower a hand, **End for everyone**, screen share (tutor only in the prototype). Students: mic, camera, ✋ raise hand. Rules in `shared/group/room.ts` (`applyControl`): only the tutor mutes / spotlights; a student can't unmute themselves while muted (the room also rewrites their `mic: true` to false); every other page plays a muted student's audio muted too, so a modified client can't talk over the class. Mutes stick across a reconnect; hands and spotlight drop when the person leaves. |
| **Board + chat** | The 1:1 call's shared text board, reused as is: the same RGA CRDT (`shared/calls/textDoc.ts`) and the same client session (`TextBoardSession`) and component (`TextBoard`) — they already work with any number of sites; the GroupRoom speaks the board's `text` / `text_cursor` messages (one page, no page strip, no tab-complete). In-class chat to everyone. |
| **One group activity** | 🎯 **Quick quiz** (`shared/group/quiz.ts`): the tutor asks one multiple-choice question; each student answers on their own device (and may change it until the reveal); the tutor sees **who answered what** live; students see only "N answered" until the tutor shows the answer and the counts. |
| **Presence / end** | The 1:1 room's rules (`planRoom`): a socket counts while heard from in the last 45 s; an empty class ends 10 min after the last person left, an unjoined one 10 min after it started. **When a class ends the room forgets its board, chat and quiz** — nothing is kept. |
| **Analytics** | `group.create`, `group.class_start`, `group.notify`, `group.join`, `group.leave`, `group.end`, `group.control`, `group.screen_share`, `group.quiz` (counts / enums only). |

Not in the prototype: recording, transcripts, a lesson report, homework from the class, a group
chat, ringing / push, materials, drawing, in-call activities beyond the quiz, the Lab app.

## What it proves (and what it found)

- **The pieces generalise.** The CRDT board, the `PeerLink`, join tickets, presence and auto-end
  needed no change for N people — only a new room that relays signals *by address* and holds
  per-person state (roles, mutes, hands, per-person quiz views). The 1:1 `CallRoom` is hard-wired to
  two peers (`MAX_CALL_PEERS = 2`, one `remote` in `useCall`, layouts for two faces) and would be
  painful to stretch; a separate room was the right call.
- **Mesh media is the limit.** Each browser sends its camera N−1 times and decodes N−1 streams. With
  the small camera that is ~0.3–0.5 Mbit/s up per peer: fine for **3–4 people on a laptop on home
  broadband**; at **6–7 people** (tutor + 6) that is ~2–3 Mbit/s up, 6 decodes and 6 encodes — laptops
  get warm, phones on mobile data struggle, and one weak uplink degrades everyone's view of that
  person. The 1:1 link's own bitrate logic (`videoEncodingFor`) still assumes one peer. E2E (3 people,
  fake devices, one machine) connects reliably; real-world 6-person quality is untested.
- **"Group" crosses the 1:1 model everywhere.** Chat, homework, insights, recordings, profiles and the
  Lab app are all keyed by `tutor_relationships`. The prototype dodges that by keeping groups as a
  thin list *over* relationships and sending everything else 1:1.

## Costs and risks of a real version

1. **Media scaling → an SFU.** For 4–6 students the real version should use **Cloudflare Realtime
   (Calls) SFU**: each browser uploads once (simulcast: high / low layers) and the SFU forwards; the
   tutor's tiles can request low layers for the gallery and high for the spotlight. Needs a Realtime
   app id + secret (new secrets in `deploy.yml`), a small session/track API in the worker, and a client
   rewrite of the media layer (one `RTCPeerConnection` to the SFU, pull tracks by id). Cost: Realtime
   bills egress after a free tier (1,000 GB/month at the time of writing) — a 1-hour class of 7 at
   ~0.5 Mbit/s per stream is roughly 7 × 6 × 0.5 Mbit/s × 3,600 s ≈ 9.5 GB, so a few classes a week stay
   inside the free tier. TURN (already configured) stays for restrictive networks.
2. **Groups vs relationships.** Decide what a group *is*: (a) a lightweight label over 1:1
   relationships (the prototype; homework / insights stay per student, the tutor "sends to the
   group" = N sends), or (b) a first-class entity with its own chat, homework assignments, board pages
   and progress roll-up. (a) is far cheaper and probably enough; (b) touches chat (group
   conversations, read receipts for N, notifications, listening mode, moderation), homework
   (assignment fan-out + a group progress view), insights (a class view), board pages (per group),
   profiles (privacy: students see each other's names / faces — consent and an "about the class"
   note), and every MCP tool that takes a `relationship_id`.
3. **Recordings and transcripts with N speakers.** Today each side records its own mic → clean
   speaker labels. That still works for N (N uploads, N transcriptions, merged by time), but the cost
   scales with N, the lesson report must attribute corrections per student, and "Make homework from
   this lesson" must fan out per student (or the tutor picks). Privacy: everyone in a group is recorded
   — needs consent per student and a visible recording indicator for all.
4. **Classroom management.** Mute / spotlight / hands exist; a real class also needs remove a
   participant, a waiting room / late-join behaviour, breakout pairs (the in-call activities are
   two-person — pairs inside a group class would be the natural extension), and what happens when
   the tutor drops (pause vs keep going).
5. **The Lab app.** A native client would join the same `GroupRoom` protocol; with an SFU it needs the
   SFU's WebRTC flow on Android too. Sized below.
6. **Moderation and safety.** Students who don't know each other share faces and a chat: report /
   remove, the tutor as owner of the chat, nothing visible to students outside the class.

## Phased plan (rough sizes; one "PR" = one agent session)

| Phase | What | Size |
|---|---|---|
| 0 — this prototype | Groups over relationships, mesh call ≤ ~4–5 people, board, chat, quiz, tutor controls, web only | done |
| 1 — try it for real | Minghui runs 1–2 small classes (3–4 students) on laptops; add a "how was it" note + `group.*` analytics review; fix what she trips over (late join, reconnect, phone layout) | 1 PR |
| 2 — SFU media | Cloudflare Realtime SFU with simulcast, worker session API, client media layer; keep the GroupRoom for everything but media; per-tile quality; 6–8 people on phones | 2–3 PRs |
| 3 — Lab app | Native group class screen on the same protocol + SFU | 2 PRs |
| 4 — class features | Recording + per-student transcripts and a class report (opt-in, consent), "homework for the group" as fan-out over each relationship, a group chat (if wanted), breakout pairs reusing the in-call activities, remove / waiting room | 3–5 PRs |
| 5 — first-class groups (only if needed) | Group progress view, group board pages, MCP tools for groups | 2–3 PRs |

Recommendation: run phase 1 before investing; if group classes stick, go straight to phase 2 (SFU) —
mesh will not carry 6 students on phones.

## Files

`shared/group/` (room rules, quiz, layout, protocol; tests `group.test.ts`) ·
`worker/src/durable/group-room.ts` (+ `__tests__/group-room.test.ts`) ·
`worker/src/routes/group-classes.ts`, `worker/src/services/group-classes.ts` (+ `__tests__/group-classes.test.ts`) ·
`worker/src/db/migrations/0122_group_classes.sql` · `frontend/src/api/groupClasses.ts`,
`frontend/src/services/group/groupRoomSocket.ts`, `frontend/src/pages/group/` ·
`e2e/tests/group-class.spec.ts` (three browsers).

API: `GET|POST /api/groups`, `GET /api/groups/candidates`, `PATCH|DELETE /api/groups/:id`,
`POST /api/groups/:id/sessions`, `GET /api/group-sessions/:id`, `POST /api/group-sessions/:id/notify|join|end`,
`GET /api/group-sessions/:id/ws?ticket=` (WebSocket), `POST /api/group-sessions/:id/leave` (pagehide beacon).
