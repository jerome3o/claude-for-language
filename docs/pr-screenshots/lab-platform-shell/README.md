# Lab app: navigation shell, More tab, placeholders

Roborazzi renders (Pixel Fold folded, 412×915dp) from `ShellScreenshots.kt`. The two-glyph 🧑‍🏫 is a Robolectric font limit; phones draw one emoji.

![Study tab](shell-01-study-tab.png)
Study tab (student tab set: Study · Decks · Tutor · Progress · More); settings moved off Home into More.

![Decks tab](shell-02-decks-tab.png)
Decks tab (interim deck queue until package C lands).

![Tutor tab placeholder](shell-03-tutor-placeholder.png)
A tab whose screen is not native yet: says what it is, opens the main app at the same route.

![More](shell-04-more.png)
More: the web groups row for row (↗ = opens the main app) + Lab app settings and the extra-row slot (Send debug report lives there now).

![Pushed placeholder](shell-05-placeholder-pushed.png)
Any unbuilt web route opened from inside the app (here /coach), with back.

![Tutor account home](shell-06-tutor-account-home.png)
Tutor account (users.role = tutor): Students · Decks · Library · More and the teaching home.

![Tutor account More](shell-07-tutor-account-more.png)
Tutor account More: Teaching / Tools.

![Dark More](shell-08-dark-more.png)
Dark theme, account with students (Students · Decks · Study · Progress · More).

![Unfolded More](shell-09-unfolded-more.png)
Unfolded (841dp): content capped at 720dp.

![More sync timings](shell-10-more-sync-timings.png)
More → Lab app: last sync with per-step timings (moved from the old home ⚙ sheet, #405).
