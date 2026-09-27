# Homework (2/2) — lesson notes → draft → review with Claude → assign

Phone viewport (412×915 @2×) unless noted; seeded locally (the draft comes from `POST /api/test/homework-draft`, the same shape the agent writes). Design: [docs/HOMEWORK.md](../../HOMEWORK.md) §4.

![Lesson notes list](01-lesson-notes-list.png)
Student page → **Lesson notes**: one entry per lesson with its homework state — "No homework yet · ✨ Draft homework", "Draft ready · Review".

![Add lesson notes](02-add-lesson-notes.png)
*+ Add lesson notes*: title, date, notes, and "Draft homework from these notes — you review it before anything is sent".

![Draft — top](03-draft-top.png)
The draft: Jerome's load now and **after this** (week bars: the new days in light purple), the assistant's summary, sticky **Assign** bar.

![Draft — skipped words and plan](04-draft-skipped-and-plan.png)
Words (× to drop one), **"Skipped 2 words Jerome already has"** with where they live and *Include anyway*, One-off / Long-term / Both.

![Draft — split, lesson, assign](05-draft-lesson-and-assign.png)
Due date, **spread the 12 words over 2 days** with the per-day preview, where the long-term copy goes, the mini lesson as one-off.

![Draft — Claude](06-draft-claude-chat.png)
The Claude tab: the assistant's messages and the tutor's requests; suggestion chips; a message continues the same agent job.

![Draft — wide](07-draft-wide.png)
≥1024px: draft and Claude side by side.

![Assigned](08-draft-assigned.png)
After **Assign**: 3 assignments (words day 1 + day 2, the lesson), 2 known words left out.

![Student page after assign](09-student-page-after-assign.png)
Back on the student page: the entry says "Assigned", and the homework list shows the new items with due labels.
