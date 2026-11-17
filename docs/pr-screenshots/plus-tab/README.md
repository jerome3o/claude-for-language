# ＋ Add tab (and the Claude box on Chats)

Phone viewport 412×915 @2×. Web (light) from `e2e/tests/add-tab.spec.ts` (`ADD_TAB_SHOTS`); the Lab app's
Roborazzi shots are not in this PR (see the note at the end). The photo is a synthetic fixture (`e2e/tests/fixtures/images/subtitle-photo.png`:
plain shapes, no real people).

## Before — the ✦ Claude tab

![Before: the Claude tab (web)](../claude-tab/02-claude-tab-listening.png)
The old tab: a new Claude chat, its title shown twice in the Lab app.

![Before: the Claude tab (Lab, dark)](../claude-tab/lab-claude-thread-12-claude-tab-listening-dark.png)
The Lab app's old tab (dark).

## Web

![The Add tab](01-add-tab.png)
＋ Add: one title, "Add a word" (📷 first and widest; ✏️ · 🎤 · 🗣), then "Ask for new content".

![Photo → word chips](02-photo-chips.png)
📷 → the photo with the line boxes; the subtitle 太体面了 first as word chips, the tab title's 视频通话 below; the English is gone.

![A chip → the explorer](03-photo-explorer.png)
Tap 体面 → the explorer's Word view (the line as its context) → + Add as card.

![Type it](04-type.png)
✏️ Type it: 银行.

![Typed word → the explorer](05-type-explorer.png)
A word he already has: "📚 You have this card" → ⚡ Study it today.

![A content tile's box](06-reader-sheet.png)
📖 Graded reader: one voice-first box + the level.

![Its result](07-reader-result.png)
"✓ Making your reader… Open ›".

![The Chats tab with the Claude box](08-chats-box.png)
The old Claude tab's box — with its chips — is the Chats tab's low bar.

## Lab app

The Lab app's Roborazzi shots (`AddScreenTest`: `add-01…13`, light + dark — the tab, reading, photo words,
English candidates, listening, a typed sentence, the reader / audio boxes, results, the Chats box) could not be
recorded in this session: every local `:app` compile was killed for memory while several builds shared the
machine. The tests themselves run (and pass) in CI's Android Lab Build. Record them with
`./gradlew :app:recordRoborazziDebug --tests '*AddScreenTest*'` (they land in `android-lab/app/screenshots/`).
The Lab screen mirrors the web layout above (same words, same order, `ui/add/AddScreen.kt`).
