# Paste a word list — add or update many words at once

Phone viewport 412×915 at 2× unless noted. A tutor's deck "HSK 1 · 水果 Fruit" (three words, shared with the student Anna). Claude's answer to the "Fill in English" call is mocked in the capture script (no API key in the container); the layout and states are real.

![Deck page with the new Paste list button next to Add word](01-deck-buttons.png)
The deck page: **📋 Paste list** next to **+ Add word** (also in the empty-deck state).

![The empty paste sheet with its placeholder explaining the accepted formats](02-empty.png)
The empty sheet. The placeholder shows the three shapes it takes: spreadsheet columns, "苹果 apple", or bare characters.

![Preview after pasting six mixed rows: detected separators, policy select, grouped rows with New / Update / No Chinese chips](03-preview.png)
Straight after pasting: "Detected: tab between columns · 6 rows", the policy for words already in the deck, and the rows grouped as Needs attention / Updates / New words. 香蕉 shows the change it would make (english: ~~banana~~ → banana (the fruit)); 葡萄 and 草莓 had only characters, so pinyin was filled in on the device (✨) and they need English.

![After Fill in English with Claude: the two bare words now carry ✨ glosses and count as New](04-filled.png)
After **✨ Fill in English with Claude**: the bare words are complete and counted in the button. Anything filled in stays marked ✨ until it is edited.

![The Not parsed right? options: separator pills for columns and rows](05-options.png)
**Not parsed right?** opens the overrides: Auto / Tab / Comma / Space / | / – : / Custom between columns, New line / Semicolon between words.

![A row expanded into inline hanzi / pinyin / English / sentence inputs with a Skip this row checkbox](06-edit-row.png)
Tapping a row opens it for editing (hanzi, pinyin, English, optional example sentence) with **Skip this row**.

![Words saved: Added 3, updated 1, and Anna's copy listed with 3 new · 1 changed waiting and an Update their copy button](07-done.png)
After saving: the counts, a note that audio and sentences are generated in the background, and — for a tutor — each student's copy with what it is missing.

![Anna's row now reads added 3, updated 1 — their progress is kept](08-student-updated.png)
**Update their copy** pushes the new words and the tutor's edited text into the student's deck; review history and scheduling are untouched.

![Desktop width: the same preview in a wider dialog with the policy select and Claude button side by side](09-desktop-preview.png)
1100 px wide: the same sheet as a centred dialog.
