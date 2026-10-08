# Say the answer on typing cards (🎤)

Phone viewport (412×915, 2×). Web = the PWA (Playwright, fake Soniox stream), Lab = the native app (Roborazzi).

## Web

![Typing card with 🎤](web-01-typed-mic.png)
A meaning → hanzi card: the 🎤 sits beside the answer box.

![Listening, live text](web-02-listening-live.png)
While speaking: the transcript appears in the box (provisional text grey), ⏹ stops, ✕ Cancel throws the take away.

![Sounded right](web-03-sounded-right.png)
Auto-submitted. 油 was heard for 由: same pinyin with tones → "Sounded right ✓ — written 由".

![Close — tones off](web-04-close-tones.png)
有 (yǒu) for 由 (yóu): same syllable, other tone → still wrong, with "Close — the tones are off".

![Transcription failed](web-05-transcribe-failed.png)
Live AND upload failed: nothing submitted, the box stays editable, "Couldn’t transcribe — tap to retry".

![Settings](web-06-settings-auto-submit.png)
Settings → Study → "Submit spoken answers automatically" (on by default).

## Lab app

![Lab typing card with 🎤](lab-s01-typed-mic.png)
The typing row: box · 🎤 · Show / Check.

![Lab listening](lab-s02-listening-live.png)
Live transcript (我 confirmed, 由 provisional), ⏹, ✕ Cancel.

![Lab sounded right](lab-s03-sounded-right.png)
Homophone accepted by sound.

![Lab close](lab-s04-close-tones.png)
Other tone: the diff plus "Close — the tones are off".

![Lab transcription failed](lab-s05-transcribe-failed.png)
Both paths failed: retry line, nothing submitted.

![Lab offline hint](lab-s06-offline-hint.png)
Offline (listen card): the dimmed 🎤 says why on tap; typing still works.

![Lab listening, dark](lab-s07-listening-dark.png)
Dark theme.

![Lab settings](lab-s08-settings-auto-submit.png)
Settings → Study → "Submit spoken answers automatically".
