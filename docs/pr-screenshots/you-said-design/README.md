# "You said" box redesign: screenshots

The study card's "You said" box on read cards, spoken answers, Say it practice and the homework pass, at phone width (412 × 915, 2×).

## Lab app (Compose, Roborazzi)

Before → after, every state on a minimal card back. From top to bottom: match, contains, didn't match, couldn't transcribe, transcribing.

| Before (light) | After (light) |
|---|---|
| ![Before, light](lab/study-yousaid-before-light.png) | ![After, light](lab/study-yousaid-box-light.png) |

| Before (dark) | After (dark) |
|---|---|
| ![Before, dark](lab/study-yousaid-before-dark.png) | ![After, dark](lab/study-yousaid-box-dark.png) |

The whole study card, after:

![Contains the answer, dark: ▶ on the left, the round ✎ Check in Coach on the right, the text centred](lab/study-yousaid-04-contains-dark.png)
Contains the answer, dark (Jerome's case): ▶ on the left, the round ✎ Check in Coach on the right, and the text stays centred.

![Contains the answer, light](lab/study-yousaid-03-contains.png)
Contains the answer, light.

![Match, light](lab/study-yousaid-01-match.png)
Match, light: no Coach button, but the right column stays empty so the text remains centred.

![Match, dark](lab/study-yousaid-02-match-dark.png)
Match, dark.

![Didn't match, light](lab/study-yousaid-05-miss.png)
Didn't match, light.

![Didn't match, dark](lab/study-yousaid-06-miss-dark.png)
Didn't match, dark.

![Couldn't transcribe, light](lab/study-yousaid-07-failed.png)
Couldn't transcribe, light. The whole box is the retry button.

![Couldn't transcribe, dark](lab/study-yousaid-08-failed-dark.png)
Couldn't transcribe, dark.

![Transcribing, light](lab/study-yousaid-09-transcribing.png)
Transcribing…, light. Same shell and height as the result, so nothing jumps when the result arrives.

![Transcribing, dark](lab/study-yousaid-10-transcribing-dark.png)
Transcribing…, dark.

## Web app (light; the web app has no dark theme)

All five states, cropped to the box:

| Before | After |
|---|---|
| ![Web before](web-before-all.png) | ![Web after](web-after-all.png) |

The full card:

![Web before, contains](web-before-02-contains.png)
Before: "You said: pinyin (汉字) ✅", with a squarish ✏️ Check jammed into the right edge.

![Web after, contains](web-after-02-contains.png)
After: what was said is the hero, the verdict is a chip, and ▶ and ✎ are round 44px buttons.

![Web after, match](web-after-01-match.png)
After, match.

![Web after, miss](web-after-03-miss.png)
After, didn't match.

![Web after, failed](web-after-04-failed.png)
After, couldn't transcribe.

![Web after, transcribing](web-after-05-transcribing.png)
After, transcribing.
