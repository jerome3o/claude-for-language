# 🎤 Read it again in Hard mode's answer in place

Web, phone viewport 412×915 at 2× (taken by `e2e/tests/study-sentence-gate.spec.ts` with `SHOTS_DIR`).

**Before**: the panel after 👁 Show answer, with no way to read it again. (Same build with the new block hidden; nothing else in the panel changed.)

![Before](read-again-01-before.png)

**After**: 🎤 Read it aloud under "You said". Continue to the sentences stays the primary button.

![After: Read it aloud offered](read-again-02-after-offered.png)

**Recording**: the live words while he reads, ⏹ Stop.

![Listening](read-again-03-listening.png)

**Still not right**: ✗ Not quite, with the "You said" row marking the misheard character (这).

![Wrong retake](read-again-04-wrong.png)

**Right this time**: ✓ Right this time + Match. Practice only: the card still counts as a miss.

![Right retake](read-again-05-right.png)

## Lab app (Roborazzi, `HardModeUiTest`)

![Lab: idle](lab-01-idle.png)
![Lab: listening](lab-02-listening.png)
![Lab: right this time](lab-03-right.png)
![Lab: not quite (dark)](lab-04-wrong-dark.png)
