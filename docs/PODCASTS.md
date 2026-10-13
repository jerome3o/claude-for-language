# Podcasts 🎙

Listen to real Chinese podcasts a sentence at a time. Subscribe to a podcast by its RSS feed,
browse its episodes, tap **✨ Transcribe** on one, and the episode comes back cut into segments
of about 3–15 seconds — each with its Chinese, pinyin and English. Listen first, then check
yourself: ▶ plays one segment and stops; a tap on the segment uncovers the Chinese, then the
pinyin, then the English. Words go to your decks in two taps, and a stretch of an episode can
become a mini lesson.

**Lab app only for now** (More → Practice → 🎙 Podcasts). The web app has no podcast screens
yet — `android-lab/PARITY.md` row "Podcasts". The API below is shared, so a web version only
needs screens.

Not to be confused with the *podcast feed of audio lessons* (docs/AUDIO_LESSONS.md "Podcast
feed", `routes/podcast.ts`), which publishes a learner's own audio lessons as RSS.

## What the learner sees (Lab)

- **/podcasts** — My episodes (everything transcribed or asked for, with its status), Subscriptions,
  **Add a podcast** (an RSS link, an Apple Podcasts link or the show's web page), and **Suggested**
  learner podcasts (`services/podcasts/suggested.ts` — public feeds checked to fetch and parse).
- **/podcasts/feed?url=** — the podcast's cover, Subscribe / ✓ Subscribed, and every episode with
  its date, length and size; **✨ Transcribe** (or 🎧 Listen once it is), a progress bar while it is
  being made. Episodes over 150 minutes can't be transcribed.
- **/podcasts/episodes/:id** — the segment player (immersive):
  - each segment card: number, time, speaker (when the transcript has several), ▶ (just that
    segment, then silence to think), and the body that a tap uncovers step by step: covered →
    Chinese (word chips from the on-device segmenter → the language explorer, with + Add as card /
    ⚡ Study it today) → + pinyin (per word) → + English ("Translation coming…" while translating);
    a tap on a fully open one covers it again;
  - the current segment has **↻ Again** and **➕ Words (N)** — the Coach's new-words picker
    (`CoachNewWordsSheet`): the segment's words that are in none of his decks, nothing ticked,
    meanings filled in (gloss-words), saved with enrich-words + one batch call (`skip_existing`, a
    word already in a deck offers ⚡ Study it today);
  - the bar: a timeline (tap / drag = go to the segment there), ⏮ ↻ ▶/⏸ ⏭, **🐢 0.75×** (pitch
    kept), **▶▶ Keep playing** (no stop after each segment; the list follows the audio), and
    **👁** — what untapped segments show (Listen first / Chinese / + pinyin / Everything);
  - ⋯: 🎓 Make a mini lesson from the segment on screen, 🗑 Delete the audio from this phone,
    Remove from My episodes.
  - Offline: the transcript is cached once opened (`podcasts/episode/<id>` in the JSON cache, and
    the sync caches every listenable episode in My episodes); the audio is downloaded when the
    episode is opened (the size shows first) and kept under `files/podcasts/` until deleted.
  - Remembered per device: the segment each episode was at, the reveal mode, 0.75×, Keep playing.

## How an episode is transcribed (worker)

`POST /api/podcasts/episodes { feed_url, guid }` finds the episode in the feed **as the server read
it** (never trusting a client's enclosure URL — the transcript is shared) and starts a job on
**audio-lesson-queue** (`{ kind: 'podcast_episode', episodeId }`; no new queue). One row per
episode in `podcast_episodes`, id = hash of feed URL + guid, **shared by every account**: a second
person asking gets the same transcript at once. `services/podcasts/job.ts`, resumable stages
(the row is the checkpoint; each delivery does what is left and re-enqueues itself):

1. **downloading** — the enclosure streamed into R2 `podcast-episodes/<id>.<ext>` with a multipart
   upload (8 MiB parts, never held in memory), through the safe fetcher (below), at most 200 MB.
   The app plays THIS copy, so the segments' times match it (hosts insert different ads per
   download).
2. **transcribing** — a Soniox async transcription (the same `stt-async-v5` model the calls and
   takes use; zh + en hints, language identification, speaker diarization) of a **signed link** to
   that copy: `GET /api/podcast-source/:id?exp=&sig=` (HMAC over id + expiry with a key derived from
   `SESSION_SECRET`, 6 h, mounted before the auth middleware; `services/podcasts/source-url.ts`).
   Polled every 20 s (each poll touches the row), given up after an hour. The permanent Soniox key
   never leaves the worker.
3. **translating** — the timed tokens cut into segments (`services/podcasts/segments.ts`: a sentence
   end once ≥ 3 s, a pause ≥ 0.55 s once ≥ 3 s, any pause ≥ 1.2 s, a change of speaker, a comma past
   12 s, never over 20 s; scraps under 1.2 s join the segment before), each with the app's automatic
   pinyin (pinyin-pro + the 一 / 不 rule — `applyYiBuToneChanges`), then the English 40 segments a
   call (`structuredCall`, forced tool, thinking off — the story lessons' translation model;
   `services/podcasts/translate.ts`), written after every batch. Segments are served while
   translating, so listening can start before the English is done. Without a Claude key the
   transcript is finished with hanzi + pinyin only.

A stage that fails is retried (60 s × attempt) up to 3 times, then `failed` with a readable error;
**Retry** (`POST …/retry`, also the feed's ↻ Try again) restarts the failed stage. A job that went
quiet for 20 minutes (a lost message) is nudged again when anyone looks at it. Too big / not audio /
no speech fail at once.

**E2E_TEST_MODE / no key**: with `E2E_TEST_MODE=true` the job runs inline without any service —
30 s of generated silence and six canned Chinese lines (`FAKE_LINES`), fake translations. Without
`SONIOX_API_KEY` (and not in test mode) `transcription_available` is false: the app says so and the
Transcribe buttons are off (`POST /api/podcasts/episodes` → 503).

### Feeds and safety

`services/podcasts/rss.ts`: `safeFetch` follows redirects by hand (≤ 5) and checks EVERY hop with
the link-preview rules (`safePreviewUrl`: public http(s) only — no credentials, odd ports, IP
literals in private / loopback / link-local ranges, `.local` / `.internal` hosts); 10 s for a feed,
at most 8 MB. A tolerant RSS 2.0 + iTunes (and Atom) reader: CDATA, entities, durations as
`1:02:03` / `62:03` / seconds, relative enclosure links, non-audio enclosures skipped, at most 300
episodes. An Apple Podcasts link is resolved with Apple's public lookup API; a web page's announced
feed (`<link rel="alternate" type="application/rss+xml">`) is followed once. Parsed feeds are cached
for everyone in `podcast_feed_cache` for 30 minutes (a failed refetch serves the old copy, `stale`).

### Mini lesson from an episode

`POST /api/podcasts/episodes/:id/lesson { from }` (ready episodes) queues
`{ kind: 'podcast_lesson', episodeId, userId }` on audio-lesson-queue: the audio lessons'
companion-lesson writer (`generateCompanionSpec` — same prompt, validation, repair rounds, 一 / 不
rule) fed the next 60 Chinese segments from `from` as a "story" podcast (`services/podcasts/lesson.ts`).
The lesson is created in the learner's **own** account, unlocked, source `podcast`, and shows in
Mini Lessons; it is never sent to anyone. Its state is on `podcast_episode_users`
(`lesson_status` generating / ready / failed, `lesson_id`, `lesson_error`).

## Data (migration 0125)

- `podcast_subscriptions` — user + feed URL (unique), title, author, image, description.
- `podcast_feed_cache` — the parsed feed JSON per feed URL, shared.
- `podcast_episodes` — the shared transcription (status, progress, error, attempts, `audio_key` /
  bytes / mime, duration, `stt_job_id`, `api_origin`, `segments_json`, `usage_json`, `requested_by`).
- `podcast_episode_users` — who asked for / opened which episode ("My episodes") + the lesson state.

Account deletion removes the user's subscriptions and episode links and detaches `requested_by`;
the shared transcripts stay. R2 `podcast-episodes/` is registered in `STORAGE_PREFIXES`
(collectable: an unreferenced, old copy is re-downloadable).

## API

Signed in (`routes/podcasts.ts`):

| | |
|---|---|
| `GET /api/podcasts` | `{ subscriptions, suggested (+ subscribed), episodes (mine, no segments), transcription_available }` |
| `POST /api/podcasts/subscriptions` | `{ url }` → 201 `{ subscription, feed }` (400 not a feed / not public, 404, 502) |
| `DELETE /api/podcasts/subscriptions/:id` | `{ deleted }` |
| `GET /api/podcasts/feed?url=&refresh=1` | `{ podcast, episodes: [{ id, guid, title, published_at, duration_s, enclosure_bytes, image_url, description, transcript }], subscription_id, fetched_at, stale, transcription_available, max_minutes }` |
| `POST /api/podcasts/episodes` | `{ feed_url, guid }` → 202 `{ episode }` (200 + `existing` when ready; a failed one is retried) |
| `GET /api/podcasts/episodes/:id` | `{ episode }` with `segments: [{ i, start_ms, end_ms, text, speaker, lang, pinyin, english }]` while translating / ready, `lesson` |
| `GET /api/podcasts/episodes/:id/audio` | the R2 copy (Range → 206) |
| `POST /api/podcasts/episodes/:id/retry` | a failed one, from its stage → 202 |
| `POST /api/podcasts/episodes/:id/lesson` | `{ from? }` → 202 `{ lesson }` (409 not ready, 503 no key) |
| `DELETE /api/podcasts/episodes/:id` | off My episodes (`{ removed }`) |

Public: `GET|HEAD /api/podcast-source/:id?exp=&sig=` (the transcription service's audio link).

Every failure is JSON `{ error }` with a sentence the app shows as is — a fault on the server too
(the router's `onError`: 500 "Something went wrong on the server…"), never Hono's bare text page.
`podcast_episode_users` references `podcast_episodes`, so a new episode's row is inserted before
the asker's link (the first real Transcribe, 13 Oct 2026, failed on that foreign key).

## Analytics

`podcast.subscribe`, `podcast.transcribe`, `podcast.lesson_created`, `server.podcast_transcribed`
(server); `podcast.open`, `podcast.download`, `podcast.segment_play`, `podcast.reveal`,
`podcast.add_card`, `podcast.make_lesson`, `podcast.unsubscribe` (Lab). Ids / enums / counts only.

## Not yet

- The web app (screens over the same API).
- Background playback with the screen off (the audio lessons' media session service) — the player
  plays while it is on screen.
- Homework from an episode for a tutor (send a mini lesson / the episode as link homework).
- MCP tools.
