# Sentence making: a fix that works, the reason read once

Jerome's 从…的角度 sentence (从我妈妈的角度来看我和我妹妹住在很远的地方), graded needs work for meaning. Phone viewport
(412×915 @2x), web app with the E2E stand-in.

![Before: More repeats the reason](web-01-before-more-repeats.png)
Before — the reason line is cut with "…", and More ▸ shows the whole reason again underneath it.

![After: the cut reason line](web-02-after-cut-reason.png)
After — collapsed: the headline, the cut reason line, More ▸.

![After: More opens in place](web-03-after-more-in-place.png)
After — More ▸ opens the whole reason in place of the cut line: read once.

![After: the fix](web-04-after-fix.png)
After — ✨ Show a fixed version is told the problem and adds his mother's view: 从我妈妈的角度来看，我和我妹妹住得太远了。

## Lab app (Roborazzi, dark)

![Lab: the cut reason line](lab-01-cut-reason.png)
Collapsed: the headline, the cut reason line, More ▸.

![Lab: More opens in place](lab-02-more-in-place.png)
More ▸ opens the whole reason in place of the cut line.

![Lab: the server couldn't fix it](lab-03-fix-failed-not-offline.png)
The server answered 502 (Claude couldn't fix it): "Claude couldn't fix this one — try saying it another way." Before,
this showed "A fixed version needs a connection — try again when you're online." because HttpException is an IOException.
