# ⚡ Study it today — screenshots (412×915, 2×)

## Web app

![Coach: a word I already have](01-coach-already-have.png)
Coach → Explain → tap 银行, which is already in HSK 2: the sheet says so and **⚡ Study it today** is the primary action (Add anyway second). Before this PR the sheet only said "This word is already in the selected deck." with "Add anyway".

![Coach: after bumping](03-coach-bumped.png)
After the tap: "⚡ 银行 will come first in today's study".

![Coach quick chip](02-coach-chip.png)
The quick-action row gets "⚡ Study today (2)" when words of the sentence are already cards (下午, 银行).

![Unchanged: a new word](00-add-new-word-unchanged.png)
A word I don't have yet: the sheet is unchanged (Add to deck).

![Home](04-home.png)
Home: "⚡ 1 bumped for today" under the Study button.

![Home breakdown](05-home-breakdown.png)
The ⓘ breakdown lists the bumped words first.

![Deck rows](06-deck-rows.png)
Deck page: a quiet ⚡ per word; "⚡ Today ✓" once bumped (tap again to take it out).

![Study card](07-study-card.png)
The session starts with the bumped word (first in the queue, before the budget's new words), with the "⚡ Today" badge. The e2e test checks the same with a budget of 0.

## Lab app (android-lab)

![Coach: the word is already a card](lab-01-coach.png)
The Coach's add-card sheet when 商店 is already a card: "⚡ Study it today" primary, "Add anyway" secondary.

![Reader word sheet](lab-02-sheet.png)
A reader word already in the decks: "⚡ Study it today" first.

![Home](lab-03-home.png)
Home: "⚡ 1 bumped for today" under the due line, plus the chip.

![Study card](lab-04-card.png)
A card from the pocket, bumped by the tutor: "⚡ from Minghui".

![Coach quick-action chip](lab-05-coach-chip.png)
The Coach's "⚡ Study today (2)" chip after tapping it.
