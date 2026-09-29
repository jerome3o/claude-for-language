# Reader page audio: phrase blocks

Web (412×915 @2×, real MiniMax clips of 我喜欢一边跑步，一边听音乐。 and 咱们一边吃一边聊吧。 decoded in the browser):

![Stopped, three phrases found](01-web-blocks-stopped.png)
The page's clip split into 3 phrases at its pauses: ticks on the waveform, phrase 1 highlighted, ⏮ Phrase 1 of 3 ⏭ under play.

![Playing phrase 2](02-web-playing-block-2.png)
Playing: phrase 1 finished, so the restart point (the circle) moved to the start of phrase 2.

![Stopped mid phrase 2](03-web-stopped-restart-block-2.png)
Stopped 1.3 s into phrase 2 → play will restart phrase 2.

![Next phrase](04-web-next-phrase.png)
⏭ steps to phrase 3 (a stop within 1 s of entering phrase 3 had sent the restart point back to phrase 2).

![One block](05-web-one-block.png)
A short clip with no pause: one block — exactly the old scrubber, no ⏮ / ⏭ row.

Lab app (Roborazzi):

![Lab states](06-lab-phrase-blocks.png)
Stopped on phrase 2; a hand-placed (dragged) anchor inside phrase 3; one block as before.

![Lab session page](07-lab-session-page.png)
The in-session reader page with phrase blocks.

![Lab unfolded](08-lab-session-unfolded.png)
Unfolded (Pixel Fold inner screen).

![Lab dark](09-lab-dark.png)
Dark theme.
