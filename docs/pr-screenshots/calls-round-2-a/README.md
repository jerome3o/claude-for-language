# Video calls round 2 — PR A (quick fixes)

## Web

![Blocked devices, phone](01-prejoin-blocked-phone.png)
Camera + mic blocked: why, the exact Chrome steps, Try again — and Join still works ("Join without camera & mic").

![Blocked devices, desktop](02-prejoin-blocked-desktop.png)
The same at 1440×900 (the tutor's desktop).

![Board in dark mode with a composition preview](03-board-dark-compose-desktop.png)
Browser in dark mode: the board stays light paper with dark ink. Jerome is mid-pinyin — "wo ba cha" shows in his caret flag before he commits.

![Board on the phone, dark mode](04-board-dark-phone.png)
The phone side after committing 我把茶.

![Devices](05-devices-sheet-phone.png)
⋯ → Camera, mic & speaker (remembered on the device).

![Reconnecting over the frozen frame](06-reconnecting-frozen-desktop.png)
The student's connection dies: the tutor keeps the last frame with a small "Reconnecting…" badge instead of a blank tile.

![Connection log on the review page](07-review-connection-log-phone.png)
Review page → Connection log: joins, socket status, TURN offered or not, ICE/pc states, restarts, route used.

## Lab app

Roborazzi screenshots:

![Pre-join, blocked](lab/calls-12-prejoin-blocked.png)
Mic and camera permission denied: explanation, Try again / Open settings, Join still enabled.

![Camera in use](lab/calls-31-prejoin-camera-in-use.png)
Another app holds the camera: "Join with audio only".

![Reconnecting](lab/calls-32-live-reconnecting-frozen.png)
The remote tile keeps its last frame with a Reconnecting… badge.

![No mic in the call](lab/calls-33-live-no-mic.png)
In the call without a microphone — the mic button asks for it.

![Board, light](lab/calls-34-text-board-compose-light.png)
Text board with the other person's composition preview.

![Board, dark theme](lab/calls-35-text-board-compose-dark.png)
Same in the dark theme — the board stays paper with dark ink (was light ink on white).

![Draw board, dark theme](lab/calls-36-draw-board-dark.png)
Drawing board in the dark theme.

![Device picker](lab/calls-38-device-picker.png)
⋯ → camera front/back and speaker / phone / headphones / Bluetooth.

![Connection log](lab/calls-39-review-connection-log.png)
Review screen → Connection log.
