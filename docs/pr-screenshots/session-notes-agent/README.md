# Session notes → homework agent

Phone viewport 412×915 @2×, tutor account "Tutor Li" on the student page of "Jerome". Jobs seeded in the local D1 to show every state; the running job's steps are the lines the agent writes as it works.

![Section on the student page](01-section-jobs.png)
The new **Session notes** section on the tutor's student page: **+ Add notes**, a job that is still working (live progress line + the last steps, polled every 3 s, Cancel), and a finished one with what it made — the deck (4 cards, sent to the student) and the mini lesson it decided the notes warranted (assigned), each linking to the tutor's own copy.

![Done job with its steps](02-done-job-steps.png)
"What it did" on a finished job: the full step list — words checked against the student's cards, the deck created, a card rejected by the card standard and fixed, the reasoning for writing a lesson on 想 + verb, sharing and assigning — followed by the results and the assistant's summary.

![Upload sheet](03-upload-sheet.png)
The sheet: paste any amount of raw notes (or attach a text file), optional title and lesson date, and the delivery choice — send automatically (Core = top of the student's queue / Non-urgent = bottom) or keep it in the library to review first; also log the lesson so Insights counts "since last lesson" from it.

![All jobs page](04-all-jobs-page.png)
`/connections/:relId/session-notes` lists every job (the student page shows the latest three).

![Failed job with Retry](05-failed-job.png)
A failed job keeps its steps and shows a readable error; **Retry** resumes from the last checkpoint. Below the summary, "2 words left out" opens the list of words the agent deliberately skipped with the reason.
