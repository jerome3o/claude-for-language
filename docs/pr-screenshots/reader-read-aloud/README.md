# 🎤 Read it aloud on reader pages

Web (412×915, 2×, from `e2e/tests/reader-read-aloud.spec.ts` with a fake microphone and a mocked transcription):

![Reader page with 🎤 beside the speed chip](web-01-reader-page-mic.png)
The page: 🎤 sits right after the speed chip in the audio row.

![Listening](web-02-listening.png)
Recording: the Chinese is shown, ⏹ stops, the live transcript appears under the audio row.

![Marked in place](web-03-marked.png)
The page's own Chinese marked in place: 他 heard as 她 (sounded right, dotted), 很 missed (red dashed), 兴 tone off (amber, wavy), ‸ = an extra 了. One line: "≈ 85% — 3 to check".

![You said opened](web-04-you-said.png)
"You said ▸" opens the transcript, small.

![Offline](web-05-offline.png)
Offline: "Needs a connection to check your reading" (nothing recorded or queued).

Lab app (Roborazzi, `ReadAloudTest`):

![Lab: marked](lab-40-read-aloud-marked.png)
Marked page + the one line; 🎤 between the speed chip and the phrase steps.

![Lab: listening](lab-41-read-aloud-listening.png)
Listening, with the live transcript (grey = still provisional).

![Lab: all right](lab-42-read-aloud-all-right.png)
Everything read right: "✓ 100% — all read right".

![Lab: failed](lab-43-read-aloud-failed.png)
A take that couldn't be transcribed: "Couldn't transcribe — tap to retry".
