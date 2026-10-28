# Session renewal + signed-out state + safe sign-in

Web (412×915, 2×) — real local worker, the session revoked on the server:

![Web: the banner on Home](01-web-banner-home.png)
Home after a 401: "You're signed out" first on the page, nothing covered; the cached user and local data stay.

![Web: the banner on Decks](02-web-banner-decks.png)
Every normal page shows it.

![Web: study session pill](03-web-study-pill.png)
A study session gets a compact pill under the top bar (clear of ✕ and the session's buttons).

![Web: Sign out with unsent reviews](04-web-sign-out-question.png)
Sign out with 12 reviews not uploaded: Sync first / Sign out anyway (deletes nothing).

![Web: a different account signs in](05-web-account-switch.png)
Minghui signs in on a browser holding Jerome's unsent reviews: sign back in as Jerome first, or discard.

Lab app (Roborazzi, 412×915dp):

![Lab: the banner over Home](lab-01-banner.png)
The banner above every screen (the shell's top slot), Home under it.

![Lab: transcription row](lab-02-transcription.png)
A take whose upload got 401: "Signed out — sign in again" instead of "Couldn't transcribe".

![Lab: Sign out with unsent work](lab-03-sign-out.png)
Settings / More → Sign out with 42 reviews + 7 recordings waiting: Sync first / Sign out anyway (keeps them).

![Lab: a different account signs in](lab-04-account-switch.png)
Not dismissable: Sign back in as the previous account, or Discard (asks once more).
