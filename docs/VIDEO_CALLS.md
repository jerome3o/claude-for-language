# Video calls (experimental)

A Preply-style live lesson inside the app: video + audio, a shared whiteboard (draw
or type — pinyin IME works), in-call chat, screen sharing, and a **recording of both
microphones** that becomes a Chinese + English transcript, a Claude-written lesson
report and one-tap flashcards after the call.

Entry points: **📹 Video call (beta)** on a student's / tutor's page
(`/connections/:relId`), **More → Video calls (beta)** (`/calls`, which also offers a solo
test call), and the **Join the call** button that appears in the relationship's chat.

## How it works

```
 browser A ──WebRTC media (peer to peer, STUN / optional TURN)── browser B
     │                                                              │
     └──── WebSocket ───► CallRoom Durable Object ◄─── WebSocket ───┘
                          (signalling, whiteboard, chat, "call ended")
     │                                                              │
     └── mic → MediaRecorder → IndexedDB queue → PUT chunks ──► R2 ◄┘
                                                                │
      call ended / piece complete → call-processing-queue ─────┘
          1 message per piece: stitch chunks → transcribe → segments (D1)
          then 1 message: Claude lesson report → calls.summary_json
```

- **Board (text first)** — the 📝 button opens **Board**: one plain-text document both people
  type into at once, each person's caret and selection shown to the other in their colour with
  their name (`components/calls/TextBoard.tsx`: a real `<textarea>` over a "mirror" with identical
  layout that paints the other person's selection / caret). The model is a small sequence CRDT,
  RGA, in `shared/calls/textDoc.ts` (unit-tested for convergence with three random typists and
  random delays; the Lab app's `CallTextDoc.kt` replays 5,000 recorded steps identically): every
  character has an id `[counter, site]` and the id of the character it was typed after; concurrent
  inserts after one character are ordered by id; deletes leave tombstones. The site is
  `<user id>:<random per page load>` and the room refuses inserts whose site isn't the sender's.
  The room applies ops in arrival order, keeps the document in its storage, sends it in `welcome`
  and relays `text` / `text_cursor` messages; edits made while the socket was down are replayed on
  the rejoin (idempotent). **IME**: nothing of a composition is sent between `compositionstart` and
  `compositionend`, and the textarea is not rewritten while it is open (that would break the IME),
  but **the other person's edits always go into the document at once**. The field shows a
  `TextView` of the document (`shared/calls/textDoc.ts`; Lab `CallTextView`): my edits are diffed
  against what the field showed and applied by character id, so neither side's typing is lost, and
  the field catches up when the composition ends — or when it has been idle `COMPOSE_IDLE_MS`
  (1.5 s) with edits waiting, or on blur. That matters because Gboard keeps a composing span on the
  last word for as long as you don't type a space: before round 4 the other person's edits waited
  behind it until a page switch (2 Oct 2026). The Lab app also sends text Gboard commits outside the
  span at once and keeps the composition range (transformed) when the field is rewritten (E2E drives
  a real composition over CDP; unit tests use a span that never closes).
- **Carets** — the other person's caret is a thin line in their colour with a small dot on top;
  nothing is drawn over the text (round 3's opaque name flag hid the line above). Their name — and,
  while they compose, the pinyin they are typing — shows in the strip under the board ("● Minghui ·
  wo ba", "● Minghui is here"); hovering near the dot (web) or tapping it (Lab) lights their name up
  there in their colour. The dot breathes while they compose. Selecting Chinese shows its pinyin
  (`pinyin-pro`, on the device) and, online, a word-by-word **Meaning**
  (`/api/sentences/explain-text`). **Draw** is the second tab (the old whiteboard). The text of the
  pages written in the call is saved with the call (`calls.board_text`, migration 0081), shown on the
  review page under "Board", and goes into the lesson report and the session-notes homework agent
  ("SHARED NOTES").
- **Board pages** — the text board is not per call: it belongs to the tutor relationship and keeps
  every lesson's writing as numbered **pages** (see "Board pages" below). The board's bottom strip
  shows them all; the call opens on today's page or a new one.
- **Tab-complete on the board** — type Chinese, stop for 500 ms (and no IME composition open)
  and a grey ` - pīnyīn - meaning` appears right after the caret; **Tab** types it in (through the
  CRDT, like any typing, so the other person sees it and it is saved in `board_text`), typing on or
  **Esc** dismisses. On a touch screen a **⇥ pīnyīn - meaning** chip under the caret accepts on tap.
  Only the typist sees the offer. The rules are `shared/calls/gloss.ts` (`findGlossSegment`: the
  trailing run of Chinese characters / Chinese punctuation on the caret's line, ≤ 40 characters, only
  at the end of a line that has no ` - …` after it yet; `formatGloss`: always one line), ported to the
  Lab app as `CallGloss.kt` and parity-tested. `POST /api/calls/:id/gloss { text }` (members of the
  call only) asks Haiku through `structuredCall` (forced tool, thinking off, 500 tokens, 6 s, one
  retry when the reply is unusable) and returns `{ pinyin, english }` cleaned by `cleanGloss` (tone
  marks, ≤ 30 English words (a whole sentence), no line breaks); answers are cached per text in the worker isolate and
  in a 300-entry LRU on each device (a repeat is instant and free), and each user may make 30
  uncached requests a minute (429). A sentence gets its **whole** translation (the prompt asks for
it, 500 tokens, 6 s; `GLOSS_MAX_ENGLISH_WORDS` is a 30-word safety net — it was 8, which cut
Minghui's sentences off), and the touch chip wraps to up to four lines instead of an ellipsis. No key / offline / an error → simply no offer (the client stays
  quiet for a minute after 503 / 429). A request in flight is aborted on new input and a reply for
  text that has changed since is ignored. Off switch: the board's ⋯ (web, remembered per user on the
  device) / "⇥ Pinyin hints" (Lab). Web: `components/calls/useBoardGloss.ts`,
  `services/calls/boardGloss.ts`; Lab: `ui/calls/TextBoardPanel.kt`, `BoardGlossFetcher.kt`.
- **Both people draw on a shared screen** — the sharer's own screen is a tile like any other
  (large, not a corner preview): **✏️ Draw on it** on the share bar puts it on the stage (their
  camera floats beside it) with the pen on, so the sharer can circle things on their own screen the
  same way the viewer does on theirs. Strokes go both ways over the same `annot` messages and show
  on both views; each person's pen starts in their own colour (sharer blue `#38bdf8`, viewer red
  `#f43f5e`; `defaultAnnotColor`), any swatch can be picked. **Keep** (`annot_mode`, one setting for
  both, remembered by the room and sent in `welcome.annot_persist`; on by default since round 4) stops
  strokes fading until **Clear**; turning it off starts every stroke's fade. While kept the room
  remembers them for a rejoin (see "Typing on a shared screen"). The Document PiP mini window (below) shows both people's
  strokes; the Lab app's overlay too.
- **Typing on a shared screen (round 4)** — next to ✏️ Pen, a **T Text** tool: tap the picture to
  place a text box and type (a real `<textarea>` there, so every IME works; Lab: a TextField over the
  picture); Enter or tapping away finishes it, Esc cancels; tap a text to select it (✕ deletes it for
  both), drag it to move it, tap it again to edit. Texts are anchored to the shared picture (0–1) and
  sized by its shorter side (`AnnotText`, `sanitizeAnnotText`, `moveAnnotText` in
  `shared/calls/annotate.ts`; Lab `CallAnnotate.kt`, parity-tested), in the writer's colour, and reach
  the other person as they are typed (outside a composition, ≤ ~7/s) through `annot_text` /
  `annot_text_delete` room messages; the mini window and the Lab overlay draw them too. **Keep is now ON
  by default** (`DEFAULT_ANNOT_PERSIST`; a room that never set it keeps), so drawings and texts don't
  fade unexpectedly — turning Keep off makes them fade as before. While kept, the room remembers
  finished strokes (≤ 300) and texts (≤ 100) in its storage and sends them in `welcome.annots`, so a
  reconnect or a rejoin shows them again; Clear or switching to fading forgets them.
- **Drawing on a shared screen** — when one person shares their screen, the other taps
  **✏️ Draw on …'s screen** over it: a drag is a stroke (circle a character), a quick tap a "look
  here" ping; strokes fade ~3 s after the pen lifts, **Clear** clears. Points are normalised to the
  shared picture (`shared/calls/annotate.ts`, unit-tested; Lab `CallAnnotate.kt` parity-tested), so
  they land on the same spot in any window size. They travel as `annot` / `annot_ping` /
  `annot_clear` room messages (relayed, never stored). The sharer sees them over **their own
  preview of the share** in the call and, on Chrome / Edge desktop, in an **always-on-top mini
  window** (Document Picture-in-Picture, "See drawings over your other windows" on the share bar;
  `services/calls/annotationPip.ts`) showing their shared stream with the drawings and pings —
  so they see what's being circled while looking at their other window. **Limitation: a browser
  cannot draw on the sharer's real screen**; without Document PiP (Firefox, Safari, phones) the
  drawings show only in the call's own preview. The share bar says "<name> is drawing on your
  screen" either way. The **Lab app can**: while it shares (MediaProjection), the drawings are
  painted over every app in a see-through, untouchable overlay window ("Display over other apps"
  permission, asked for from the share bar; `data/calls/ScreenAnnotationOverlay.kt`).
- **Room** — `worker/src/durable/call-room.ts`, one SQLite-backed Durable Object per call
  (`idFromName(callId)`), WebSocket Hibernation API. Relays SDP / ICE between the two
  peers, keeps the board (`shared/calls/board.ts` ops) and chat, broadcasts media state
  (mic / cam / screen / recording), ends the call (the End button, or automatically — see
  "Who is in the call" below). It copies board + chat to D1 whenever someone leaves.
- **Join tickets** — a WebSocket can't carry the `Authorization` header, so
  `POST /api/calls/:id/join` returns a one-minute HMAC ticket bound to call + user
  (`services/calls/ticket.ts`); `GET /api/calls/:id/ws?ticket=` is registered before the
  auth middleware.
- **Media** — `frontend/src/services/calls/peer.ts`: perfect negotiation, one audio + one
  video transceiver, so camera / flipped camera / screen share are all `replaceTrack`.
  ICE servers come from `GET /api/calls/ice-servers` / the join response: Cloudflare +
  Google STUN, plus Cloudflare Realtime TURN credentials when configured.
- **Recording** — each person records **their own microphone** (no diarization needed:
  every segment already knows its speaker). `services/calls/recorder.ts` starts a new
  `MediaRecorder` every 5 minutes (each *piece* is a standalone webm/opus file) emitting a
  chunk every 10 s. Chunks go to IndexedDB first (`callUploads`, Dexie v18) and are drained
  in order by `services/calls/uploads.ts` — during the call and on every sync afterwards,
  so a flaky connection or a closed tab only delays the upload (offline-first, like study
  recordings). Piece start times are on the server clock so both tracks line up.
- **Processing** — readiness-driven, not a single "finalize": every event that can unblock
  work calls `advanceCallProcessing` (`services/calls/processing.ts`): a piece that is closed
  with all chunks uploaded is queued once; when the call has ended and nothing is in flight,
  the report is queued once. Pieces that will never close (crashed tab) are force-closed by
  **Process now** on the review page.
- **Tiles & layout** — the call is six tiles: their camera, my camera, a shared screen, the text
  board, the drawing board and the chat. `shared/calls/layout.ts` (pure, unit-tested; the Lab's
  `CallLayout.kt` is parity-tested) holds the model: `focus` (one tile on the stage, the rest in a
  side rail ≥ 1024 px or a bottom strip), `split` (two tiles, draggable divider, side by side or
  stacked) and `grid`; **their camera is never hidden** — off the stage it floats (or sits in the
  rail if floating is switched off); my camera floats in a corner (drag → snaps to the nearest
  corner; resize handle). Presets (▦ menu, keys 1–5): Speaker, Board + camera, Screen + camera,
  Side by side, Grid; B / D / C / V / S focus a tile; double-click a tile or its ⤢ focuses it. When
  the other person starts sharing, the layout switches to Screen + camera. `layoutRects` turns the
  layout into pixel rectangles and `CallTiles.tsx` moves ONE element per tile (a transform), so a
  video never restarts and the board keeps its caret when the layout changes. Phones (< 640 px):
  focus only — the tile fills the screen, both cameras float small, a sideways swipe moves between
  tiles (touch events; horizontal overscroll "back" is disabled on the call page), 📝 / 💬 jump to
  the board / chat. The layout is remembered per user on the device (`call-layout-v1:<user>`).
- **Drag and drop (round 4, desktop)** — drag a tile (a rail tile itself, or a stage tile by its ⠿
  grip) onto the stage: five drop zones show — left / right / top / bottom half and the whole stage —
  and the one under the pointer lights up ("Board · Right half"); dropping arranges a split (a
  resizable divider; the tile that was on the stage stays beside it — in a split, the pane on the other
  side) or focuses it (`dropZoneAt`, `dropZoneBox`, `layoutForDrop`, the `drop` action in
  `shared/calls/layout.ts`; Lab parity-tested). Keyboard / no-drag fallback: the grip is a button —
  Enter or a click opens "Move <tile> to: Left half · Right half · Top half · Bottom half · Whole
  stage". **Phones** keep one tile on the stage except a **shared screen with a board**, which may split
  (`narrowSplitAllowed`): stacked in portrait, side by side in landscape (`splitDirFor`) — the Lab app's
  "Show the board beside / above the screen". **The board leaves room for the faces box**: when the
  faces float in a top corner over the text board, `layoutRects` returns `textInsetTop` and the board's
  text starts below the box (it used to cover the first lines).
- **Faces together (round 3, like Preply)** — when content is on the stage (the board, the drawing,
  a shared screen, the chat — neither camera on the stage, not a grid) the two cameras float as ONE
  compact box with both faces side by side, **theirs first**, instead of two separate floating
  tiles (`pip: 'pair'`, the default; `arrangeTiles` → `pair: <corner>`, `layoutRects` → `pair` box
  + both face rects with role `pair`). Each face keeps its camera's shape (clamped 3:4 – 16:9) at one
  shared height (`pairSize`: ~15 % of the stage's shorter side, 72–140 px; phones ~16 %, 56–96 px;
  × `pairScale` 0.6–2; within 60 % / 70 % of the width and 40 % of the height). Drag it anywhere →
  it snaps to the nearest corner (`pairCorner`, top-left by default; the Lab springs there with a
  light haptic); the grip in the corner facing the stage's middle resizes it; a **tap** (not a drag;
  6 px threshold) or Enter / Space on it → Speaker (`pairTap`). In a top corner the box sits below
  the controls along the top of the tile under it (`TILE_HEADER`: Board / Draw tabs 48, + the
  drawing's tool row 104, a shared screen's drawing row 56) so it never covers them. The camera
  tiles stay the same elements (web: moved by transform under a transparent hit layer; Lab: the
  same keyed composables riding the box's drag offset), so video never restarts. ▦ → **Cameras:
  Together / Separate** switches back to round 2's two floating cameras; that toggle is the ONLY
  thing that changes `pip`, so a stored `separate` is always the user's explicit choice and wins
  (restored next call, kept when their share starts). A layout stored before round 3 has no `pip`
  and reads as together. Their share starting dispatches `shareStarted` (the screen on the stage;
  the cameras as `pip` says). 📝 (`boardButton`) now focuses the board with the faces over it; the
  "Board + camera" split only when the cameras are separate on a wide screen. With "Float <their>
  camera" off (wide screens), their camera stays in the rail and mine floats alone.
- **Screen share has its own channel** — the offerer creates audio, camera and screen transceivers;
  the second video m-line is the screen, so the viewer sees the screen AND the sharer's camera. An
  older app that offers one video m-line gets the old behaviour (the screen replaces the camera;
  `screenChannel` false on the web).
- **Video layout** — `shared/calls/videoFit.ts` (pure, unit-tested; the Lab app's `VideoFit.kt`
  is parity-tested against it): a feed is cropped to fill its box (`cover`) only when the two
  aspect ratios are within 15 %; otherwise it is shown whole (`contain`) — on the web over a
  small, dimmed, blurred copy of itself (`components/calls/CallVideo.tsx`, cheap: the copy is
  drawn at 1/8 size and scaled up), in the Lab app on a dark letterbox (the renderer is sized to
  the picture's rectangle). A shared screen is always shown whole. The choice follows the
  track's real size (the video's `resize` event / WebRTC's `onFrameResolutionChanged`, so a
  phone rotating mid-call re-fits) and the box's size (ResizeObserver / `onSizeChanged`). The
  self-view PiP takes my camera's shape (portrait phone, landscape webcam) and ~⅓ of the
  stage's shorter side (`pipSize`, 88–260 px): top-right on phones, bottom-right on wide windows.
  The pre-join preview takes the camera's shape too.
- **Review page** — `/calls/:id/review`: summary, corrections, vocabulary with checkboxes →
  "Add N cards" (`POST /api/calls/:id/flashcards`, through the content service so TTS and
  sentence sets happen as usual), the merged transcript grouped into turns with ▶ per line
  (plays that stretch of the speaker's piece), pinyin (from the transcriber, else
  `pinyin-pro` on the device) and English toggles, the whiteboard snapshot and the chat.

Tables (migration `0071_video_calls.sql`): `calls`, `call_recording_pieces`,
`call_recording_chunks`, `call_transcript_segments`. Audio lives in the existing R2 bucket
under `calls/<callId>/…` and is served by the public `/api/audio/*` route (unguessable
keys, same model as study recordings).

## Board pages

Like Preply's canvas, the board keeps its content **per tutor relationship, across calls, as
numbered pages** (a solo test call has its caller's own pages). Rules: `shared/calls/pages.ts`
(unit-tested); storage: `board_pages` + `call_board_pages` (migration 0086); the room:
`worker/src/durable/call-room.ts`; D1 layer: `worker/src/services/calls/pages.ts`.

- **Which page a call opens on** (`pickOpeningPage`, decided by the room on the first join): no pages
  yet → a new page; the last page still empty → reuse it; the page used most recently was used by a
  call **within 3 hours and on the same local day** (the call starter's time zone, `users.time_zone`)
  → continue it (a dropped call, or a second call to fix the sound, carries on); otherwise **a new
  page at the end** — every lesson starts on a fresh page with all earlier pages one tap away.
- **The strip** (`components/calls/BoardPageStrip.tsx`, Lab `BoardPageStrip`): along the bottom of
  the board, a scrolling row of small paper thumbnails (the page's first lines) numbered 1, 2, 3… (or
  the page's title), the current one highlighted, a dot in the other person's colour on the page they
  are on, **+** for a new page; **⋯** on the current page → Rename / Duplicate / Delete (confirm: "Delete
  page N? Its text is removed for both of you."; the last page can't be deleted). Anyone may do any of
  it; the room broadcasts the new list.
- **Each person turns pages on their own.** Following is opt-in: when the other person is on another
  page a bar says "<name> is on page 5" with **Go there**, **Follow <name>** (my view jumps whenever
  theirs does; turning a page myself stops following; kept by user id, so their reconnect doesn't
  break it) and **Bring <name> here** (moves them to my page at once; they see "<name> brought you to
  page N"). Both start on the opening page. Deleting the page someone is on moves them to the next
  page ("<name> deleted page N").
- **Protocol**: `text` / `text_cursor` carry `page` and are only relayed to people looking at that page;
  `page_open` → `page_doc` (the page's CRDT snapshot + carets on it), `page_new` / `page_duplicate` (the
  room opens the new page for the sender), `page_rename`, `page_delete`, `page_summon`; the room sends
  `pages`, `page_view`, `page_preview` (thumbnail text, coalesced with the 400 ms storage write),
  `page_deleted`, `page_summon`. `welcome` carries `pages`, `page` (the opening page — `text` is its
  document, so an app from before pages keeps working on it) and `page_views`. A rejoin while on
  another page asks for that page again; edits typed offline are re-sent tagged with their page.
- **Storage**: the room loads the relationship's pages from D1 when the call starts, keeps every page
  it touched in its own storage, and on leave / end writes the changed pages back (`board_pages`) and
  the call's links (`call_board_pages`: each page the call opened or wrote on, with its text as it stood
  when that call ended). `calls.board_text` becomes the text of the pages **written in that call** (one
  page as is, several headed "— Page 3 —"), so the review page, the lesson report and the session-notes
  homework agent (`composeCallNotes`) still get exactly that call's writing. Two calls live at once for
  one relationship (rare) each hold their own copy; the last to end wins for a page both changed.
- **Migration**: 0086 turns every earlier call's `board_text` into a page of its relationship (in call
  order, one CRDT run from the site `import:<call id>`, `snapshotFromText`) and links it to the call, so
  the strip starts with the lessons already given.
- **Outside a call — the Lesson board** (`/connections/:relId/board`, "📝 Lesson board · N pages" on the
  student / tutor page; Lab: same route): every page, read-only, the same strip, the page large on
  paper, Copy text. **Read-only on purpose**: editing happens in a call, where the room merges both
  people's typing; a writer outside the room could not be merged into its CRDT (and a lesson's notes
  are written together). Offline: `GET /api/me/board-pages` fills IndexedDB `boardPages` (Dexie v24;
  Lab `JsonCache`) from the sync every 30 min, after every call and whenever the page opens online.
- **Review page**: the Board section shows the call's pages (`GET /api/calls/:id/board-pages`), each
  with its number / title and the text it held when the call ended ("Deleted page" if deleted since).
- **The drawing board stays per call** (not paged): its strokes are small ops kept with the call
  (`calls.board_json`) and shown on the review page; paging it would need the same page machinery for
  a second document type, with little use across lessons so far.

API (`worker/src/routes/board-pages.ts`, read-only, either person of an ACTIVE relationship):
`GET /api/relationships/:relId/board-pages`, `GET /api/me/board-pages`, `GET /api/calls/:id/board-pages`
(members of the call).

## Joining when the camera or microphone won't open

Joining never depends on the devices: without a camera you join with audio, without a microphone
you join to listen and watch, and the 🎙️ / 📷 buttons turn a missing device on later (a tap asks the
browser again; the track goes onto the existing transceiver with `replaceTrack`, no renegotiation;
recording starts when a mic appears). `services/calls/mediaAccess.ts` (unit-tested) asks for camera +
mic together, then each alone, and classifies what went wrong — `blocked` (site blocked in the
browser, or an organisation's policy), `system` (macOS / Windows privacy settings stop the browser),
`dismissed`, `in-use` (Teams / Zoom has the camera), `no-device`, `insecure`, and `waiting` (no
answer after 6 s: the prompt is probably hidden behind an address-bar icon). `MediaProblemCard`
shows the exact steps for that browser and OS plus **Try again** (a tap, which also brings back a
suppressed prompt); a permission switched to Allow in site settings is picked up without a reload
(`navigator.permissions` change). The Join button says what you'll join with ("Join with audio only",
"Join without camera & mic"). **Devices** (⚙️ before joining, ⋯ → Camera, mic & speaker in the call):
camera / microphone / speaker (`setSinkId`), remembered per device (`call-devices-v1`), together
with whether the mic was **muted** (`micOff`): a rejoin — a reload, the next call of the lesson —
comes back muted if you left it muted, and Join waits up to 4 s for a camera / mic request still in
flight instead of joining with nothing (Minghui's rejoins on 2 Oct 2026 logged "joining with no
mic, no camera" with no device error: she pressed Join before the preview had its devices).

**The camera always starts on (round 5).** Minghui still found her camera off every time she
joined. Two causes: (1) when her Mac's camera answered after the 4 s wait, the call was still
*joining* (the room socket connecting) and the web app only announced a device that opened once the
call was *live* — so the room, and Jerome's screen, kept `cam: false, mic: false` from the join line
until she toggled; (2) round 4 remembered `camOff`, so switching the camera off at the end of one
lesson started every later call dark. Now `shared/calls/devices.ts` decides (Lab `CallDevices.kt`,
parity-tested): `deviceOnWhenOpened` — the camera comes on whenever it opens (preview, join,
rejoin; "off" is never remembered, an old `camOff` in storage is ignored), the mic keeps round 4's
rule; `announceDevice` — a device that opens is announced from Join on (`joining` included). The
connection log has a "camera opened while joining" line. The join line in the connection log says "mic / mic muted / no mic".

Our side sends no `Permissions-Policy` header (the Pages site and the worker were checked), and the
preview's `getUserMedia` runs on page load, which Chrome allows; so a missing prompt comes from the
browser / computer — a site previously blocked, a prompt dismissed a few times (Chrome then stops
asking), or a work machine's policy. Before this change that left the Join button disabled with no
way forward.

## Staying connected

The room socket (signalling) and the WebRTC link (media) are independent, and the rules are pure,
in `shared/calls/connection.ts` (Lab: `CallConnection.kt`, parity-tested):

- **Same page, new socket** — each page load / app session has an `instance` (the socket URL's
  `?instance=`). A socket that drops and comes back from the same instance keeps its
  RTCPeerConnection on both sides (`shouldAdoptPeer`); the room closes the dead socket quietly (4001)
  instead of saying "replaced". The other person's socket leaving keeps their picture (frozen on the
  last frame) for `PEER_AWAY_GRACE_MS` (30 s) before the link is closed. A reload / second device is
  a new instance → a new link, as before.
- **Dead sockets** — ping every 10 s, no pong in 8 s → close and reconnect; the browser coming back
  `online` checks at once; messages from a stale socket are ignored.
- **ICE restarts** (`nextIceRestartAt`) — `disconnected` gets 2.5 s to heal, then `restartIce()`;
  `failed` restarts at once; then 2 s, 4 s, 8 s … 30 s; only while the socket is open (re-checked when
  it returns), and signals always go to the other person's current socket.
- **Never blank** — the `<video>` element and its `srcObject` stay through a drop; the tile shows a
  small "Reconnecting…" badge (`tileStatus`), "Connecting…" before the first connect.
- **Encoders** (`videoEncodingFor`) — camera: `maintain-framerate`, ≤ 900 kbps, ¼ / ½ resolution when
  the outgoing estimate (`availableOutgoingBitrate`) falls under 180 / 350 kbps (1.5× hysteresis);
  screen: `maintain-resolution`, ≤ 1.5 Mbps, 15 fps; audio `networkPriority: high`.
- **TURN** — Cloudflare Realtime TURN when `TURN_KEY_ID` / `TURN_KEY_API_TOKEN` are set; every URL it
  returns is offered except port 53, i.e. UDP 3478, TCP 3478/80 and **TLS 443** (gets through
  firewalls that only allow HTTPS).
- **A failed link is renegotiated, never kept** (round 4) — `shouldAdoptPeer` keeps a link
  through a reconnect only while it can still carry the call (`connecting` / `connected` /
  `disconnected`, `linkWorthKeeping`); a `failed`, `closed` or never-started (`new`) one is replaced.
  Every link has an id sent with each signal (`link`) and opens with `hello`; a signal from a new link
  id of theirs makes mine start over too (`linkSignalAction`: apply / replace / ignore leftovers of a
  replaced link), a hello makes an unanswered offer go out again, and a kept link re-sends its
  unanswered offer when they come back (`resume`). On 2 Oct 2026 Minghui's network froze, ICE
  restarts failed, and the reconnect "kept" a link whose offer had gone to her dead socket: a minute
  with no media.
- **Connection log** — each side sends `diag` events (pc / ICE state changes, restarts, socket status,
  the route in use — host / srflx / relay and its protocol + RTT —, device problems, whether TURN was
  offered, peer away / back); the room keeps the newest 600 and copies them to
  `calls.diagnostics_json` (migration 0085); the review page has a collapsed **Connection log**.
  The room adds its own lines (kind `call`, bold): who entered, left (Leave / closed the page),
  timed out, and **who ended the call and how** (End for everyone, End over HTTP, deleted, or
  automatically when nobody was in it) — before round 4 the log didn't say who ended a lesson.

## Typing latency on the board

The room relays a keystroke **before** storing it and stores the board / text / log at most every
400 ms with `allowUnconfirmed` (a durable write per keystroke used to hold the next keystroke's
relay behind the output gate, and serialised the whole document — up to 125 KB — each time; a lost
write is harmless because clients replay unconfirmed edits on rejoin). The client sends each edit
at once. Chinese typed through a pinyin IME only enters the document when the composition is
committed, so the other person used to see nothing for the whole composition (2 s+ for a phrase):
now `text_cursor` carries `compose` (≤ 40 chars, ≤ 12 updates/s) and the composition shows in the
typist's name flag above their caret ("Jerome · wo ba cha") — never in the text, so nothing moves.
Measured locally (two Chromium contexts, `wrangler dev`, 960-char document, 60 keystrokes):
relay p50 10.1 → 7.5 ms, p90 13.5 → 12.3 ms; first sign of IME typing: at commit (≈ 2.1 s) → 17 ms.
In production the network round trip to the room dominates.

## The board is paper

The text board, the drawing board and the chat are always light paper with dark ink (`#111827`)
for both people, whatever the theme: `color-scheme: light` on the panel on the web, a `BoardPaper`
palette in the Lab app (its dark theme used to paint light ink on the white board).

## Who is in the call (presence) and when a call ends by itself

A call row stays `live` until someone presses End — and before this, a room nobody was in never
ended: on 30 Sep 2026 Jerome and Minghui pressed "Video call" in the same second, two calls were
made, both joined Minghui's, and Jerome's (nobody ever entered it; its room never had a socket, so
the 20-minute empty-room alarm — armed only when a socket left — never ran) stayed "live", and both
apps showed "📹 … is calling — Join" for hours. Now (pure rules in `shared/calls/presence.ts`,
applied by the CallRoom; worker tests with a mocked clock in `durable/__tests__/call-room.test.ts`):

- **Present** = the socket is open, hasn't said `leave`, and the room heard from it in the last
  **45 s** (every client pings every 10 s; the room notes the time at most every 5 s in the socket's
  attachment, so it survives hibernation). A phone that went to sleep or was killed without closing
  its socket drops out within ~45 s: the room's alarm, set just after the oldest present socket
  would time out, closes it (4003, the client reconnects if it is in fact alive) and tells the other
  side `peer_left`.
- **Ends by itself** — through the same path as End (`ended_at`, the "missed call" push, post-call
  processing): **10 min** after the last person left (time for a reload or a network blip), or
  **10 min** after creation for a call nobody ever entered (the caller may still be on the pre-join
  screen). `POST /api/calls` arms the room; `GET /api/calls` asks each live call's room
  `presence()` (≤ 10 rooms, 2.5 s), which also ends a room past its deadline — so a call stuck from
  before this change is swept up on the first poll after deploy. No "missed call" push for a call
  ended more than 30 min after it was created.
- **Leave** — the web's page unmount and the Lab's Leave send `{ type: 'leave' }` before closing;
  closing the tab sends it too plus a **beacon** on `pagehide` (`POST /api/calls/:id/leave`
  `{ client_id, token }`, no session — the token is the socket's secret from `welcome.leave_token`;
  text body, always 204); the Lab app sends it when swiped away from recents
  (`CallService.onTaskRemoved`). Switching to another app is not leaving (the call goes on in the
  background; the heartbeat decides).
- **One call per relationship** — `POST /api/calls` returns the relationship's live call instead of
  a new one (`reused: true`, no chat line / push) when someone is in it, or when it started in the
  last 10 min (one conditional `INSERT … WHERE NOT EXISTS`, so two presses in the same second can't
  both insert).

## The tutor leads: Show for student, Stop their share (round 5)

Rules in `shared/calls/follow.ts` (Lab `core/…/calls/CallFollow.kt`, parity-tested); the CallRoom
enforces who may do what — the **relationship's tutor** (`relationshipTutor`, sent to clients as
`welcome.tutor_id`; nobody in a solo call).

- **Show for student** — on whatever is on the tutor's stage (the text board, the drawing board, a
  material page, her own shared screen, an activity) a small corner button **👁 Show for student**
  (**Showing ✓** while it is shown). It sends `show { view }`; the room keeps the latest
  `ShownState { id, v, by, name, view, at }` in storage (so a reconnect gets it in `welcome.shown`)
  and broadcasts `shown`. **Opening the board shows it without the button** (`autoShowBoard`: a
  board tile came onto her stage). Turning the board page while the board is shown sends
  `show { follow: true }` — the same show (`id`), `v` + 1 (`nextShown`).
- On the student's device (`followStep`): a NEW show (new `id`) puts that tile on the stage once
  (layout action `shown`: focus it with the cameras floating, or leave a split that already has it),
  opens the shown board page and shows a quiet **"Minghui is showing you this"** pill with ✕ (gone as
  soon as the student looks elsewhere). After that their own layout choice wins until the tutor shows
  something new; her page turns are followed only while they are on the board. A show of a tile that
  isn't there yet (a material still opening) is applied when it appears. The show button pressed
  again is a new show (pulls the student back). Materials already share page turns for both.
- **Stop their share** — on the screen tile showing the student's share, the tutor gets **⏹ Stop
  their share** (`stop_share`). The room checks `canStopShare` (tutor, the other person; the student
  gets an error), sends `share_stopped { name }` to the sharer, sets their `state.screen` false and
  tells everyone (`peer_state`). The student's device stops capturing (exactly like its own Stop) and
  shows **"Minghui stopped your screen share"** for a few seconds.
- Tests: `shared/calls/follow.test.ts`, `worker/src/durable/__tests__/call-room-follow.test.ts`
  (permissions, follow-ups, welcome after a reload), `e2e/tests/video-call-follow.spec.ts` (two
  browsers), Lab `CallControllerTest` / parity tests.

## Lessons: calls in a row are one lesson (round 4)

On 2 Oct 2026 one lesson became four calls: Jerome pressed the big red button to switch to his
computer (it ended the call for both, an ended room refuses joins), Minghui's network froze, and a
4-second accidental call followed — and Minghui then made homework three times (three decks).

- **Leave vs End** — the red button still ends the call for everyone, but asks first ("End the call
  for everyone? To switch device or step away, Leave instead — the call goes on." · Just leave · End
  for everyone · Cancel). **🚪 Leave** sits next to it on wide screens and in ⋯ everywhere: it sends
  `leave`, and the page says "You left the call — it goes on for <name>" with **Rejoin** (same call,
  same page; devices restored as you left them). A call nobody is in ends by itself after **10 min**
  (`EMPTY_CALL_END_MS`, was 3).
- **The rule** (`shared/calls/lessons.ts`, unit-tested; Lab port parity-tested): calls between the
  same two people (a relationship; a solo call: its caller) belong to one **lesson** when a call
  starts no more than `LESSON_GAP_MS` = **2 hours** (20 min until round 5) after the previous one ended, or while it is still
  live. `POST /api/calls` puts the new call in the open lesson (`lessonForNewCall`,
  `services/calls/lessons.ts`) or starts one; ending a call updates the lesson's `last_ended_at`.
- **Storage** — migration 0089: `call_lessons` (relationship, started_at / last_ended_at in ms,
  processing_status none | waiting | summarizing | done | failed, summary_json, report_call_ids) and
  `calls.lesson_id`. The migration back-filled every existing call by the same rule (2 Oct's four
  calls → one lesson); a one-call lesson kept its call's report, a lesson of several calls gets its
  combined report the first time it is opened.
- **Processing is per lesson, incremental** — each call's pieces are transcribed as before; when a
  call has ended and is transcribed, and no call of the lesson is live or still transcribing, the
  lesson report is (re)written over ALL its calls (`lesson_report` queue message,
  `processLessonReport`). A call that joins later makes the report stale (`report_call_ids`) and it is
  written again when that call is transcribed. Chosen over "wait until the 20-minute window has
  passed": that would make every report two hours late for a case that is rare. "Process now" on the
  review page re-runs the whole lesson.
- **What shows per lesson** — `GET /api/calls/:id` returns the lesson (`lesson.calls`) and its whole
  transcript, recordings, board pages / text, chat, connection log and report; the review page shows
  "One lesson, N calls in a row: 12:31–12:53 · …". **Past calls** lists one entry per lesson
  (`groupCallsByLesson`) with its calls underneath. **Make homework** works on the lesson once:
  `POST /api/calls/:id/homework` returns the existing job (`existing: true`, with `jobs`) when any call
  of the lesson already has one that didn't fail or get cancelled; the agent reads all the calls.

## Lesson materials: present a PDF, slides or a picture (round 4)

Minghui teaches from PDFs and PowerPoints. A **material** is one of those files in the tutor's library
(More → 📑 Lesson materials, `/materials`), and in a call **⋯ → 📑 Present material** puts it on the stage for
both people as its own tile (`material`, transient like a shared screen: it exists only while presenting).

- **Upload** (`frontend/src/services/materials/`): the uploader's DEVICE draws the pages and uploads them as
  JPEG pictures at 1600 px wide (`MATERIAL_RENDER_WIDTH`), so every viewer — web, Lab, offline — only ever
  shows pictures. PDF: pdf.js (`render.ts`, text per page from its text layer). Picture: re-encoded, one page.
  **PowerPoint**: `pptx.ts` opens the .pptx (JSZip), reads each slide's XML in order and draws its text boxes
  (sizes, bold, colours, bullets) and pictures on a canvas, plus the speaker notes; the material carries
  `render_note` = `PPTX_RENDER_NOTE` ("for exact slides, export the PowerPoint as PDF and upload that"),
  shown on the material. Limits (`shared/materials`): 50 MiB per file, 8 MiB per page picture, 300 pages.
  The original file is kept too (download from the viewer).
- **Why not a server-side converter**: exact PPTX rendering needs LibreOffice, i.e. a Cloudflare Container.
  That means building and pushing a ~1 GB image in the deploy workflow, a new failure point in a
  non-transactional deploy (a failed image push after the Worker deploy would leave a broken half), and cost
  for a feature used a few times a week. Drawing on the device + "export as PDF for exact slides" covers the
  case with no new infrastructure; a Container can be added later behind the same `PUT …/pages/:n` API.
- **Storage**: R2 `materials/<owner>/<id>/original.<ext>` and `p<N>.<ext>` — a protected prefix in the
  storage clean-up registry (person-made, never collected); account deletion removes them. Tables
  (migration 0092): `materials`, `material_pages` (image key, size, text, notes), `material_shares`
  (per relationship), `material_annotations` (per lesson, material and page: `KeptAnnotations` JSON),
  `call_materials` (which pages a call showed).
- **Access**: the owner, plus either person of a relationship it is shared in. Presenting a material in a
  call of a relationship shares it with them (so the student can open it afterwards).
- **In the room**: `material_open { material_id, page }` (the room checks access), `material_page { page }`,
  `material_close`; everyone gets `material { presenting }` and the page's kept drawings
  (`material_annots`). Either person turns the pages (‹ › or ← →). Pen / Text and Keep work exactly as on a
  shared screen (`annotate.ts`), except each annot message carries `target: material:<id>:<page>`: a drawing
  belongs to that page, comes back when the page does, and is saved per page **per lesson** (`call_lessons`)
  when the room snapshots — a later lesson starts on clean pages. A late joiner gets `welcome.material` +
  `welcome.material_annots`.
- **Offline**: page pictures are kept in the Cache API (`materials-v1`) whenever shown, presented (the whole
  material is fetched when presenting starts) or uploaded, and the page list in localStorage, so a material
  presented recently opens on the train. "Keep on this device" on the viewer fetches every page.
- **Agents**: the lesson's presented materials (with the pages shown and their text) go into the notes the
  homework agent reads (`composeCallNotes` → "LESSON MATERIALS PRESENTED"); the agent also has `list_materials` /
  `read_material` for others the notes mention. MCP: `list_materials`, `read_material`.
- API (`worker/src/routes/materials.ts`): `GET|POST /api/materials`, `PUT /api/materials/:id/original`,
  `PUT /api/materials/:id/pages/:n`, `POST /api/materials/:id/complete`, `GET /api/materials/:id`,
  `GET …/pages/:n/image`, `GET …/original`, `GET …/text`, `PATCH|DELETE /api/materials/:id`,
  `POST …/share`, `DELETE …/share/:relId`, `GET …/annotations?lesson_id=`.

## In-call activities: two-person mini lessons (prototype)

Mini lessons you do **together** in the call: **⋯ → 🎲 Activities** opens a picker of short two-person
activities; picking one puts an `activity` tile on the stage for both people (transient like a presented
material, `activityStarted` in `shared/calls/layout.ts`, key **A**). Each person has a role and sees their
own side; the tutor runs it; the result is kept with the lesson.

- **The framework** (`shared/call-activities/`): a SPEC (hand-written content, `catalogue.ts`, keyed by
  level / topic) is played as a SESSION — one state machine (`engine.ts`) that the **CallRoom owns**.
  Clients send actions; the room runs `reduceActivity(session, action, actor, now)` and broadcasts the whole
  session (small JSON, `v` bumped per change) to both. A refused or stale action (wrong role / phase / old
  session id) changes nothing and the room sends the sender the current session, so a confused screen
  catches up. The spec rides inside the session (a client never needs the room's catalogue version; generated
  activities can come later). The Lab app's `CallActivities.kt` is a port, parity-tested against vectors the
  TS engine makes (`android-lab/parity/fixtures/call-activities.ts`).
- **Roles** — `a` / `b`, named per activity (`role_names`: Describer / Guesser, Reader / Writer, 服务员 /
  客人 …). The relationship's **tutor** takes the spec's `tutor_role` and is the **host** (skip, reset the
  round, swap roles, restart, next); whoever started it doesn't matter. Either person may end it (the
  summary shows) or close it. In a **solo** test call one person holds both roles and a "viewing as A / B"
  switch shows either side; someone joining a solo-started activity takes a role (`joinActivity`). The UI
  shows a button only when the engine would accept that action from me (`reduceActivity(…) !== null`), so
  screen and room never disagree.
- **Reconnect-safe** — the session lives in the room's storage (`activity`), comes back in
  `welcome.activity` after a reload / rejoin, and is written to D1 when it finishes, is closed or replaced,
  when someone leaves and when the call ends.
- **Audio** — quiz questions with `audio` and dictation words: the asker's "Play for both" bumps
  `data.play`; each device plays the clip (cache-first TTS, `/api/practice/tts`) when it sees the counter go
  up — never on first sight, so a reload doesn't replay it. Everyone can replay locally.
- **Protocol** (`shared/calls/protocol.ts`): `activity_start { activity_id }` (replaces any running one,
  keeping its result), `activity_action { session_id, action }`, `activity_close { session_id }`; the room
  answers `activity { session | null }`.
- **Results** — `call_activities` (migration 0094, upsert by session id; `ActivitySummary`: played / scored /
  correct, roles, one readable line per round like "你好 (nǐ hǎo, hello) — wrote 你号 ✗"). `GET /api/calls/:id`
  returns the lesson's `activities` → the review page's **Activities** section; the homework agent's notes get
  an **IN-CALL ACTIVITIES** block (`activitiesNotes`, `services/calls/activities.ts`), so homework can follow
  up on what went wrong.

The activities (9 samples in the catalogue):

| Kind | How it works | Samples |
|---|---|---|
| 🎯 **Describe & guess** (`describe`) | A sees an emoji + word (+ hint words) and describes it in Chinese without saying it; B picks it from four (correct + three others, seeded shuffle); reveal ✓ / ✗; host Next. The student describes by default. | food (beginner), animals (elementary) |
| 🧩 **Information gap** (`info_gap`) | A small table (weekend plans of 小明 / 小红); every cell is visible to one person only (`owner`), the other fills it from a choice list after asking ("小红星期六上午做什么？"). Each sees what the other filled in their visible cells; **Check answers** (either) scores the table. | weekend plans |
| 🎭 **Role-play** (`roleplay`) | A scripted dialogue; lines appear turn by turn, the current one big; the speaker of the line (or the host) taps **Done ▸**; 拼 / EN toggles per device, ▶ per line; ◂ Back; swap roles and go again. | restaurant (13 lines), asking the way |
| 🧱 **Sentence building** (`build`) | Scrambled word tiles (never already in order); **either** person taps them into the answer row (tap again to take one out); the host reveals the model answer; then each taps **I said it ✓** after saying it aloud. | 把 / 了 / 过 / 比 sentences |
| ❓ **Quick quiz** (`quiz`) | The asker sees the next question with its answer and pushes it (**Ask ▸**); a listening question plays on both devices with the text hidden; the answerer's pick shows live on the asker's screen; Reveal auto-marks, the asker can override ✓ / ✗. | tones minimal pairs (买/卖, 汤/糖, 有/又…), measure words |
| ✍️ **Dictation** (`dictation`) | The reader sees the word, says it (or plays it for both) and starts the round; the writer types it in characters — the reader watches it being typed (throttled `draft` actions); Submit; Reveal checks it (`isHanziAnswerCorrect`, punctuation ignored) and shows a character diff; the reader can override the mark. | everyday words |

**Add an activity**: append a spec to `ACTIVITY_CATALOGUE` (`validateActivitySpec` + the catalogue test check
it; the Lab parity test checks the Kotlin catalogue matches). A new KIND needs its types, `roundData` + a
`step` case in `engine.ts`, a summary line, a view in `components/calls/activities/ActivityViews.tsx` and the
Lab's `ActivityTile`.

What I'd build next: "make one from this lesson's words" (Claude writes a spec from the board / report /
student's struggling words — the spec already travels in the session); handwriting in dictation (the stroke
pad); a shared drag for sentence tiles; a timer / points race; activities as homework afterwards (the same
spec played solo).

## Finding the call (banners, ring, notifications)

The person being called must notice. Every signal comes from ONE list, `GET /api/calls?live=1`,
and ONE pure rule set, `shared/calls/alerts.ts` (the Lab app's `CallAlerts.kt` is parity-tested):

- **Banners** — `pickCallBanner`: only a call **someone other than me is connected to right now,
  and I'm not** (`someoneElseInCall` over the list's `present_user_ids`; a server without presence
  → not older than 4 h, as before); an incoming call (someone else started it) wins over my own call
  to rejoin; newest first; not the call already on screen, not one I hid (✕ on every banner, inline
  ones too). So the banner goes on the next poll (≤ 20 s) once the caller leaves or the call ends. "📹 王老师 is calling — Join" appears as a big card
  on **Home** (study and tutor home), a bar across the **top of every normal page** (not full-screen
  pages like a study session, not where the page shows its own), **inline** on the student / tutor
  page and in the **chat** (`components/calls/CallBanner.tsx`, `CallAlerts.tsx`). The web polls every
  20 s while visible (`hooks/useLiveCalls.ts`) and refreshes at once when a push arrives.
- **Ring** — `callToRing`: a new incoming call started in the last 2 minutes, with the caller in it,
  rings once per device (and stops when they leave)
  (a Web Audio chime every 2 s + vibration, 30 s at most; `services/calls/ringtone.ts`), unless the
  account is **Silent** (Settings → Video call alerts; `users.call_alerts`, `PUT /api/profile/call-alerts`).
  Browsers only play sound on a page that has been used; the banner shows regardless.
- **Web Push** (PWA / desktop browser) — `POST /api/calls` sends "📹 <name> is calling" to the other
  member's subscriptions (`services/calls/alerts.ts` → `services/push/`). The service worker
  (`public/push-sw.js`, imported by Workbox) shows it unless a normal page of the app is in front
  (that page rings instead), tap → the call. When the call ends and they never joined (the room
  records who joined), a "Missed video call" notice replaces it. VAPID + RFC 8291 encryption are done
  with WebCrypto in `services/push/webpush.ts` (unit-tested by decrypting like a browser). Keys: the
  `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` secrets when set, otherwise a pair generated once and kept
  in `app_keys`; a device re-subscribes when the key changes. Subscriptions: `push_subscriptions`
  (migration 0080), dropped on 404/410 or after 5 failures. The user turns notifications on from a
  tap (Settings, or the "🔔 Get a notification when <name> calls" nudge on the tutor / student page).
  The hybrid Android app (Capacitor WebView) has no Web Push — it gets the banners and the ring.
- **Lab app** — polls every 20 s while in front and rings with the phone's ringtone; there is **no
  FCM project**, so in the background `CallWatchWorker` checks about once a minute for 2 hours after
  the app is left (WorkManager may stretch that in Doze) and the hourly shell check looks too, each
  posting a high-priority "📹 <name> is calling" notification (tap → the call). True instant push
  would need Firebase Cloud Messaging (a `google-services.json`, the FCM server key as a worker secret,
  and the worker sending to FCM tokens next to Web Push).

API: `GET /api/push/config` (`public_key`, `call_alerts`, `subscriptions`), `POST|DELETE
/api/push/subscriptions`, `POST /api/push/test`, `PUT /api/profile/call-alerts`; `call_alerts` is on
`/api/auth/me`.

## The native Lab app (android-lab/)

The Lab app is a second client of the same API, room protocol and upload routes
(`android-lab/app/…/ui/calls/`, `data/calls/`, `core/…/calls/`). Differences worth knowing:

- **Recording format**: Android has no streaming webm MediaRecorder, so the phone encodes Opus with
  MediaCodec (Android 10+) and writes the Ogg pages itself (`core/…/calls/OggOpus.kt`); pieces are
  registered as `audio/ogg;codecs=opus`, which the worker already accepts. Chunks are cut by audio
  time (10 s of samples), pieces every 5 minutes, exactly like the web's timers.
- **Mic source**: while a peer is connected the recorder taps WebRTC's own (echo-cancelled) capture;
  alone in the room it opens its own AudioRecord, because WebRTC only captures while sending.
- **Uploads** go through the app's Outbox (Room): register → raw chunk PUTs → close, drained during
  the call, after every sync and by the background worker; a killed app's open pieces are closed on
  the next sync.
- **Background**: a foreground service (microphone / camera / mediaProjection) keeps the call and
  its recording alive with the screen off; screen sharing uses MediaProjection.

## Setup — what needs a key

**Nothing new is required.** With the secrets the app already has:

| Piece | Uses | Status |
|---|---|---|
| Rooms, recording, storage | Durable Objects, R2, D1, Queues | created by `wrangler deploy` / `deploy.yml` (queue `call-processing-queue` added to "Ensure Queues Exist") |
| Transcription | `GEMINI_API_KEY` (already a secret) | default provider |
| Lesson report | `ANTHROPIC_API_KEY` (already a secret) | Claude Sonnet |
| Fallback transcription | Workers AI `AI` binding | no key |

Optional, worth adding:

1. **TURN relay — `TURN_KEY_ID` + `TURN_KEY_API_TOKEN`** (GitHub Actions secrets; `deploy.yml`
   already pushes them). Without TURN a call connects on most home / office networks but can
   fail on phone carrier NAT or strict Wi-Fi. Cloudflare dashboard → **Realtime → TURN
   Server → Create**; copy the key ID and API token. Free up to 1,000 GB/month (a 1-hour
   video lesson relayed is well under 1 GB).
2. **Better transcription — `SONIOX_API_KEY`** (GitHub secret, already wired). When set,
   Soniox is used instead of Gemini. Sign up at console.soniox.com.
3. Check the **Gemini key is on a paid tier** — on the free tier Google may use the lesson
   audio to improve its products.

`CALL_TRANSCRIBE_PROVIDER` (`gemini` | `soniox` | `whisper`) forces one provider;
`CALL_GEMINI_MODEL` is tried before the Gemini model list (`GEMINI_FLASH_MODELS` in
`worker/src/services/gemini.ts`; a 404 moves on to the next model). Any provider
failure falls back to Whisper so a lesson is never left without a transcript.

## Choosing a transcription service

The hard part is **code-switching**: Mandarin and English inside one sentence
("我想 order 一个 coffee"). Volume is tiny — 1–4 lesson hours a month = 2–8 billed audio
hours (two tracks) — so every option costs under ~$3/month and the choice is about
quality and friction. Researched September 2026; code-switching claims are the vendors'
own — there is no neutral zh/en code-switching benchmark.

| Option | ~$/audio hr | Code-switching zh/en | Timestamps | Friction |
|---|---|---|---|---|
| **Gemini Flash** (generateContent + audio) — **default** | ~$0.12 | Good in practice; we also get pinyin + translation per line in the same call | Segment, model-generated (can drift a little; pieces are ≤5 min so drift stays small) | none — key exists |
| Gemini 3.5 Transcribe (new dedicated model) | ~$0.30 | Vendor: intra-sentence code-switching, `cmn-Hans-CN` | Word | none, but new Interactions API — not wired yet |
| **Soniox** `stt-async-v5` — **wired, optional** | ~$0.10 | Its main selling point; per-token language | Token (ms) | light signup |
| ElevenLabs Scribe v2 | $0.22 (4.5 h/month free) | Mandarin in its high-accuracy tier; no explicit switching claim | Word | light signup |
| AssemblyAI Universal-3.5 Pro (also on Workers AI) | $0.21 | Vendor docs show an English↔Mandarin example | Word | Cloudflare credits or signup |
| OpenAI `gpt-transcribe` / `gpt-4o-transcribe` | $0.27–0.36 | `languages: [zh, en]` hint | none (only `whisper-1`) | paid account |
| Workers AI Whisper large-v3-turbo — **fallback** | $0.03 | Weak: tends to translate / drop the switched language | Segment + word | none |
| Qwen3-ASR (Alibaba) | ~$0.13 | Strongest native Chinese model | Word (file API) | heavy (Alibaba Cloud account) |
| Deepgram Nova-3, xAI grok-stt | — | No Chinese in multilingual mode / no Mandarin | — | ruled out |

Recommendation: keep **Gemini** as the zero-setup default; if transcripts of real lessons
disappoint, add a **Soniox** key (best code-switching per dollar). The cheapest way to
decide is to run two or three real lesson clips through both and compare — the
review page shows which provider made each transcript.

## Limits of the prototype

- 1:1 only (a tutor and a student; a third connection is refused). Media is peer to peer —
  no SFU, so no server-side composite recording.
- Only **audio** is recorded (for the transcript). Recording video would mean an SFU
  recording pipeline (Cloudflare Realtime / RealtimeKit) or large client uploads.
- Screen sharing needs `getDisplayMedia` — desktop browsers yes, Android Chrome no (the
  button is hidden where unsupported). The native Lab app shares its screen with MediaProjection.
- Transcripts are after the call, not live captions.
- The review page seeks inside MediaRecorder webm files, which have no cue index; Chrome
  copes for ≤5-minute pieces.

## Ideas for next steps

- Tutor-side "Send these words to the student" from the report (a homework deck).
- Log the lesson automatically (`tutor_lesson_log`) and feed the transcript into the
  student's lesson notes / daily reader.
- MCP tools: `list_calls`, `get_call_transcript` so Claude can prep the next lesson.
- Live captions via a streaming STT provider.
