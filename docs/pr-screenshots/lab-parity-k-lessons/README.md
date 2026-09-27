# Lab app: real lesson player everywhere + lesson attempt review

Roborazzi renders of the native Lab app (Pixel Fold folded, 412×915dp; one unfolded shot).

## Homework pass: lesson / reader items play natively

![Pass lesson](homework-07-pass-lesson.png)
A one-off lesson in the homework pass runs in the Lab's own lesson player (Homework context).

![Pass lesson rating](homework-12-pass-lesson-rating.png)
Finished: the same FSRS rating bar as in a session; rating records completion + attempt + recordings + the homework `done`.

![Pass lesson done](homework-15-pass-lesson-done.png)
An item already complete opens as done.

![Pass lesson missing](homework-13-pass-lesson-missing.png)
The lesson hasn't synced to this phone yet.

![Pass reader](homework-14-pass-reader.png)
A reader item plays in the session's reader view (rated on its last page).

## Try it / catalogue trial / editor Preview: the real player, nothing recorded

![Try it](k-lessons-01-try-it.png)
`/library/:id/try` — the real player in Preview mode.

![Try it finished](k-lessons-02-try-it-finished.png)
End of a preview: Try again / Done instead of a rating.

![Catalogue trial](editor-11-catalogue-trial.png)
A catalogue sample lesson (conversation) in the same player.

![Try it problems](k-lessons-03-try-it-problems.png)
A spec that can't be decoded lists its validation problems instead of crashing.

![Editor preview](k-lessons-04-editor-preview.png)
The lesson editor's Preview tab: the real player with ‹ › / restart / jump list.

![Editor preview incomplete](k-lessons-05-editor-preview-incomplete.png)
A half-typed exercise says so (with Skip) instead of rendering.

## Tutor: a student's lesson answers

![Tutor attempts](k-lessons-06-tutor-attempts.png)
`/connections/:relId/lesson-attempts` — the student's attempts.

![Tutor attempts empty](k-lessons-07-tutor-attempts-empty.png)
Nothing recorded yet.

![Tutor answer strokes](k-lessons-08-tutor-answer-strokes.png)
One attempt: handwriting re-drawn stroke by stroke over the model outline (first try / after a miss / with a hint / shown), grade, mistakes, legend.

![Tutor answer dark](k-lessons-09-tutor-answer-strokes-dark.png)
Same, dark theme.

![Tutor answer unfolded](k-lessons-10-tutor-answer-unfolded.png)
Unfolded.
