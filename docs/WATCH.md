# 📺 Watch (追剧) — Chinese TV on YouTube with a timed, tappable transcript

Jerome watches Chinese dramas on YouTube (小欢喜, 欢乐颂, 三十而已, 开端, 繁花) and kept pausing: he wanted to
look words up and add them to his study at once, replay a line until he understands it, and watch a little
slower. **Watch** plays the episode in YouTube's own embedded player and puts a scaffold under it: the line
being said as word chips (→ the language explorer: look up, + Add as card, ⚡ Study it today), ⏮ 🔁 ⏭ by line,
0.75× / 0.5×, "Pause after each line", and a listen-first mode that hides the Chinese until he taps.

Web: `/watch` (list), `/watch/:id` (player, immersive), More → Practice "📺 Watch" (tutors: More → Tools).
Lab app: the same paths (`ui/watch/`), with YouTube's player in a WebView.

## YouTube's rules (read before changing the player)

- **Playback is the official YouTube IFrame Player API, embedded** (`youtube-nocookie.com`). We never
  download, proxy, cache or extract YouTube media — that breaks YouTube's terms. Offline, the list and the
  transcripts are readable from the device, and the video says it needs a connection.
- **The player is at least 200 × 200 px and NOTHING is drawn over it** (YouTube API terms): the line card,
  the transcript and every control sit BELOW (phone) or BESIDE (landscape / unfolded) the player.
- The only picture of a video we show outside the player is YouTube's public thumbnail
  (`https://i.ytimg.com/vi/<id>/mqdefault.jpg`, `youtubeThumbnailUrl`).
- Public videos only: the worker checks YouTube's public oEmbed when a video is first added (private or
  embedding-disabled → "This video can't be played outside YouTube").

## Adding a video

Paste a link on `/watch`, or share it from the YouTube app:
- web (installed PWA): `share_target` in `frontend/public/manifest.json` → `/watch/share?text=&url=&title=`
  (`pages/WatchSharePage.tsx` picks the link out of the shared text and opens the player);
- Lab app: an `ACTION_SEND text/plain` intent filter on the main activity → `/watch/share?text=…`.

`parseYouTubeVideoId` (`shared/watch/video.ts`) reads youtube.com/watch?v=, youtu.be/, /shorts/, /embed/,
/live/, /v/, m. / music. hosts, youtube-nocookie.com, attribution links, a bare 11-character id, and a share
text with a link in it. Adding is two steps because the server needs the length: the player opens the video
(it plays at once, no transcript yet), reports `getDuration()` and its title, and the app POSTs
`/api/watch/videos { video_id, duration_ms, title, source }`. A video someone else already added comes back
with its transcript straight away (ONE transcript per video id for everyone).

The list page also has **Find on YouTube** links for his five shows (`WATCH_SHOWS`; 小欢喜 first — the
easiest; 繁花 is mostly in Shanghainese, so the link searches for its 普通话版).

## How the transcript is made (`worker/src/services/watch/`)

On **audio-lesson-queue** (message `{ kind: 'video_transcript', videoId }`), resumable, the row is the
checkpoint (`runWatchTranscriptJob`, `job.ts`):

1. **transcribing** — Gemini reads the public YouTube URL directly (`file_data.file_uri`; Google fetches it,
   we never touch the media). It hears the audio and sees the frames at 1 fps, so it can **copy the
   burned-in Chinese subtitles** these dramas have — the prompt (`watchPrompt`) says to prefer the
   on-screen subtitle text and fall back to the audio. The video is read in **~5-minute windows**
   (`planWatchChunks`, `video_metadata.start_offset` / `end_offset`) at `MEDIA_RESOLUTION_LOW`, temperature
   0, least thinking, JSON lines `{ start, end, zh, speaker? }` with times as "MM:SS.s" from the START OF
   THE WHOLE VIDEO. `parseGeminiWatchLines` accepts seconds or clock strings and, if a model counted from
   the start of the clip instead, shifts them (most lines outside the window but inside its length);
   `checkWatchChunk` rejects times that go backwards or all sit at one moment. Each window's raw lines are
   saved as it finishes and `tidyWatchLines` + automatic pinyin (`pinyinLine`: pinyin-pro + the 一 / 不
   tone changes, the podcasts' helper) rebuild the player's lines — **the player shows them while the rest
   is read** ("Making the transcript… (part 3 of 9)"). A window that fails 3 times is **skipped** (the
   player says "No transcript for 10:00–15:00"; Retry tries it again). Through `geminiGenerateContent` /
   `GEMINI_FLASH_MODELS` like every Gemini call.
   - **Fallback**: if a model refuses the clipping offsets (a 400 naming them → `ClipOffsetsUnsupported`),
     the job reads the whole video in one call (videos up to 60 min; longer ones fail with a readable error).
2. **translating** — the English, 40 lines a call, with the podcasts' translator (`structuredCall`,
   `anthropicSegmentTranslate`) and a TV-drama system prompt (`WATCH_TRANSLATE_SYSTEM`), written after
   every batch. Without a Claude key the transcript is still ready (hanzi + pinyin).
3. **ready** (or **failed** with a readable `error`; **Retry** resumes where it stopped).

`tidyWatchLines` (`shared/watch/transcript.ts`): time order; one subtitle read off several frames merged
into one line; every line gets an end (never past the next line's start; a gap under 1 s is closed so the
line runs on until the next); lines starting at the same moment are spread 0.3 s apart.

E2E_TEST_MODE: `fakeWatchTranscriber` (a self-written family-dinner dialogue, a line every 4 s) and the fake
translator, run inline in `waitUntil` — checked FIRST, no Gemini / Claude call.

### Cost (estimate, per 45-minute episode)

| Step | Tokens | ≈ $ |
|---|---|---|
| Gemini, 9 windows at low resolution (≈ 70 tokens / frame at 1 fps + 32 / s of audio ≈ 100 / s) | ≈ 280k in, ≈ 35k out | 0.21 + 0.13 |
| Claude translation, ≈ 900 lines in 23 batches (Sonnet, $2 / $10 per M) | ≈ 50k in, ≈ 60k out | 0.10 + 0.60 |
| **Total** | | **≈ $1.05**, once per video for everyone |

The translation dominates; asking Gemini for the English in the same call would cost ≈ $0.05 more instead,
if the cost ever matters. Real token counts land in `watch_videos.usage_json` (`cost_usd`) and in
`server.ai_call` (docs/ANALYTICS.md). Cost guard: `POST /api/watch/videos` and `…/retry` are in the
`jobs` group.

### Untested until deployed

Gemini reading a YouTube URL can only be exercised against the real API. Unit tests pin the request we
send (file URI, offsets, low resolution, prompt) and the parsing of the answer; what remains to watch on
the first real episodes: whether the model honours the offsets (else the whole-video fallback kicks in),
whether its times are absolute or relative (both handled), how well low resolution reads the subtitles
(if poorly: `MEDIA_RESOLUTION_MEDIUM` in `transcribe.ts` — ≈ 3–4× the video tokens), and region / age
restrictions on some uploads (Gemini answers 400 → the window fails, then the video).

## The player (`/watch/:id`)

`frontend/src/pages/WatchPlayerPage.tsx` (Lab `ui/watch/WatchPlayerScreen.kt`). Rules in
`shared/watch/lines.ts` (Lab `core/…/watch/Watch.kt`, parity-tested, `android-lab/parity/fixtures/watch.ts`):

- **The line on screen** = the last line starting at or before the time (`lineIndexAt`), except that a line
  the learner jumped to (⏮ 🔁 ⏭, a tap on a transcript row) or paused after stays on screen from its seek
  point to its pause point — and, while paused, 1.5 s longer (`activeLineIndex` with `focus`).
- **Jumps start 0.25 s early** (`lineSeekMs`, `WATCH_LINE_LEAD_MS`): Gemini's times are approximate.
- **Pause after each line** (switch, remembered per device): `lineEndCrossed(prev, now, focus)` — playing
  through a line's pause point (`linePauseMs`: 0.2 s after its end, never into the next line's start)
  pauses the player and holds that line; ▶ continues, 🔁 replays it, ⏭ goes on. A seek never pauses.
- ⏮ / ⏭ = the line before / after the one on screen (`stepLine`); 🔁 = the one on screen again.
- **Speed** 1× → 0.75× → 0.5× (`setPlaybackRate`, remembered per device).
- **Listen first** (switch, remembered): the line card starts covered; each tap uncovers the Chinese, then the
  pinyin, then the English (`nextWatchReveal`, as the podcast player); lines from the one on screen onwards are
  covered in the transcript too.
- **拼 / EN** toggles for the card and the transcript (remembered per device).
- The line card's Chinese is word chips from the device segmenter (`ChatWordsText` over
  `shared/chinese/segment.ts`) → the language explorer (source `watch`). The transcript list highlights the
  line on screen and keeps it in view; a tap on a row seeks there.
- **Resume**: the position is saved locally every few seconds and to the server (`PUT …/position`) when the
  page hides / every 15 s; `resumeAtMs` starts from 0 when it was (nearly) finished.
- While the transcript is being made the video plays as normal and the card says what's happening; lines
  appear as windows finish (polled every 5 s).
- Layout: phone = video on top (16:9, full width), card + controls, transcript; landscape / ≥ 900 px wide =
  video left, the rest right.

Offline: the list and every opened transcript are kept on the device (web: own IndexedDB `watch`; Lab:
JsonCache `watch/…`); the player shows "The video needs a connection" in the player's place and the
transcript stays readable.

**E2E / screenshots**: in a dev build, `window.__watchStandIn = true` (set by the spec before the page loads)
swaps the YouTube player for a stand-in with the same interface (`components/watch/standInPlayer.ts`, a
drawn colour clip with a clock) — no YouTube frame is ever in the repo or the screenshots.

## API (`worker/src/routes/watch.ts`)

- `GET /api/watch` → `{ videos: WatchVideoSummary[], available }` (my videos, most recently opened first)
- `POST /api/watch/videos` `{ url | video_id, duration_ms, title?, source?: paste | share | show }` → 202
  `{ video: WatchVideoDetail, existing }` (200 when ready; 400 bad link / no length / too long / not
  embeddable; 503 no Gemini key)
- `GET /api/watch/videos/:id` → `{ video }` (lines so far, `gaps`)
- `PUT /api/watch/videos/:id/position` `{ position_ms }` → `{ saved }`
- `POST /api/watch/videos/:id/retry` → 202 · `DELETE /api/watch/videos/:id` → `{ removed }` (the shared
  transcript stays)

## Data (migration 0158)

`watch_videos` (id = the YouTube video id; title, channel, duration, status, progress, `chunks_done` /
`chunks_total`, `chunks_json` = the per-window checkpoint, `lines_json` = `WatchLine[]`, provider / model,
`usage_json`, `requested_by`) and `watch_video_users` (user, video, `position_ms`, `last_opened_at`). Account
deletion removes his rows and detaches `requested_by`; transcripts are shared and stay.

## Analytics

`watch.add` (server), `watch.open`, `watch.line { action: prev | replay | next | tap }`, `watch.speed`,
`watch.pause_mode`, `watch.listen_first`, `watch.reveal`, `watch.retry` (server), `server.watch_transcribed`;
the explorer's own `explorer.open` with source `watch`. Ids / counts / enums only — never URLs or text.
