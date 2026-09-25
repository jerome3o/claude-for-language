# Flag a card for the tutor · Claude conversations · card page

Phone viewport 412×915 @2×. Seeded locally: student "Jerome", tutor "Tutor Li", deck 银行 smoke.

## Student

![Card back: the tutor's reply to a flagged card, shown once under the pinyin](01-card-back-reply.png)
Card back — "Tutor Li replied to your flag: …" under the pinyin, the next time the card came up (once).

![⋯ menu with Flag for tutor](02-study-menu-flag.png)
The ⋯ sheet on the card back gains **🚩 Flag for tutor** (only when the account has a human tutor).

![Flag sheet](03-flag-sheet.png)
The flag sheet: one note, Send. Works offline (queued, posted by the next sync).

![Sent](04-flag-sent.png)
Confirmation, then the sheet closes on its own.

![Cards you flagged on the student's tutor page](11-student-cards-you-flagged.png)
The student's tutor page: **Cards you flagged** — open ones first, resolved ones behind a toggle, with the tutor's reply.

![Claude conversations](12-claude-chats-student.png)
**More → Claude conversations**: every Ask-Claude question, grouped into conversations per card; tap to read.

![Student's card page](13-card-hub-student.png)
The student's card page (`/cards/:noteId`, from the deck page's History or a flag): the word, its three cards, flags (and a flag form), Claude conversations, recent reviews.

## Tutor

![Dashboard pill](05-dashboard-pill.png)
Students dashboard: a **🚩 n flagged cards** pill while any wait for a reply.

![Student page: Flagged cards](06-tutor-student-page.png)
The student page: **Flagged cards** under Needs attention, each with the student's note, **Reply** and **Resolve**.

![Reply box](07-tutor-reply.png)
Replying inline. The reply resolves the flag, goes into the chat and is shown to the student once on that card.

![Asked Claude](08-tutor-asked-claude.png)
**Asked Claude**: the student's latest conversations with Claude about their cards; *All conversations* for the full list.

![Tutor's card page](09-card-hub-tutor.png)
The tutor's card page (`/connections/:relId/cards/:noteId`, full page): note, how the three cards are going, flags with reply box, Claude conversations, recent reviews with typed answers.

![Tutor's Claude conversations page](10-claude-chats-tutor.png)
`/connections/:relId/claude-chats`: all of the student's conversations, newest first, one opened.
