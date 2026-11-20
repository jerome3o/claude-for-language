# ＋ Add tab: nothing records until 🎤 is tapped

Lab app (Roborazzi, 412×915 dp, dark), coming back to the ＋ Add tab with 🎤 Say it still picked:

![Before — back on the tab, already listening](lab-01-back-on-tab-before.png)
Before: the box started listening by itself on every return (and the running take turned every tab-bar tap into "stop the take").

![After — back on the tab, idle](lab-02-back-on-tab-after.png)
After: the box is idle; nothing records until he taps 🎤 Say it.

![Lab — the tab on open](lab-03-tab-on-open.png)
The tab on a fresh open (unchanged): no box, no take.

Web (Playwright, 412×915 at 2×; the web page never started a take on open — the fix there makes the one-shot explicit):

![Web — the tab on open](web-01-add-tab-on-open.png)
The tab on open: no voice box, nothing recording.

![Web — back on the tab](web-02-add-tab-back-again.png)
After ✏️ Type it → Progress tab → back to ＋ Add: the tab bar navigated at once; nothing records.
