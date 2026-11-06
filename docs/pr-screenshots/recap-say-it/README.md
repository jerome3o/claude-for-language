# Word recap: 🎤 Say it + tapped words only

Phone viewport (Lab: Roborazzi, 412dp; web: Playwright 412×915 @2x from `e2e/tests/reader-word-recap.spec.ts`).

## Lab app

![Question side, said right (dark)](lab-01-say-question-dark.png)
The question side: 🎤 Say it under the story sentence (no ▶ — it would give the word away); the take said right → the compact "You said" row, ✓ Match, then 🔁 Try again.

![Question side, said right (light)](lab-02-say-question.png)
The same in light.

![Other tones (dark)](lab-03-say-close-dark.png)
Other tones → ≈ Close — tones off (no suggestion).

![Answer side, Got it suggested (dark)](lab-04-say-answer-dark.png)
After Show answer: the word said inside a phrase counts ("Contains the answer"), so Got it is ringed "✓ Got it" (suggested — he still chooses); "You tapped it while reading" only.

## Web app

![Offer: tapped words only](web-01-offer.png)
The end-of-story offer counts the tapped words only ("2 you tapped") — the word read aloud wrong (麻辣) is not in it.

![Say it before Show answer](web-05-say-it.png)
🎤 Say it on the question side, the take checked against 晚上: "Contains the answer".

![Answer side, Got it suggested](web-06-say-it-answer.png)
After Show answer: the result stays, Got it ✓ SUGGESTED.
