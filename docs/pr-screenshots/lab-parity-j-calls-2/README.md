# Lab app — video calls, part 2 (the live call)

Robolectric + Roborazzi renders (Pixel Fold folded 412dp; two unfolded). Real WebRTC can't render
under Robolectric, so the videos are stand-ins (emoji on a gradient) drawn through the same video slot.

![Pre-join](calls-11-prejoin.png)
Pre-join: camera preview with mic / camera toggles, "Record my microphone for the transcript", Join.

![Permissions refused](calls-12-prejoin-blocked.png)
Microphone refused: the reason and an Allow button (Join stays disabled).

![Waiting alone](calls-13-live-waiting.png)
A solo test call: waiting dots, recording (● REC), self view.

![In the call](calls-14-live.png)
In the call: the tutor's video, my self view, REC badge, elapsed time, controls.

![Whiteboard](calls-15-live-whiteboard.png)
Whiteboard panel: the tutor's committed text and strokes plus the stroke they're drawing right now (blue), tools and colours, unread chat badge.

![Chat](calls-16-live-chat.png)
In-call chat; the tutor has muted (🔇 on their label).

![Unfolded](calls-17-live-unfolded-whiteboard.png)
Unfolded Fold: stage and whiteboard side by side, sharing my screen (self view shows the screen).

![Reconnecting](calls-18-live-reconnecting-camera-off.png)
Room reconnecting, my camera and mic off, the tutor's connection still coming up.

![Ended](calls-19-ended-uploading.png)
Call ended: 4 recording parts still uploading, links to the transcript and all calls.

![Pre-join unfolded](calls-20-prejoin-unfolded.png)
Pre-join on the unfolded screen.
