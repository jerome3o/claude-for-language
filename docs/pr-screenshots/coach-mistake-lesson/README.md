# 🎯 Mini lesson on this mistake

Phone viewport (412×915, 2×). Web shots come from `e2e/tests/coach-mistake-lesson.spec.ts` (`SHOOT=1`) against the
E2E fake model; Lab shots are the Roborazzi tests in `CoachMistakeLessonScreenshots`.

## Web

![The chip after a correction](web-01-chip-after-correction.png)
The check found a mistake: "🎯 Mini lesson on this mistake" leads the quick actions.

![The lesson card in the conversation](web-02-lesson-card.png)
The lesson is written in the background and lands as a card: ▶ Do it · Save to my mini lessons.

![An exercise in the preview](web-03-exercise-in-preview.png)
The real lesson player, nothing recorded ("Trying it · not saved yet"), with ＋ Save in the top bar.

![The save step](web-04-save-step.png)
At the end: "Save it to your mini lessons?" — the rating saves it with this run as its first completion.

![Saved](web-05-saved.png)
Saved: it comes back when the rating says (Good → 2 weeks), not as a new lesson tomorrow.

## Lab app

![The chip](lab-01-chip.png)
The chip first in the quick-action row.

![Writing](lab-02-writing.png)
"Writing your mini lesson…" — the chat stays usable meanwhile.

![The card](lab-03-card.png)
The lesson card in the conversation.

![An exercise](lab-04-exercise.png)
An exercise in the preview with ＋ Save.

![The save step](lab-05-save-step.png)
The end of the lesson: the rating bar saves it; ↻ Try again / Not now.

![Saved](lab-06-saved.png)
Saved, with when it comes back.
