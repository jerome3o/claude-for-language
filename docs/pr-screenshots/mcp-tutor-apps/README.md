# MCP Apps for tutors — screenshots

Captured from the built bundles (`mcp-server/dist/<app>/index.html`) with the
`window.__MCP_APP_PREVIEW__` hook and sample data (a 小明 student, a restaurant
reader, a weather lesson, a 餐厅点菜 deck). Phone shots are 412×915; wide shots
1024px. Illustrations are placeholder SVGs standing in for the R2 images.

## Students dashboard (`open_students_dashboard`)

![Dashboard, phone](01-dashboard-phone.png)
One card per student: status line, pills, words that need attention, setup checklist for a new student, quick actions and Ask Claude chips; pending invites and homework decks below.

![Dashboard with 小明 expanded, phone](02-dashboard-expanded-phone.png)
Expanded card: needs-attention words with the wrong answers typed and a Heard button on their recordings, the recordings inbox (Listened / Needs work + comment), homework decks with progress bars, lessons and recent days.

![Log a lesson sheet, phone](03-dashboard-log-lesson-phone.png)
Log lesson sheet (date-time + notes that also land in the student's lesson notes).

![Dashboard in dark theme, phone](04-dashboard-dark-phone.png)
Dark theme (host `data-theme` / style variables).

![Empty dashboard, phone](05-dashboard-empty-phone.png)
No students yet.

![Dashboard, wide](06-dashboard-wide.png)
1024px layout with a student expanded; invites and homework decks side by side.

## Review reader (`review_reader`)

![Reader, phone](07-reader-phone.png)
Page by page: large Chinese, pinyin, English, illustration (or "on its way" when only the prompt exists), vocabulary used, Ask Claude to revise.

![Reader in edit mode, phone](08-reader-edit-phone.png)
Edit mode: titles / level / topic, per-page Chinese, pinyin, English and illustration prompt, move / duplicate / insert / delete pages, Save with inline validation problems.

![Send reader to a student, phone](09-reader-send-phone.png)
Student picker (already-shared students are flagged).

![Reader in dark theme, phone](10-reader-dark-phone.png)
Dark theme.

![Reader, wide](11-reader-wide.png)
1024px: illustration beside the text.

## Review lesson (`review_lesson`)

![Lesson, phone](12-lesson-phone.png)
All nine exercise types rendered: note + sentences, multiple choice with the answer marked, word order, translate, listen & pick (played sentence shown to the tutor), listen & translate, match pairs, describe picture, speak; assignments with up-to-date / behind; Ask Claude to revise.

![Lesson in edit mode, phone](13-lesson-edit-phone.png)
Edit mode: every field editable, options / sentences / pairs as row editors with the correct answer tick, add exercise by type, reorder and remove.

![Assign lesson sheet, phone](14-lesson-assign-phone.png)
Multi-select student picker (students who already have it are disabled).

![Lesson in dark theme, phone](15-lesson-dark-phone.png)
Dark theme.

![Lesson, wide](16-lesson-wide.png)
1024px layout.

## Review deck (`review_deck`)

![Deck, phone](17-deck-phone.png)
Word rows with play, hanzi, pinyin, English and example sentence; which students have the deck; filter; Ask Claude chips.

![Deck with a row being edited and a new word, phone](18-deck-edit-row-phone.png)
Inline row editor (Save / Cancel / Delete) and the "Add word" row.

![Send deck to a student, phone](19-deck-send-phone.png)
Student picker: Send, or Update copy when the student already has it (with the number of new words).

![Deck in dark theme, phone](20-deck-dark-phone.png)
Dark theme.

![Deck, wide](21-deck-wide.png)
1024px: table layout.
