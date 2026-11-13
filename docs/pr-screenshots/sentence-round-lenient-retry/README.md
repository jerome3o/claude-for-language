# Sentence round: lenient spoken checks, Try again after the answer, tap to listen

Phone viewport (412×915 @2×). Web shots from `e2e/tests/study-sentences-by-ear.spec.ts`, Lab shots from `SentenceListenUiTest` (Roborazzi).

## Web

![Tap to listen](web-00-listen-tap.png)
Listen exercises never play by themselves: one big ▶ Tap to listen per row.

![Said back with a pause](web-05-said-back-with-a-pause.png)
Said back in Chinese with a pause (the recogniser's 。 in the middle): ✓ Right · You said it back right, no Claude call; "You said" reads like the sentence.

![Not quite with Try again](web-03-listen-wrong.png)
A wrong answer, the answer shown: 🔁 Try again.

![Retry right, 2 / 2](web-03b-listen-retry-right.png)
The retry said right counts: 2 / 2, Good and Easy unlocked.

## Lab app

![Lab tap to listen](lab-00-tap-to-listen.png)
The same ▶ Tap to listen in the Lab app.

![Lab wrong with Try again](lab-07-wrong-try-again.png)
✗ Not quite with 🔁 Try again after the reveal.

![Lab retry right](lab-08-retry-right.png)
The retry said right counts (1 / 2).
