# Video calls round 3 — board pages across lessons

Web: two browsers in one call (Chromium fake camera), a tutor (王老师, desktop 1440×900) and a student (Jerome, phone 412×915 @2x).

![Desktop: the board with its page strip; Jerome is on another page](01-desktop-board-pages.png)
The tutor's board: four pages in the strip (the current one highlighted, Jerome's dot on "Homework"), and the bar "Jerome is on Homework · Go there · Follow Jerome · Bring Jerome here".

![Phone: following the tutor](02-phone-following.png)
The student follows 王老师 — their view jumps with hers ("Following 王老师 · Stop following"). (The floating cameras over the board are round 2's layout; PR 2 moves them into the faces pair.)

![Desktop: ⋯ on the current page](03-desktop-page-menu.png)
⋯ on the current page: Rename, Duplicate, Delete….

![Desktop: delete confirm](04-desktop-delete-confirm.png)
"Delete page N? Its text is removed for both of you."

![Phone: brought here](05-phone-brought-here.png)
The tutor pressed "Bring Jerome here": the student lands on her page with "王老师 brought you to 把字句".

![Phone: review page](06-phone-review-pages.png)
After the call, the review page shows the pages written in that call, each with its number / title.

![Phone: tutor page link](07-phone-tutor-page-link.png)
"📝 Lesson board · 4 pages" on the tutor / student page.

![Phone: Lesson board](08-phone-lesson-board.png)
The Lesson board (`/connections/:relId/board`): every page, read-only, offline.

![Desktop: Lesson board](09-desktop-lesson-board.png)
The same on desktop.

![Unfolded: Lesson board](10-unfolded-lesson-board.png)
Pixel Fold unfolded (840 px).

![Phone: empty Lesson board](11-phone-lesson-board-empty.png)
Nothing written yet.

## Lab app (Roborazzi)

![Lab: strip + follow bar](lab-80-board-pages.png)
The page strip under the board, their dot on their page, the follow bar.

![Lab unfolded](lab-81-board-pages-unfolded.png)
The same, unfolded.

![Lab following](lab-82-board-pages-following.png)
Following the tutor (her caret shows on the shared page).

![Lab summoned](lab-83-board-pages-summoned.png)
"… brought you to page 2".

![Lab page menu](lab-84-board-page-menu.png)
Rename / Duplicate / Delete.

![Lab delete confirm](lab-85-board-page-delete.png)
Delete confirmation.

![Lab only page](lab-86-board-page-menu-only-page.png)
Delete disabled on the only page.

![Lab lesson board](lab-87-lesson-board.png)
The Lesson board (phone).

![Lab lesson board unfolded](lab-88-lesson-board-unfolded.png)
Unfolded.

![Lab lesson board offline](lab-89-lesson-board-offline.png)
Offline, from the cache.

![Lab lesson board empty](lab-90-lesson-board-empty.png)
Empty state.

![Lab review](lab-91-review-board-pages.png)
The call review's board, page by page.
