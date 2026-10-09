# Voice-first answer row: the read card's button style

The typing cards' question (English → hanzi, audio → hanzi) no longer has a big round 🎤 between
two boxy side buttons. It now has one row of the app's own buttons where the read card's
Show answer / 🎤 Record row sits. **✏️ Type** and **👁 Show answer** are small on the left. The
wide primary **🎤 Say it** is on the right. While listening, the row becomes ✕ Cancel and a red ⏹ Stop.
Phone shots are 412×915.

## Before (PR #581)

![Lab before](before-lab-01-voice-first.png)
Lab: the big orange circle with the two boxy side buttons.

![Lab before, dark](before-lab-01b-voice-first-dark.png)
Lab, dark, listen card.

![Lab before, listening](before-lab-02-listening.png)
Lab while listening.

![Web before](before-web-01-voice-first.png)
Web.

![Web before, listening](before-web-02-listening.png)
Web while listening.

## After: Lab

![Lab voice row](lab-01-voice-row.png)
English → hanzi: ✏️ Type · 👁 Show answer · 🎤 Say it. These are the kit's `SecondaryPill` and `PrimaryPill`, 60 dp high like the read card's row.

![Lab voice row, dark](lab-01b-voice-row-dark.png)
The same card in dark mode.

![Lab listen card](lab-01c-voice-row-listen.png)
Audio → hanzi (listen card).

![Lab listen card, dark](lab-01d-voice-row-listen-dark.png)
Listen card in dark mode.

![Lab listening](lab-02-listening.png)
While listening, the live transcript shows above the row, which becomes ✕ Cancel and a red ⏹ Stop.

![Lab listening, dark](lab-02b-listening-dark.png)
Listening, in dark mode.

![Lab finishing](lab-03-finishing.png)
After Stop, the button reads "Finishing…" until the transcript is final.

![Lab typing mode](lab-04-typing-mode.png)
✏️ Type opens the box with the small 🎤 beside it, as before.

![Lab unfolded](lab-05-unfolded.png)
Unfolded (841 dp wide): Say it takes the rest of the row.

## After: web

![Web voice row](web-01-voice-row-meaning.png)
English → hanzi: `.btn .btn-secondary` ✏️ Type and 👁 Show answer, then the wide `.btn .btn-primary` 🎤 Say it.

![Web listening](web-02-listening.png)
While listening: the live transcript above, then ✕ Cancel and ⏹ Stop (`.btn-error`, the read card's Stop Recording).

![Web typing mode](web-03-typing-mode.png)
✏️ Type opens the box, unchanged.
