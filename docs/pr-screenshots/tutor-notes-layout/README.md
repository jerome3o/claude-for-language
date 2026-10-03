# Notes from your tutor — long-sentence note layout

Phone viewport, 412×915 dp at 2× / xxhdpi (Pixel Fold, folded).

## Lab app (Roborazzi, `TutorNotesLayoutTest` / `TutorNotesScreenshots`)

![Lab before](01-lab-before.png)
Before: the 28sp hanzi sat in a Row beside the pinyin / English column. The pinyin was measured 0 px wide and the card grew thousands of px tall. In Robolectric even the hanzi is squeezed out.

![Lab after](02-lab-after.png)
After: header, then the hanzi (wrapping), the pinyin, the English, the tutor's comment and the actions, stacked.

![Lab after, the full page](03-lab-after-page.png)
After: short words (刮风, 中国) on the regular page use the same stacked layout.

## Web (`TutorNotesPage.css`; the page's markup rendered with the app's CSS in Playwright)

![Web before](04-web-before.png)
Before: `flex-wrap` already moved long sentences onto separate lines, but short words still put the pinyin beside the hanzi.

![Web after](05-web-after.png)
After: always stacked, matching the Lab app. Long hanzi and pinyin may break anywhere.
