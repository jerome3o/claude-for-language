# Calls round 4 — PR 3 (layout by drag and drop)

![Room for the faces](00-desktop-board-room-for-faces.png)
The board leaves room at its top for the faces box, so it no longer covers the first lines.

![Dragging: zones](01-desktop-dragging-zones-whole.png)
Dragging the board from the rail: the zone under the pointer lights up (here the whole stage).

![Dragging: right half](02-desktop-dragging-board-right-half.png)
Near the right edge: "Board · Right half".

![Split](03-desktop-screen-and-board-split.png)
Dropped: the shared screen and the board side by side (divider resizes), the faces floating over them.

![Keyboard menu](04-desktop-keyboard-move-menu.png)
Keyboard / no-drag fallback: the ⠿ grip opens "Move Screen to …".

![Stacked](05-desktop-stacked.png)
Bottom half: the two stack.

## Lab app (Android)

![Folded: screen above board](lab-10-screen-above-board-folded.png)
Folded (portrait): their shared screen on top, the board below, the faces floating over the screen; the divider has a ≥ 44 dp grip.

![Unfolded: side by side](lab-11-screen-beside-board-unfolded.png)
Unfolded: the screen and the board side by side; "🖥️ only" on the screen goes back to the screen alone.

![Long-press menu, folded](lab-12-long-press-menu-folded.png)
Long-press the shared screen (or the board, or its "🖥️ ⋯" tab): show the board below / above the screen, board only, screen only.

![Long-press menu, unfolded](lab-13-long-press-menu-unfolded.png)
Unfolded the menu offers beside / below; the current arrangement is ticked.

![Split chip](lab-14-split-chip-folded.png)
Their screen alone with the board open: the "📝 + 🖥️" chip splits them in one tap (a light haptic).

![Board room for the faces, folded](lab-15-board-room-for-faces-folded.png)
The text board starts below the faces box in its top corner (`textInsetTop`), so the first lines are never covered.

![Board room for the faces, unfolded](lab-16-board-room-for-faces-unfolded.png)
The same on the unfolded screen.
