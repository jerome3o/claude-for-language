# Voice-first text input — shared component (web + Lab)

The box shown in a "Translate into Chinese" frame (the mini lessons adopt it in the next PR). Phone viewport, 412 wide.

## Web (`components/voice/VoiceTextInput.tsx`)

![Idle](web-01-idle.png)
Idle: ✏️ Type · wide 🎤 Say it — no keyboard.

![Listening](web-02-listening.png)
Listening: the words stream in (confirmed black, provisional grey), ✕ Cancel · ⏹ Stop.

![Review](web-03-review.png)
Review: what was heard with the device's pinyin, 🔁 Retry · ✏️ Edit · ✓ Check.

![Typing](web-04-typing.png)
Typing (after ✏️ Type / ✏️ Edit): the box with a 🎤 to go back to speaking.

![Failed](web-05-failed.png)
Never silent: "Couldn't transcribe — tap to retry" (the same take), ✏️ Type · 🔁 Retry.

![Offline](web-06-offline.png)
Offline: typing with the reason, no 🎤.

## Lab (`ui/kit/VoiceTextField.kt`)

![Idle](lab-01-idle.png)
Idle.

![Listening](lab-02-listening.png)
Listening with the live transcript.

![Review](lab-03-review.png)
Review.

![Typing](lab-04-typing.png)
Typing with the 🎤.

![Failed](lab-05-failed.png)
Couldn't transcribe.

![Offline](lab-06-offline.png)
Offline.

![Review, dark](lab-07-review-dark.png)
Review in dark mode.
