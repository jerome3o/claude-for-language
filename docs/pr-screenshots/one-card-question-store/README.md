# One store for card questions — screenshots

Every Claude question on a card now lives only in its card thread; the screens list those threads
(each opens the conversation) instead of regrouping Q&A rows on the device.

## Web (phone, light)

![Tutor's view of a card — after](web-04-card-hub-tutor.png)
The tutor's view of a student's card, after: the card's Claude threads the student lets her read (tap → read-only thread).

![Tutor's view of a card — before](before-web-04-card-hub-tutor.png)
Before: the same card's Q&A rows regrouped on the device and expanded inline.

![Claude conversations — after](web-02-claude-conversations.png)
More → Claude conversations, after: one row per card thread with its card, each opening the conversation.

![Claude conversations — before (what an older build still shows)](before-web-02-claude-conversations.png)
Before — and what an installed older build still shows: `/api/me/claude-chats` is now served from the card threads.

![Learner's card hub](web-01-card-hub-student.png)
The learner's own card hub (unchanged: its threads; the header no longer counts the old rows).

## Lab app (dark)

![Lab card hub](lab-01-card-hub-dark.png)
The card hub: "💬 Asked Claude" lists the card's threads from the phone's thread cache (offline), each → the thread.

![Lab Claude conversations](lab-02-claude-conversations-dark.png)
Claude conversations: every card thread with its card (from the Chats tab's thread list).

![Lab tutor card hub](lab-03-tutor-card-hub.png)
The tutor's view of a student's card: the card's visible threads (`…/claude-threads?note_id=`).
