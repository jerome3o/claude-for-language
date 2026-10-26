# 🥽 VR (beta) — `/vr` (docs/VR.md)

Taken from the dev build: the flat preview (what a browser without immersive WebXR shows) at 1280×800 and
at the phone viewport (412×915, 2×), and the immersive session in an emulated Meta Quest 3 (IWER).

![Desktop room](01-desktop-room.png)
The flat preview on a wide screen: Reader, Homework and Study windows in the ring, the tray (a desk) below.

![Immersive, emulated](02-immersive-emulated-quest3.png)
In the headset (emulated Quest 3, one eye): two controller rays, the Study card's answer side, the Explorer window opened from the tray, Exit VR.

![Study front](03-phone-study-front.png)
Study: the regular session's next card (the "Flat preview" note, dismissable).

![Study answer](04-phone-study-answer.png)
Show answer: pinyin, meaning, the card sentence (every word tappable), Again / Hard / Good / Easy with intervals.

![Explorer](05-phone-explorer.png)
Tapped 银行 on the card, then 银: the Explorer window (readings, parts, words with 银, ← back and the trail).

![Reader](06-phone-reader.png)
Reader: a story page with 拼 Pinyin shown, ▶ Listen, Up next / Next.

![Homework](07-phone-homework.png)
Homework: the one-off homework list (a word list from the tutor, due in 1 day).

![Homework pass](08-phone-homework-pass.png)
The word list passed in VR: Show answer → Not yet / Got it.

![Lesson](09-phone-lesson-scramble.png)
A mini lesson played from its spec (content as data): the scramble exercise, tiles tapped in order.

![Feedback](10-phone-feedback.png)
💬 Feedback: the screenshot of the view, quick chips, 🎤 Say it, Send.

![Feedback sent](11-phone-feedback-sent.png)
Sent through POST /api/feedback.
