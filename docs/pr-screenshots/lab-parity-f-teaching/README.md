# Lab app — package F (teaching), part 1

Roborazzi renders of the native tutor screens (`android-lab/app/src/test/…/ui/teaching/TeachingScreenshots.kt`), Pixel Fold folded (412dp) unless noted.

![Students dashboard](teaching-01-dashboard.png)
Students tab: student cards with status line and pills, a new student's setup checklist, a pending invite (Resend / ⋯), homework decks.

![Dashboard dark](teaching-04-dashboard-dark.png)
Same, dark theme.

![Dashboard offline](teaching-03-dashboard-offline.png)
Offline: the cached dashboard with a stale notice.

![Student page](teaching-05-student.png)
Student page, top: status, Message / Send homework / Video call, Needs attention (wrong characters red, 🎤 hear), flagged card.

![Student page, whole](teaching-06-student-full.png)
The whole page: flags, Asked Claude threads, links, load gauge + one-off homework with due chips, homework decks with #N queue badge and Update, mini lessons, conversations, activity.

![Student page, unfolded](teaching-08-student-unfolded-full.png)
Unfolded (841dp): the student on the left, the work on the right.

![New student](teaching-09-student-new.png)
A brand-new student: "Getting set up" checklist (Send how-to) and "If they get stuck".

![Send homework — decks](teaching-11-send-decks.png)
Send homework: the tutor's decks (sent / up to date / new words to send).

![Send homework — one-off, split](teaching-16-send-one-off-split.png)
Both (one-off + long-term), due date chips, "spread over 3 days" with the per-day preview, leave out known words, Core / Non-urgent.

![Send homework — already sent](teaching-13-send-already-sent.png)
A deck already sent: Update their copy (+3) or send a second copy.

![Send homework — lessons, offline](teaching-14-send-lessons.png)
Lessons tab (offline: sending disabled with a notice).

![Invite](teaching-17-invite.png)
Invite a student: Starter Chinese ticked, own decks, welcome message, Options.

![Invite result](teaching-18-invite-result.png)
The created link: QR (zxing), Copy / Share, summary.
