# Lab app — package D: Progress tab + Settings

Robolectric/Roborazzi renders (Pixel Fold folded 412dp; unfolded 841dp), realistic data.

## Progress

![Progress tab](progress-01-tab.png)
Progress tab: 🔥 streak + 30-day heatmap, cards mastered ring, 30-day summary, reviews-a-day chart (right vs again/hard).

![Dark](progress-02-tab-dark.png)
Same in dark mode.

![Bar selected](progress-03-bar-selected.png)
A tapped bar: the day, its reviews, › opens the day.

![Empty](progress-04-empty.png)
No reviews yet.

![Unfolded](progress-05-unfolded.png)
Unfolded: streak and mastery side by side, four summary tiles in a row.

![Day](progress-06-day.png)
A day: cards reviewed, most difficult first, last five ratings.

![Card on a day](progress-07-card-day.png)
One card on that day: each review with time, rating, duration, typed answer ✓/✗, recording.

![Session review](progress-08-session-review.png)
Session review (`/study/review/:id`).

## Settings

![Settings](settings-01-main.png)
Settings: bio, offline audio, offline mode, backup…

![Budget + offline](settings-03-offline-error.png)
Forced offline, backup needs a connection, the study budget steppers with a server validation error.

![Advanced](settings-02-advanced.png)
Advanced: audio quality, sentence coverage link, feature requests.

![Tutor account](settings-04-tutor.png)
A tutor-only account: no bio / budget / offline audio; Start on includes Students.

![Feature request](settings-06-feature-request.png)
A feature request with comments and the comment box (shown in a bottom sheet).

![Sentence coverage](settings-07-sentence-coverage.png)
Sentence coverage: bars, facts, job chips, actions.

![Sentence coverage offline](settings-08-sentence-coverage-offline.png)
Sentence coverage offline with nothing cached.

![Duplicates](settings-09-duplicates.png)
Duplicate finder: ★ Keep = most reviewed; one delete in flight.

![No duplicates](settings-10-duplicates-none.png)
No duplicates.

![Unfolded settings](settings-11-unfolded.png)
Settings unfolded.
