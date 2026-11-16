# Home counts right after a study session

Phone viewport (412×915 @2x). The sync routes were made to hang from the moment Study opened,
so everything Home shows comes from the device.

## Web

![Home before the session](01-home-before.png)
Before: 3 cards due.

![All done](02-all-done.png)
The session's "All Done!" screen.

![Home right after Done](03-home-right-after-done.png)
60 ms after **Done**: "✓ Flashcards done" on the first paint (the 3 reviews are still waiting to
upload — "3 pending"). Before this change Home painted "3 cards due" here until its recount finished.

## Lab app (Roborazzi)

![Lab Home before](lab-home-counts-01-before.png)
Before: 35 cards due.

![Lab Home after](lab-home-counts-02-after-study.png)
Right after "All done" → Done, while the upload sync runs: "All caught up" (it used to stay on the
old count until the sync finished, then say "Getting your cards…" while it ran).
