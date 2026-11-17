# ＋ Add — one place to add a word or ask for new content

The learner's tab bar is **Study · Chats · ＋ Add · Progress · More** (Nov 2026). Jerome, on the ✦ Claude tab
it replaces: "I don't really use this page. So what I think we should have here instead is a big plus screen
that allows you to add new things … a landing page where it's super easy to add a new card, super easy to ask
for new content." The Claude box that tab had now lives on the Chats tab (docs/CHAT.md "The Claude tab → ＋ Add").

- Web: `/add` — `frontend/src/pages/AddPage.tsx` (+ `AddPage.css`), API client `frontend/src/api/add.ts`.
- Lab: `/add` — `ui/add/AddNav.kt`, `AddScreen.kt`, `AddViewModel.kt`; `data/add/DeviceOcr.kt`; `data/api/AddApi.kt`.
- Rules: `shared/add/add.ts`, Lab core `core/…/add/AddTab.kt` (parity-tested, `parity/fixtures/add-tab.ts`).
- Worker: `routes/add-words.ts`, `services/add-words.ts`, `services/lesson-requests.ts` (migration 0152).
- Only the learner tab set has it; tutor accounts and accounts with students keep their tabs (a ＋ for them is a
  possible follow-up).

## Layout

ONE title ("Add"), then:

1. **Add a word** (a card): **📷 Photo** (the widest button, first), **✏️ Type it**, **🎤 Say it** (Chinese),
   **🗣 In English**, and a small "🖼 Or pick a photo you already took".
2. What he asked for: "✓ Making your reader… Open ›" rows (kept for the tab session — web sessionStorage, Lab the
   ViewModel), so coming back from the reader shows them.
3. **Ask for new content**: a tile per thing — 📖 Graded reader · 🎯 Mini lesson · 🎧 Audio lesson · 🎬 Clips ·
   🖼 Picture hunt · 🃏 Deck of cards · ✦ Just ask Claude.

## Photo → words (speed is the feature)

Jerome photographed his laptop during a video lesson (a subtitle 太体面了 between two faces, browser chrome around
it): "I would love to have taken a picture really quickly, had the sentence appear immediately, and then just like
select the word … super easy to add new words".

- **📷 is one tap to the camera** (web `<input type=file accept=image/* capture=environment>` clicked directly; Lab
  `TakePicture` into ONE overwritten cache file). No intermediate sheet, no crop step.
- The photo shows at once with a scanning shimmer and skeleton lines ("Reading the Chinese…").
- **Lab: on the phone first** — ML Kit's Chinese text recognizer, the *unbundled* one
  (`play-services-mlkit-text-recognition-chinese`): its model comes from Google Play services (downloaded at
  install via the manifest's `com.google.mlkit.vision.DEPENDENCIES = ocr_chinese`), so the APK only grows by the
  small client, results come in a few hundred ms and work offline. The bundled model would add several MB per ABI —
  not worth it on a Pixel that has Play services. When the recognizer isn't there (no Play services / model not yet
  downloaded) or finds no Chinese, the server reads it.
- **Web / fallback: `POST /api/ocr/words`** — the photo resized on the device to **1280 px, JPEG 0.82** (`OCR_MAX_EDGE`,
  ~150–300 KB), raw body or multipart `picture`, ≤ 4 MB (413), JPEG / PNG / WebP sniffed from the bytes (415).
  ONE Gemini Flash vision call through `geminiGenerateContent` (the model list, least thinking, JSON out): every
  line of Chinese with its box on a 0–1000 grid and a `main` guess ("the line the photo is about"). ~1k input
  tokens + ~100 out ≈ **$0.001 a photo**. The photo is read once and **never stored**. Cost guard `ai`.
  E2E_TEST_MODE answers with a stand-in first (`fakeOcrLines`, the same scene as the fixture
  `e2e/tests/fixtures/images/subtitle-photo.png`).
- **Busy photos** (`orderOcrLines`): each line is cut to its Chinese (`ocrChineseText`: Han characters, Chinese
  punctuation, digits — English words, tab titles and UI labels dropped), lines without Chinese go, duplicates go,
  then **the big central line first** (`ocrLineScore`: the reader's `main` guess, then height × 4 + closeness to the
  centre + a little for length), at most 12. The same order for the server's lines and ML Kit's.
- The lines show as **word chips** from the device segmenter (`shared/chinese/segment.ts`), the first line bigger.
  The photo is shown above with the line boxes outlined; tapping a box brings its line to the top.
- **Tap a word → the language explorer** (Word view, or the Character view for one character; source `add`, the
  line as the word's sentence) → **+ Add as card** (the "From the explorer" source deck) / **⚡ Study it today**
  (a word he has: "📚 You have this card", never a duplicate).
- **✂ Pick** on a line: the segmenter cut it wrong — tap the first character, then the last → "Look up 体面 ›".
- Offline on the web: "Reading a photo needs a connection — it will be read as soon as you're back online" (the
  photo is kept in memory and read when the connection is back). Offline on the Lab app: the phone reads it.

## Type it / say it

The voice-first box (web `useVoiceDictation` + `VoiceTextInputView`, Lab `rememberVoiceDictation` +
`VoiceTextFieldContent`); 🎤 / 🗣 start listening at once (the button he tapped *was* "say it"), ✏️ opens typing.
- **Chinese** (`classifyWordInput`: any Han character) → a word (≤ 4 characters) opens the explorer; a sentence
  becomes a line of word chips to pick from.
- **English or pinyin** → `POST /api/ai/english-words { text }` (≤ 120 characters) → up to 4 Chinese words, most
  common first (`{ hanzi, pinyin, english, note? }`; a small structured call, thinking off; 一 / 不 tone changes
  applied; slashes / brackets refused). A row opens the explorer. Cost guard `ai` (`/api/ai/*`). E2E stand-in.

## Ask for new content

Each tile opens ONE voice-first box ("What should the story be about?", 2+ characters) with minimal options, and
creates the thing through the path that already makes it, in his own account:

| Tile | Options | Creates with | Open › |
|---|---|---|---|
| 📖 Graded reader | Beginner · Elementary · Intermediate | `POST /api/readers/generate` (topic, all his decks) | `/readers/:id` |
| 🎯 Mini lesson | — | `POST /api/custom-lessons/generate { prompt }` → a `lesson_requests` row, written on coach-reply-queue by the library's lesson writer (`generateLessonSpec`) into his Mini Lessons (`createCustomLessonFromSpec`); `GET /api/custom-lessons/requests/:id` (polled every 3 s) | `/lessons/:id/play` (until ready: `/lessons`) |
| 🎧 Audio lesson | Dialogue · Sleep · Story | `POST /api/audio-lessons` (`description` / `text`) | `/audio-lessons/:id` |
| 🎬 Clips | — | `POST /api/clips/generate { topic, count: 1 }` | `/clips/:id` |
| 🖼 Picture hunt | — | `POST /api/picture-hunts { prompt }` | `/picture-hunt/:id` |
| 🃏 Deck of cards | — | `POST /api/ai/generate-deck` (waits; "Claude is writing the cards…") | `/decks/:id` |
| ✦ Just ask Claude | — | a general Claude thread (`startClaudeThread`) | opens the thread at once |

`/api/custom-lessons/generate` is in the cost guard's `jobs` group. Every tile needs a connection (it says so).
"Open ›" navigates with `state.from = '/add'`, so back returns to the tab.

## Analytics

`add.open`, `add.word_input { method: photo | type | say_zh | say_en, kind: chinese | other }`,
`add.word_added { via: card | bump }` (the explorer opened from the tab), `add.content_request { kind, format?, ok,
spoken }`, `ocr.words { found_count, via: server | device, ms, ok }`. `claude.tab_open` → `replacedBy: 'add.open'`.
