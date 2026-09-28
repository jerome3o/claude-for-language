# Long multiple-choice card: scrolls, prompt and button always on screen, characters only

The card from the bug report: 我们一边吃晚饭，一边练习说中文。 — 14 rows to pick, one of which
offered the pinyin "xi" as a "character".

## Lab app (folded Fold 412dp, dark, font scale 1.3)

![Before (Jerome's phone)](01-lab-before-device.png)
Before: the grid pushes the question off the top and the button off the bottom; "xi" is an option.

![After, top](02-lab-after-folded-font130.png)
After: the question stays, the rows scroll (compact tiles past 6 rows), Show answer is pinned.

![After, scrolled to the bottom](03-lab-after-scrolled-bottom.png)
Scrolled to the last row — the button never moves; the 习 row has 4 real characters, no "xi".

![After, listen card, light](04-lab-after-listen-light.png)
Listen card: a smaller ▶ on the short front.

![After, unfolded](05-lab-after-unfolded.png)
Unfolded (841dp) at font scale 1.3.

## Web app (412×915)

![Before, top](06-web-before-top.png)
Before: the card scrolls as a whole, the button is off screen.

![Before, scrolled](07-web-before-scrolled.png)
Before, scrolled: the prompt is gone and "xi" is offered.

![After](08-web-after.png)
After: prompt on top, rows scroll, Show answer / Type instead / Regenerate pinned.

![After, picking down the grid](09-web-after-picked-autoscroll.png)
Each pick scrolls the next unanswered row into view.

![After, bottom](10-web-after-bottom.png)
Scrolled to the end — characters only.

![After, large text](11-web-after-large-text.png)
Browser text at 130%: the button still fits.
