# Navigation overhaul — screenshots

Captured with Playwright (Chromium, 2×) against a local worker with seeded
data. Phone shots are 412 px wide (Pixel Fold, folded).

## Tab bar

![Home, student account](01-home-412.png)
Home at 412×915 with the bottom tab bar: Study · Decks · Tutor · Progress · More. Study is active.

![Decks tab](02-decks-412.png)
The new Decks tab: search field at the top, the deck list (pinned first) and New Deck / Generate / Analyze.

![Decks search with the keyboard open](03-decks-search-keyboard-412.png)
Searching "你好" with the viewport shrunk to 560 px (the on-screen keyboard, `interactive-widget=resizes-content`): the bar follows the resized viewport and the field and results stay above it.

![Landscape, folded Pixel](08-decks-landscape-915x412.png)
915×412 landscape: the bar drops to 48 px so the page keeps room.

![Unfolded, 840 px](09-home-840.png)
840×1000 (unfolded): the bar stays, its tabs centred at 640 px.

![Desktop, 1280 px](10-decks-1280.png)
1280×800 desktop web app: same bar, same centred tabs.

![Study session: no bar](14-study-no-bar-412.png)
A running study session is immersive — no header, no bar, no bottom padding.

## More page (replaces the 15-item avatar dropdown)

![More page](04-more-412.png)
Grouped: Practice · From your tutor · Account, then Advanced collapsed. 56 px rows with an icon, label, one-line description and chevron. The avatar in the header opens this page.

![More page, Advanced expanded](05-more-advanced-412.png)
Advanced: Duplicate Finder, Sentence Coverage, Full Sync, Update App, Debug Console toggle, Copy Debug Dump (and Admin for admins).

## Settings

![Settings](06-settings-412.png)
Personal Bio · Offline audio as one status line · Backup · Start on (Automatic / Study / Decks; Students appears for accounts with students) · Sign out · Advanced collapsed.

![Settings, Advanced expanded](07-settings-advanced-412.png)
Advanced: Audio Quality, Playback Quality, Sentence Coverage, Feature Requests, Duplicate Finder, Full Sync, Update App, Debug Console, Copy Debug Dump.

## Tutor-only account

![Tutor lands on Students](11-tutor-landing-students-412.png)
An account with a student, no decks and nothing due opens on the Students tab (`/connections`). Tabs: Students · Decks · Study · More.

![Tutor's More page](12-tutor-more-412.png)
No Readers, no Lesson Notes; a Teaching section with the Lesson Library.

![Tutor's Settings](13-tutor-settings-412.png)
No Personal Bio, no Offline audio; Start on offers Students.
