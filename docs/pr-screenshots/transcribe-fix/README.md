# Pronunciation: never silent when transcription fails

![Web: both paths failed](01-web-transcribe-failed.png)
Web, read card after Stop: the live Soniox stream was refused and the upload got a 502 — "Couldn't transcribe — tap to retry" (it used to show nothing).

![Web: after the retry](02-web-after-retry.png)
Web: the tap re-sent the same saved take; "You said: …" appears.

![Lab: both paths failed](03-lab-transcribe-failed.png)
Lab app, same state (Roborazzi `study-b10b-read-back-transcribe-failed`).
