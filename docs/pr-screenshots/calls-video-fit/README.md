# Video calls: feeds fit wide windows

Real two-browser calls (WebRTC through the local worker) with drawn "cameras" of known shapes:
a laptop webcam (1280×720) and a phone camera (720×1280). Desktop = 1440×900, phone = 412×915, both 2×.

![Before, desktop](01-before-desktop-portrait-remote.png)
Before — Minghui's desktop window with Jerome's portrait phone feed: cropped to a band across the face (the bug).

![After, desktop](02-desktop-portrait-remote.png)
After — the whole picture, centred on a soft blurred copy of itself; self-view small, bottom-right, landscape like her webcam.

![Before, phone](03-before-phone-landscape-remote.png)
Before — Jerome's phone with Minghui's landscape webcam: only the middle third was visible.

![After, phone](04-phone-landscape-remote.png)
After — the whole webcam picture with a blurred letterbox; his own portrait self-view top-right.

![Whiteboard open, desktop](05-desktop-panel-open.png)
Wide window with the whiteboard open: the stage beside the panel, the feed still whole.

![Landscape remote, desktop](06-desktop-landscape-remote.png)
Laptop ↔ laptop: the shapes are within 15 %, so the feed fills the stage (cover).

![Portrait remote, phone](07-phone-portrait-remote.png)
Phone ↔ phone: portrait in portrait fills the stage (cover).

![Pre-join, desktop](08-desktop-prejoin.png)
Pre-join preview takes the webcam's landscape shape instead of a fixed 3:4 crop.

## Lab app (Roborazzi)

![Lab phone, landscape remote](lab-calls-14-live.png)
Phone with a landscape remote: whole picture on a dark letterbox; self-view shaped like the phone camera.

![Lab phone, portrait remote](lab-calls-21-fit-phone-portrait-remote.png)
Phone with a portrait remote: fills the stage.

![Lab unfolded, portrait remote](lab-calls-22-fit-unfolded-portrait-remote.png)
Unfolded with a portrait remote: shown whole, self-view bottom-right.

![Lab unfolded, landscape remote](lab-calls-23-fit-unfolded-landscape-remote.png)
Unfolded with a landscape remote and a landscape self camera.

![Lab pre-join unfolded](lab-calls-20-prejoin-unfolded.png)
Pre-join preview in the camera's shape.
