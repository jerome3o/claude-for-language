# Lab bottom sheets stay below the status bar

Roborazzi shots from `SheetInsetsTest` (412×915dp, Pixel Fold folded) with a real 52dp status-bar
inset dispatched to the sheet's window. The stand-in phone behind the sheet draws a status bar
(12:34 · camera dot · battery) of that height, dimmed by the sheet's scrim.

**Before** — the character sheet covers the status bar completely: the 行 tile and × sit where
the clock and battery are.

![Before: character sheet over the status bar](01-before-char-sheet.png)

**After** — the sheet's top is 8dp below the status bar; the words list scrolls inside.

![After: character sheet below the status bar](02-after-char-sheet.png)

**Before** — any tall `LabBottomSheet` (here a 40-row picker) did the same.

![Before: tall menu sheet over the status bar](03-before-tall-menu.png)

**After** — same shared fix (`LabModalSheet`).

![After: tall menu sheet below the status bar](04-after-tall-menu.png)

**After, dark theme.**

![After: character sheet, dark](05-after-char-sheet-dark.png)

**After** — a tall `LabFormSheet`: title below the status bar, the list scrolls, Add card pinned at the bottom.

![After: tall form sheet](06-after-tall-form.png)
