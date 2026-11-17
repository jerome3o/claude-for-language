# Tool lines you can tap + flow audit

Phone viewport 412×915 @2×. Web (light) from `e2e/tests/claude-result-links.spec.ts` against the real worker and its E2E stand-in model.

## Web

![The study card's Ask Claude sheet: "🎓 Mini lesson made: 治理 vs 这里：听力辨音 · Start ›" is one tap target](web-01-sheet-line.png)

The study card's Ask Claude sheet: the "Mini lesson made" line is now a button ending in **Start ›** (it no longer says "it's on your Mini Lessons page").

![The lesson opened from the line, in the player](web-02-lesson.png)

One tap opens the lesson in the player (`/lessons/:id/play?from=claude`).

![Back from the lesson: the same study card, its sheet open on the same thread](web-03-back-in-sheet.png)

✕ in the player goes back to the same study card with its Ask Claude sheet open on the same thread.

![The same thread as a page (Chats tab): the line is a link there too; back from the lesson lands here](web-04-back-in-thread.png)

The same thread as a page from the Chats tab. The line is a link there too, and back from the lesson lands on this thread at the same scroll position.

![Audit: Home's "⚡ 2 bumped for today ›" is now tappable](web-05-home-bumped-line.png)

Audit fix: Home's "⚡ 2 bumped for today ›" line is now tappable.

![…and opens Up next, whose ⚡ Today list shows the bumped words](web-06-up-next-from-home.png)

It opens Up next, where the ⚡ Today list shows the bumped words.

![Audit: a lesson that isn't on the device and isn't on the server — the player says so instead of an empty screen](web-07-lesson-gone.png)

Audit fix: the player first fetches a lesson that isn't on the device. When the lesson is gone, the player says so instead of showing an empty screen.

## Lab app

Roborazzi, `ui/claude/ResultLinksTest.kt`. That test also checks that a tap opens the lesson's path and that the nav back stack brings the card's sheet back open.

![Lab, dark: the card's Ask Claude sheet with "🎓 Mini lesson made: 治理 vs 这里：听力辨音 · Start ›"](lab-02-lesson-line-dark.png)

Lab, dark: the "🎓 Mini lesson made" line is one tap target ending in **Start ›**.

![Lab, dark: "✓ Claude edited this card" keeps Undo and gains "Open card ›"](lab-03-edit-line-dark.png)

Lab, dark: "✓ Claude edited this card" keeps Undo and gains an **Open card ›** pill.

![Lab, light: the same lesson line](lab-01-lesson-line-light.png)

Lab, light: the same lesson line.
