# Lab app — package C: Decks tab, deck page, card editor, card hub

Roborazzi renders at the Pixel Fold's folded size (412dp) unless noted.

![Decks tab](decks-01-list.png)
The deck queue in study order: #N badge (tap → move menu), due counts in the queue colours, Study / +10 More / Done ✓.

![Drag in progress](decks-02-drag-lifted.png)
Press and hold lifts a deck; the list reflows under the finger (parity-tested hit-test).

![Search](decks-03-search-results.png)
Local search (toneless pinyin works) with recent ratings per card type and mastery.

![Server fallback](decks-04-search-server-fallback.png)
Nothing on the phone → the server's matches, saying how many cards the phone holds.

![Empty](decks-05-empty.png)
No decks yet: create, starter deck, or generate.

![New deck](decks-06-new-deck-sheet.png)
New deck sheet (Generate with Claude / Starter Chinese / empty deck).

![Deck page](decks-07-deck-page.png)
Deck page from Room: Study · N due, progress per card type, words by mastery with ratings and ▶.

![Selection](decks-09-deck-select.png)
Long-press a word to select several: move to another deck or regenerate audio.

![Generating audio](decks-10-deck-generating-audio.png)
⋯ → Generate missing audio, one word at a time with progress.

![Deleted deck](decks-12-deck-deleted.png)
A deck deleted elsewhere says so.

![Edit card](decks-13-edit-card.png)
The card editor sheet (⋯ holds card page, move, generate audio, delete).

![Card standard refusal](decks-14-edit-card-refused.png)
The card standard's hard rules are checked on the phone — same sentence as the server, offline too.

![Move to deck](decks-16-move-to-deck.png)
Move to another deck; cards and history move with the word.

![Deck settings](decks-17-deck-settings.png)
Name, description and the deck's caps on the daily budget (validated like pickDeckSettings).

![Card hub](cards-01-hub.png)
/cards/:noteId — the note, its three cards, flags with the tutor's reply, Claude threads, recent reviews.

![Card hub offline](cards-02-hub-offline-from-phone.png)
Offline before the hub was ever loaded: the phone answers the note, cards and reviews.

![Unfolded](decks-19-unfolded.png)
Unfolded (841dp): the column caps at 720dp.

![Dark](decks-20-dark.png)
Dark theme.
