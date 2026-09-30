# Lab app: homework pass laid out like a study card

Roborazzi renders (Pixel Fold folded 412×915dp, unfolded 841×701dp). The renders have no system
navigation bar; on the phone the answer bar now sits 16dp above it (checked by `PassLayoutTest`
with a 48dp navigation-bar inset).

## Before

![Before: front](01-before-front.png)
The card floats in the middle of an empty column; on the phone Show answer sat under the gesture bar.

![Before: revealed](02-before-revealed.png)
Revealing grows the floating card in place.

![Before: unfolded, revealed](09-before-unfolded-revealed.png)
Unfolded, revealed.

## After

![After: front](03-after-front.png)
The card fills the space between the header and the answer bar, like a study card; tap it or Show answer.

![After: revealed](04-after-revealed.png)
The card turns over (the study flip) to pinyin, meaning, ▶ Play and the sentence; Not yet / Got it take the same bottom slot as the study ratings.

![After: front, dark](05-after-front-dark.png)
Dark theme, front.

![After: revealed, dark](06-after-revealed-dark.png)
Dark theme, revealed.

![After: front, font 130 %](07-after-front-font130.png)
Font size 130 %.

![After: revealed, font 130 %, dark](08-after-revealed-font130-dark.png)
Font size 130 %, dark, revealed.

![After: unfolded, front](10-after-unfolded-front.png)
Unfolded, front.

![After: unfolded, revealed, font 130 %](11-after-unfolded-revealed-font130.png)
Unfolded, revealed, font size 130 %.
