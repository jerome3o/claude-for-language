# Hard mode: feel, soft lock, listening round, in-place reveal, intentional stop

Web (412×915 at 2×, from `e2e/tests/study-sentence-gate.spec.ts` with `SHOTS_DIR`) and the Lab app (Roborazzi,
`HardModeUiTest`).

## Web

![Show answer: the answer in place](web-01-revealed-in-place.png)
👁 Show answer before a right answer: the answer shows in place on the question, then "Continue to the sentences ›".

![The round's Skip line](web-02-round-greyed-note.png)
The Sentence round: Skip says Good / Easy stay greyed (Again or Hard suggested), not locked.

![Tap again to rate Good anyway](web-03-tap-again.png)
Good / Easy greyed with "tap twice", Hard suggested; the first tap on Good arms it — "Tap again to rate Good anyway".

![Gave up: greyed](web-04-gave-up-greyed.png)
After giving up: "👁 You looked at the answer — Again or Hard suggested"; a second tap still rates Good.

![Recording: the pinned Stop bar](web-05-recording-stop-bar.png)
A sentence take under way: taps and scrolls elsewhere don't stop it; one big "■ Stop recording" pinned at the bottom.

![The listening card's round](web-06-listening-round.png)
The listening card in Hard mode: after its check, three "Say it in Chinese" sentences that carry the word.

## Lab app

![Lab: answer in place](lab-10-revealed-in-place.png)
The answer in place after 👁 Show answer (light).

![Lab: answer in place, dark](lab-10b-revealed-in-place-dark.png)
The same in dark mode.

![Lab: tap again](lab-11-greyed-tap-again.png)
Greyed Good / Easy, Hard suggested, Good armed: "Tap again to rate Good anyway".

![Lab: greyed, dark](lab-11b-greyed-dark.png)
Greyed after giving up, dark mode.

![Lab: listening round](lab-12-listening-round.png)
The listening card's "Say it in Chinese" round.

![Lab: listening round, dark](lab-12b-listening-round-dark.png)
The same in dark mode.

![Lab: listening round offline](lab-13-listening-round-offline.png)
Offline: say it aloud, "Show the Chinese", then check yourself.

![Lab: recording stop bar](lab-14-recording-stop-bar.png)
Recording in the round: the pinned "■ Stop recording" in the controls' slot.
