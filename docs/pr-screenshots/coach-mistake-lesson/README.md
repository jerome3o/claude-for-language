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

The same screens are rendered by the Roborazzi tests in `CoachMistakeLessonScreenshots` (`coach-mistake-01-chip`,
`-02-writing`, `-03-card`, `-04-exercise`, `-05-save-step`, `-06-saved`), which run in CI with the app unit tests. They
couldn't be rendered into PNGs here: this container ran out of memory for the Android build (the Gradle daemon was
killed every time). In the Lab app the 🎯 chip sits on its own row above the quick-action chips.
