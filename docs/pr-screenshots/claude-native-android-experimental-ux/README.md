# Lab app (pure-native Android) — v1 screenshots

Rendered from the real Compose screens by `android-lab/app/src/test/…/ScreenshotTest.kt`
(Roborazzi + Robolectric) at the Pixel Fold's folded size (412×915dp) and unfolded (841dp wide).
Motion, haptics and sounds (flip spring, spark burst on a right answer, streak pops,
milestone chimes, confetti + fanfare at the end) don't show in stills.

![Sign in](01-sign-in.png)
Sign in — Google in a Custom Tab, back into the app on `chineselearning-lab://auth`.

![Home](02-home.png)
Home — today's cards with the web's four-colour breakdown, the deck queue with per-deck due counts.

![Read card, front](03-read-front.png)
Read (hanzi → meaning) front: type chip, deck, "Use in a sentence", streak and queue counts on top.

![Read card, back](04-read-back.png)
Back: pinyin, meaning, explanation, example sentences (tap to reveal, EN mode), ratings with FSRS intervals.

![Write card, front](05-write-front.png)
Write (meaning → hanzi): typing into the answer box.

![Write card, correct](06-write-correct.png)
A right typed answer: green glow + spark burst + chime + haptic.

![Listen card, wrong](07-listen-wrong.png)
A wrong answer: character diff (the web's AnswerDiff), shake + soft thud.

![Listen card, front](08-listen-front.png)
Listen (audio → hanzi): big play button, the clip auto-plays.

![All done](09-done.png)
All done: confetti, count-up stats, "Study 10 more new words", undo.

![Unfolded](10-unfolded-back.png)
Unfolded: two panes — answer on the left, explanation and sentences on the right.

![Dark mode](11-dark-write-correct.png)
Dark theme.
