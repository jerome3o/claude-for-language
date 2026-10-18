# 梗 Meme review (PROTOTYPE)

Jerome (Oct 2026): "a meme review — a job/agent that researches Chinese internet/cultural trends over
the last month or two and does a 'month in review' … with images and video embedded, or links out to
the videos." He is an intermediate learner, a late millennial / early Gen Z, a bit online; his library
already has readers like "Z世代 2 · 发疯文学和绷住" — the meme review is that, but CURRENT and with
real sources.

A **tracer bullet**: built as its own module so it adds no risk elsewhere, to be integrated later if
it finds product-market fit. More → Practice → **🌀 梗 Meme review · prototype** (tutors: More → Tools),
web `/meme-review`, `/meme-review/:month`; the Lab app has the same paths.

## What an issue is

ONE issue per calendar month, shared by every account (no user ids in the content): D1 `meme_issues`
(migration 0130), keyed by `YYYY-MM`. Shape: `shared/meme-review/types.ts` (`MemeIssue`).

| Part | What it holds |
| --- | --- |
| Head | Chinese title + English title, the weeks it covers (~8 weeks before it was written), an intro in simple Chinese (🔊, word chips → the language explorer, EN on demand) |
| 6–10 memes | hanzi (one clean form, Latin allowed: City不City, i人) · pinyin · gist · what it means in simple Chinese (2–4 sentences, + English) · origin (where / when / who, confidence high / medium — low is dropped) · 2–3 chat / comment-style examples (🔊) · register (who, tone, online / spoken, ⚠ crude) · "Would you say it?" for a ~30-year-old foreigner (fine / cute / cringe / avoid + why) · older memes it riffs on · 1–3 sources + 0–3 original videos / posts · our own picture |
| Quiz | 3–5 multiple-choice questions — practice only (one analytics event, no review events) |

**Media is linked out, never embedded or re-hosted.** "▶ Watch on Bilibili" / "↗ Open on Weibo" open the
browser; the only third-party image shown is a YouTube video's public `img.youtube.com` thumbnail (online
only, hidden when it fails). Each meme's picture is OUR illustration (Gemini, `GEMINI_IMAGE_MODELS`) drawn
from the agent's `illustration_prompt` — no real people's likeness, no logos, no text — stored in R2
`meme-review/images/<month>/` (public generated content, registered in `STORAGE_PREFIXES`, collectable when
no issue refers to it).

## The research agent (`worker/src/services/meme-review/agent.ts`)

Claude (`OPUS_MODEL`, effort high, adaptive thinking, `tool_choice` auto, server-side refusal fallback
`fallbacks: "default"` — dropped automatically if the API refuses the parameter) with Anthropic's
**server-side web search + web fetch** (`web_search_20260209` / `web_fetch_20260209`, dynamic filtering)
and one client tool, `submit_issue`. The prompt (`MEME_SYSTEM`): search mostly in Chinese (buzzword
round-ups, 百度百科 / 萌娘百科 / 小鸡词典, Zhihu / Weibo / Bilibili / Douyin / Xiaohongshu, What's on Weibo,
Sixth Tone…), check a meme is genuinely current, prefer memes a learner would meet; skip politically
sensitive, sexual, hateful content and anything about a private person; label crude ones; be honest about
uncertain origins. Earlier issues' memes are listed so a new issue doesn't repeat them.

**Bounded**: ≤ 25 web searches and ≤ 10 fetches (counted from the API's own `usage.server_tool_use`; each
request's `max_uses` is what is left, at least 1 — so at most one more per repair round), ≤ 14 model calls,
≤ 3 `submit_issue` tries (the first + two repairs). A `pause_turn` (the server's tool loop paused) is
resumed by calling again with the paused turn as is. A turn that ends without `submit_issue` gets one nudge.

**The validator** (`shared/meme-review/validate.ts`, pure, tested) refuses or drops:
- every URL (sources, media) must be one the tools RETURNED — `urlsFromToolResults` collects `url` fields
  and URLs inside any `*_tool_result` block (search results, fetched pages, the code-execution output of
  dynamic filtering) and text citations; what the model typed itself never counts. Compared with `urlKey`
  (scheme, `www.` / `m.`, trailing slash, fragment, tracking params ignored). An item with no surviving
  source is dropped;
- low-confidence origins, a headword that breaks the card standard, items without a meaning or examples,
  duplicates; more than 10 → the first 10;
- **pinyin is re-derived** by the app (`pinyinLine`: pinyin-pro + `applyYiBuToneChanges`), never the
  model's: the model's line is kept only when its letters and tones are exactly the derived ones (it then
  lends its word spacing), or when it differs only by a neutral tone on a typically neutral syllable
  (搭子 "dāzi" vs pinyin-pro "dā zǐ"; `rederivePinyin`);
- platform, video / post and the YouTube thumbnail are worked out from the URL, never taken from the model.

Fewer than 6 usable memes, no title / intro, or fewer than 3 quiz questions → `problems` back to the agent
(with the notes on what was dropped and why) for a repair round.

## The job (`services/meme-review/job.ts`, queue `meme-review-queue`)

`requestMemeIssue(month, { via, regenerate? })` writes the row `generating` and queues `{ month }`. A
delivery runs two resumable phases — **research** (the agent; its whole state, transcript included, is
checkpointed in R2 `meme-review/agent/<month>.json` after every model turn and batch of tool results —
search results are too big for a D1 row) and **illustrate** (one picture per meme, the issue saved after
each). After ~6 minutes a delivery checkpoints and re-enqueues itself; at most 10 deliveries. The row keeps
`progress`, rounds, searches, fetches, tokens, pictures and an estimated `cost_usd`. A row not touched for
30 minutes reads as failed. E2E_TEST_MODE / no `ANTHROPIC_API_KEY`: `services/meme-review/fake.ts` stands in
for the model (one "search" + a `pause_turn`, then the SAMPLE submission from `shared/meme-review/sample.ts`,
which carries one invented URL the validator drops) and the job runs inline.

**Who starts one**: the cron (`scheduled()`, the daily 03:17 UTC run: on the 1st–2nd of a month, the
month's issue if it has no row — `ensureMonthlyMemeIssue`), an admin (`POST /api/meme-review/generate`,
"Generate now (admin)" on the list, MCP `generate_meme_review`). A ready month is kept unless `regenerate`.

## Make a mini lesson from this issue (`services/meme-review/lesson.ts`)

Reuses the app's lesson writer (the companion / mistake lessons' path: `LESSON_WRITER_MODEL`, forced tool,
thinking off, `validateLessonSpec` + two repair rounds, the 一 / 不 tone changes) and creates a NORMAL custom
lesson in the CALLER's own account through `createCustomLessonFromSpec` (pinyin checker, pictures, audio).
It is never sent to anyone. One `meme_review_lessons` job row per request (user id → in account deletion's
`DELETE_STEPS`), run on `meme-review-queue` (`{ kind: 'lesson', jobId }`); the page polls it and then offers
"▶ Open the lesson" (`/lessons/:id/play`). Rate-limited by the cost guard's `jobs` group.

## API

- `GET /api/meme-review` → `{ issues: MemeIssueSummary[], current_month, can_generate }`
- `GET /api/meme-review/:month` → `{ issue: MemeIssueRecord, lesson: MemeLessonJob | null, stats? }` (stats: admins)
- `POST /api/meme-review/generate { month?, regenerate? }` — admin only → 202 `{ issue, started }` (200 when kept; 400 for a future month)
- `POST /api/meme-review/:month/lesson` → 202 `{ job }` (409 when the issue isn't ready) · `GET /api/meme-review/lessons/:jobId` → `{ job }` (own jobs only)

MCP (`mcp-server/src/tools/meme-review.ts`): `get_meme_review { month? }` (read only; newest ready issue by
default, picture keys left out) and `generate_meme_review { month?, regenerate? }` (admin).

## Apps

Web `pages/MemeReviewPage.tsx` (list; admin Generate now; polls while one is being researched) and
`pages/MemeIssuePage.tsx` (issue: one meme expanded at a time, 🔊 practice TTS, EN toggles, ExplorableText
word chips, links out, + Add as card via `AddChunkModal` with `memeCardFields` / ⚡ when it's already a card,
quiz, lesson). Offline: an opened issue lives in its OWN IndexedDB database `meme-review`
(`services/memeReview.ts`; issues, the list, pictures as blobs) — ChineseLearningDB and the study sync are
untouched; every 🔊 line is prefetched through practice TTS. Lab: `core/…/memereview/MemeReview.kt` (shape +
labels / card fields / ▶ lines, parity-tested by `parity/fixtures/meme-review.ts`), `data/memereview/`
(JsonCache + LessonMedia pictures), `ui/memereview/` (same screens, haptics + sounds on the quiz).

Analytics: `meme_review.open` (source, cached, items), `.item_open` (item, position), `.link_out` (link,
kind, platform), `.add_card` (item), `.quiz_finish` (correct, total), `.make_lesson` (status); server
`.generate` (via, regenerate), `.ready` (items, searches, images), `.lesson_ready`. Token use is recorded
per call by the AI-usage wrapper (non-streaming calls, so the wrapper sees the usage).

## Cost per issue (estimate)

Opus 5.5 at $4 / $20 per M tokens (cache reads $0.20): ~400k input tokens over ~6–14 calls (most of it
cached conversation) + ~30–40k output incl. thinking ≈ $0.8–1.6; 25 searches × $0.01 = $0.25; 8 pictures ×
~$0.04–0.07 ≈ $0.5. **≈ $1.5–2.5 an issue, ~$25 a year.** The row's `cost_usd` (the admin stats line on the
issue page) shows the real figure; MCP `ai_usage` has the per-call tokens.
A mini lesson ≈ $0.05–0.15 (Sonnet).

## If it finds product-market fit

- Weekly issues, or "this week's 梗" as a Home card; push / e-mail when a new issue is out.
- Per-learner levels (graded meaning lines from his known words, like the audio-lesson author's
  `check_known_words`), and a "memes you've met" list.
- A reader version (the issue as a graded reader with word chips) and an audio-lesson version for the train.
- A tutor view: send an issue (or its lesson) as homework through the homework model.
- Better sourcing: a curated domain allow-list, fetching the original post for exact quotes, and an
  editor pass (a second model checking origins) before publishing.
