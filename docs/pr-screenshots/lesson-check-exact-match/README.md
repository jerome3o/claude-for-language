# Lesson answer check: exact match = no model call

Phone viewport 412×915 @2×, the "Say it in Chinese" sample from the exercise catalogue.

![Exact match, checked locally](01-exact-match-local.png)

The answer IS the model answer ("✓ Exact match"): the card shows **✓ Correct · Exactly right — nice!** at once — no "Checking your answer…", no call to `/api/lessons/answer-check`, works offline. Got it is ringed; 🔁 Try again and 💬 Ask about this stay.

![Other wording, still checked by Claude](02-other-wording-claude.png)

Other wording (here after 🔁 Try again) is still sent to Claude as before (E2E fake model shown).

![Lab app: exact match](07-lab-exact.png)

Lab app, same rule (core `LessonAnswerCheck.exact`): Jerome's 车站就在我家对面。, no call.
