# Lab app — video calls, part 1 (list, review, upload queue)

Robolectric + Roborazzi renders (Pixel Fold folded 412dp, 2.625×; one unfolded).

![Calls list](calls-01-list.png)
`/calls` in the tab shell: start a call with a tutor / student or a solo test call; past calls with their state and a LIVE row.

![Offline, no calls](calls-02-list-empty-offline.png)
Offline: starting is disabled and the cached (empty) list says so.

![Review](calls-03-review.png)
`/calls/:id/review` — summary, topics, corrections.

![Review, whole page](calls-04-review-whole.png)
The whole review page: words → "Add 4 cards" with a deck picker, before next time, transcript turns (▶ per line — one playing — 拼音 / EN), whiteboard snapshot, chat, Transcribe again.

![Processing, tutor](calls-05-review-processing-homework.png)
Still transcribing, 3 recording parts still uploading from this phone; the tutor's Make-homework button waits until the transcript is ready.

![Homework job running](calls-06-review-homework-running.png)
The tutor's homework job from the lesson, with live progress (the session-notes job card).

![Cards added, dark](calls-07-cards-added.png)
After "Add N cards" (dark theme).

![Unfolded](calls-08-review-unfolded.png)
The unfolded Fold: centred 720dp column.
