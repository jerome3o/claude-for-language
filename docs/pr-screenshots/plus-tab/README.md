# ＋ Add tab (and the Claude box on Chats)

Phone viewport 412×915 @2×. Web (light) from `e2e/tests/add-tab.spec.ts` (`ADD_TAB_SHOTS`); Lab app (dark + light)
from Roborazzi (`AddScreenTest`). The photo is a synthetic fixture (`e2e/tests/fixtures/images/subtitle-photo.png`:
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

![Lab: Add tab (light)](lab-add-01-tab.png)
![Lab: Add tab (dark)](lab-add-02-tab-dark.png)
![Lab: reading the photo](lab-add-03-photo-reading-dark.png)
Reading: the photo at once, skeleton lines.

![Lab: photo → word chips (dark)](lab-add-04-photo-words-dark.png)
![Lab: photo → word chips (light)](lab-add-05-photo-words.png)
![Lab: in English → candidates](lab-add-06-say-english-candidates-dark.png)
🗣 In English → the Chinese words that say it.

![Lab: listening](lab-add-07-say-listening-dark.png)
![Lab: a typed sentence → its words](lab-add-08-typed-sentence-dark.png)
![Lab: the reader tile's box](lab-add-09-reader-sheet-dark.png)
![Lab: the audio tile's box](lab-add-10-audio-sheet-dark.png)
![Lab: results](lab-add-11-results-dark.png)
"✓ Making your reader… Open ›", "✓ Your mini lesson is ready Open ›".

![Lab: Chats with the Claude box (dark)](lab-add-12-chats-claude-box-dark.png)
![Lab: Chats with the Claude box (light)](lab-add-13-chats-claude-box.png)
The chips over the box, the list above it.
