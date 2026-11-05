# Sentence round: a quiet Skip that asks first

Jerome: "this text at the bottom of the screen is not super helpful … That button should be kind of grayed out and not look clickable, but you can click it, and there should be a little pop up saying 'Do you want to skip this exercise?'"

![Web: the round, quiet Skip](01-web-round-quiet-skip.png)
Web (412×915 @2x): the explanatory line under Skip is gone; "Skip to the answer" is muted text, no outline (still a 44 px button).

![Web: Skip this exercise?](02-web-skip-confirm.png)
Web: tapping it opens "Skip this exercise?" with Skip / Keep going (Keep going is the default; Escape or a tap outside = Keep going).

![Lab: the round, quiet Skip](03-lab-round-quiet-skip.png)
Lab app (Roborazzi): the same quiet Skip, no line under it.

![Lab: Skip this exercise?](04-lab-skip-confirm.png)
Lab app: the kit's ConfirmDialog — Keep going / Skip (Robolectric's capture leaves out the dialog's dimmed backdrop).
