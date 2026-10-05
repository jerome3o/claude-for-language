# Homework: assignments, due dates and the one-off pass

Status: implemented — the model, the student side and direct assigning (#398), then the tutor's lesson-notes →
draft → review → assign flow. The tutor UX is deliberately a first cut — Jerome will give feedback.

Why: Minghui asked to (5) split homework over days when it is too much, (6) add a word list without it
being "today's homework", (7) set a deadline, (8) not send words the student already has. Before this,
everything a tutor sent landed in the student's FSRS queue and nothing had a date.

## 1. The model

An **assignment** is "this thing, for this student, done this way, by this date".

```
assignments                        assignment_events (append-only, idempotent by id)
  id                                          id            client uuid
  relationship_id, tutor_id, student_id       assignment_id
  batch_id     items assigned together        student_id
  kind         'deck' | 'lesson' | 'reader'   item_id       note id (deck) / target_id (lesson, reader)
               (free text: future kinds)      result        'right' | 'wrong' | 'done'
  target_id    the STUDENT's copy             created_at    when it happened on the device
  source_id    the tutor's master
  title
  mode         'one_off' | 'fsrs' | 'both'
  due_date     'YYYY-MM-DD' (student's calendar day; NULL for fsrs-only)
  item_ids     JSON note ids of the student's copy this part covers (NULL = all)
  item_count
  part_index, part_count   split plan: part 2 of 3
  status       'active' | 'done' | 'cancelled'
  done_count, completed_at, created_at, updated_at
```

- **mode** — `one_off`: a single pass, not spaced repetition. `fsrs`: long-term review (what "send a deck"
  always did). `both`: a one-off pass by the due date AND long-term review.
- **What "one-off" means per kind**
  - deck / word list: the student sees each word once, marks *Got it* / *Not yet*; *Not yet* words come back
    at the end of the pass until they are right. Done when every item has a `right` event. The pass writes
    **homework events only, never review events** — in `both` mode it is NOT the first FSRS review; the words
    are introduced later by the daily budget like any other deck (decision 1 in §7).
  - lesson / reader: complete it once (a `done` event). The existing player records its usual completion
    event too, so for a single lesson / reader in `both` mode the pass is also its first FSRS review (one item,
    no pile-up — decision 1 is about words).
- **How the modes are made real** (no new columns on decks / lessons / readers):
  - deck `one_off`: the student gets a normal copy (notes, audio, sentence sets sync as usual) with its
    per-deck caps set to **0 new + 0 secondary**, so the FSRS budget never introduces it. The deck page
    says so and offers *Add to my daily review* (caps back to the defaults). `fsrs` / `both`: a normal copy
    at the top (`core`) or bottom (`non_urgent`) of their queue — exactly the old share.
  - lesson / reader `one_off`: a normal copy; the client leaves any target of a `one_off` assignment out of
    the study-session lesson mix and the daily-reader pick.
- **Split over N days** (`split_days`): one deck copy, N assignments, each covering a consecutive slice of
  the words (`item_ids`), due on consecutive days from the first due date (`splitIntoDays`).
- **Due labels** (`dueLabel`): `overdue` · `due today` · `due in 1 day` · `due in N days`. Overdue items stay
  on the list, first, in red; nothing expires on its own — the tutor can move the date or cancel.
- Completion: the client computes progress from its local events; the server recomputes `done_count` /
  `status` from the uploaded events (same pure `passProgress`), so the tutor sees it after the next sync.

Pure logic lives in `shared/homework/` (unit-tested): `due.ts` (dates, labels), `split.ts`, `pass.ts`
(pass order + progress), `dedupe.ts` (normalised-hanzi matching), `load.ts` (the load gauge), `plan.ts`
(draft plan defaults + how a plan turns into assignments).

## 2. Contract for other features (e.g. new lesson / exercise types)

**Stable. Build on it; don't build a second queue.**

- Anything a tutor sends is an assignment `{ kind, target_id }` with a `mode` and (for one-off) a
  `due_date`, created through `POST /api/relationships/:relId/homework` (or the draft flow below).
- `kind: 'lesson'` covers every custom-lesson exercise type, present and future: new exercise types live
  inside the lesson spec (`shared/lesson`), so they are assignable one-off (with a due date) or into FSRS
  (the existing `custom_lessons` completion-event scheduling) with no change here. A future top-level kind
  (e.g. `'quest'`) needs: a copy function in `worker/src/services/homework.ts` (`copyTargetForStudent`), a
  player for the pass in `frontend/src/pages/HomeworkPassPage.tsx`, and, if it has its own rotation, the
  one-off exclusion (`oneOffTargetIds()` in `frontend/src/services/homework.ts`).
- The lesson-types work adds exercise types, the catalogue and per-attempt review — it must not add its own
  one-off / due-date queue. A lesson finished anywhere (pass or study session) completes its homework:
  `completeCustomLesson` records the `done` homework event for any assignment on that lesson.

## 3. Student experience (offline-first)

- Sync (`services/homework.ts`, called from the normal sync): upload unsynced `homeworkEvents`
  (`POST /api/me/homework/events`, idempotent), then `GET /api/me/homework` → IndexedDB
  `homeworkAssignments` (+ server events from other devices). Everything below works offline.
- **Home**: ONE compact card (web `components/home/HomeworkHomeCard.tsx`, Lab `ui/homework/HomeHomework.kt`;
  rows from the shared `homeHomework`, `shared/homework/home.ts`, parity-tested) headed "From <tutor>" — one slim
  row per active item: title, "5 / 12" words (thin bar) and a due label (overdue · due today · **due tomorrow** ·
  due in N days). One-off / both items come first, overdue first; then a lesson the tutor sent outside an
  assignment ("next session"). A long-term (fsrs-only) deck is NOT a row — it is a deck in the queue (Home's
  "Next up", the Decks tab; §11). A tap opens the pass `/homework/:id` for one-off / both items (for a lesson /
  reader that IS its player), `/lessons` for a legacy lesson. At most 4 rows ("+N more ›" → `/homework`); an unread tutor message is one
  small line. Nothing active → the card is not shown.
- **`/homework`**: all items (to do / done), **`/homework/:id`**: the pass. Deck: the word (tap ▶ for
  audio), *Show* reveals pinyin / meaning / the example sentence, then *Not yet* / *Got it*. The example
  sentence is the study card's sentence row, kept calm (web `SentenceSet variant="pass"`, Lab
  `PassSentences` → `SentenceRowView`): the Chinese is up, ▶ plays it, a tap adds the pinyin, the next the
  English and the tools line — "What's going on here?" (the same word-by-word breakdown: one word per row,
  each tappable to add as a card, then the construction; a breakdown already on the device — study card,
  Coach — shows at once, offline) and *+ Add as card*. The note's generated set waits behind
  "+ N more sentences". No header, EN exercise or generating; nothing there records a review or a homework
  event. A progress line; a
  celebration at the end, and for a one-off-only deck *Add these words to my daily review*. It is laid out like a
  study card: the card fills the space under the header (the Lab app flips it to the answer like study), and the
  actions sit in one bottom slot within thumb reach, above the system navigation bar. Lesson: the
  regular lesson player. Reader: the regular reader.
- FSRS enrolment is whatever the tutor chose; the student can still add a one-off deck to daily review.

## 3a. "Add to my long-term review" (per word)

On the answer side of each word in a pass there is a compact switch — **Add to my long-term review** /
**In my long-term review** (web `components/homework/LongTermSwitch.tsx`, Lab `ui/homework/LongTermSwitch.kt`).
It lets the learner filter what reaches FSRS:

- in a `both` pass it starts **on** — switch off the words that are too easy, they never enter daily review;
- in a `one_off`-only pass it starts **off** — switch on a word to really learn it, it joins daily review.

The choice is stored on the student's copy of the note, `notes.long_term` (migration `0096_note_long_term.sql`):
`NULL` = follow the deck (a one-off copy, caps 0 + 0, never introduces it; any other deck does), `1` = opted in,
`0` = opted out. Flipping the switch back to the deck's default stores `NULL` again (so *Add these words to my
daily review* on a one-off deck still takes every word not singled out). Rules, all pure in
`shared/decks/long-term.ts` (Lab `core/…/LongTerm.kt`, parity-tested through `parity/fixtures/long-term.ts`):

- **Opted out** (`0`): the note's NEW cards never enter the new-card pools — not the primary or secondary budget,
  not *Study 10 more*, not "words to go". Only for words not met yet: once any card of the note has been reviewed
  the choice is ignored and the switch shows *✓ Already in your reviews* (disabled) — the pass never suspends
  existing reviews.
- **Opted in** (`1`) in a deck out of daily review (both caps 0): the deck's pool holds only its opted-in words,
  with the new-deck default caps (3 + 6), in the deck's queue position — still inside the ONE global budget, and
  "new characters first" still orders them.
- The queue applies it in `selectStudyQueue(..., longTerm)` (`shared/decks/study-queue.ts`); the web's counts
  (`countRawQueues`) and every Lab `StudyQueue.build` use the same rule, so Home, the deck rows and the session agree.
- Offline-first: the web writes the note + `pendingNotePrefs` (Dexie v25) and `PUT /api/notes/:id/long-term`
  `{ long_term: true | false | null }` now or on the next sync (`services/longTerm.ts`); the Lab writes Room
  `notes.longTerm` (v3) and the Outbox (`data/homework/LongTermStore.kt`). A sync that rewrites notes re-applies
  the choices not uploaded yet. The server sets `long_term_at`, not `updated_at` (a choice must not make the
  student's copy look edited to *Update their copy*); `/api/sync/changes` sends notes changed by either.
  Copies (share / update) never carry it.
- The finish screen says what happened: "12 words added to daily review · 4 left out" (a `both` pass), or for a
  one-off pass where some were switched on "3 words added…" plus *Add them all to my daily review*.
- The card hub (`/cards/:noteId`) shows the same switch for the owner. The tutor's packet row on the student
  page says "· N left out by the student" and those words are not counted in "N to go"
  (`notes_left_out`, `fetchHomeworkDecks`).

## 4. Tutor flow (student page)

1. **Lesson notes** (replaces "Session notes"): one entry per lesson — date, title, and its homework
   state: *Drafting…* → *Draft ready · Review* → *Assigned · 3/5 done* (or *Failed · Retry*).
   *+ Add lesson notes*: date, title, notes, and "Draft homework from these notes" (on by default).
   An entry is a `tutor_lesson_log` row (+ `title`); the draft is a `tutor_note_jobs` row with `review = 1`,
   linked by `lesson_log_id`.
2. The session-notes agent (`tutor-notes-queue`, `runTutorNotesJob`) builds the draft in the tutor's
   account exactly as before — deck, lesson only for a taught structure, reader only when asked — but in
   review mode it **never sends**; it also writes a default **plan**.
3. **Review** (`/connections/:relId/homework/:jobId`):
   - **Load gauge** — what the student already has: one-off items pending (words), overdue, words still to
     come in long-term review and ~days at their daily budget; light / moderate / heavy; and the same after
     this draft.
   - **Words** — the draft deck; words the student already has (matched on normalised hanzi, like
     `check_student_words`) are skipped automatically and listed ("Skipped 4 words they already have"), each
     with *Include anyway*. × removes a word from the draft.
   - Per item (words / each lesson / reader): *One-off by <date>*, *Long-term review*, or *Both*; include.
   - **Spread over N days** for the words: Day 1 due Tue · 6 words, Day 2 due Wed · 6 words …
   - **Claude side panel**: "drop the food words", "split into two days", "add a listening lesson". Each
     message continues the SAME agent job (transcript, tools, checkpoints) with extra draft tools
     (`remove_cards`, `update_card`, `set_plan`); its `finish` summary is the reply.
   - **Assign** → assignments are created (dedupe re-checked server-side), the job is marked assigned.
4. **Homework section**: the one-off headline (§11), the one-off assignments with due labels and progress
   (overdue in red), decks sent one-off only, lessons and readers. Long-term decks are in their own, quieter
   **Long-term learning** section (§11). *Send homework* (deck or library lesson) gets the same mode + due
   date choice — defaulting to *Both* (see §4a).

## 4a. Defaults when a tutor sends something

Everywhere a tutor sends a deck, lesson or reader outside a draft, it starts as **`both`** — a one-off pass by
a due date, then long-term review (`DEFAULT_SEND_MODE`, `shared/homework/plan.ts`) — and the tutor can switch
to One-off or Long-term before sending:

- the **Send homework sheet** (web `SendHomeworkSheet.tsx` + `sendHomework.ts`, Lab `ui/teaching/SendHomeworkSheet.kt`
  `sendDefaults`) — decks and library lessons; split over days and "leave out words they already have" as before;
- the **library Assign sheet** (web `LessonLibraryPage.tsx` `AssignSheet`, Lab `ui/library/AssignSheet.kt`);
- the MCP tools **`share_deck_with_student`, `create_deck_for_student`, `assign_lesson_to_students`,
  `share_reader_with_student`** and the MCP Apps' send buttons (`app_share_deck`, `app_assign_lesson`,
  `app_share_reader`): all go through `POST /api/relationships/:relId/homework`
  (`mcp-server/src/tools/homework-send.ts`) with optional `mode` / `due_date`, so they create real
  assignments. `priority` still decides where the long-term copy lands; `skip_known` (default true) leaves
  out words the student has. The API returns `copies` (the student's copy + share id per item) so
  `shared_deck_id` keeps working for `add_words_to_student_deck`. `assign_lesson_to_students` still leaves
  a student who already has a copy alone (`already_had`).

**Default due date** (`defaultHomeworkDueDate`, ported to Kotlin as `HomeworkPlan.defaultHomeworkDueDate`
and parity-tested): the student's **next logged lesson** — the earliest lesson-log day after today, at most
`NEXT_LESSON_WINDOW_DAYS` (14) ahead (a lesson notes entry dated in the future counts) — else **in two days**
(`DEFAULT_DUE_IN_DAYS`, the same as drafts and the API's own fallback). The sheet offers it as a
"Next lesson · Thu 1 Oct" chip; the library Assign sheet, which sends to several students at once, uses the
two-day fallback. Existing assignments and the draft plan defaults (§7.3) are unchanged.

## 5. API

Student:
- `GET /api/me/homework` → `{ assignments, events }` (all non-deleted assignments, newest 500; events of
  active ones).
- `POST /api/me/homework/events` `{ events: [{ id, assignment_id, item_id, result, created_at }] }` →
  `{ accepted, assignments }` (recomputed rows).

Tutor (relationship's tutor only):
- `GET /api/relationships/:relId/homework?today=YYYY-MM-DD` → `{ assignments, load }`.
- `POST /api/relationships/:relId/homework` `{ items: [{ kind, source_id, mode, due_date?, split_days?,
  priority?, skip_known?, include_known? }], today? }` → `{ assignments, skipped, errors, copies }` (copies to
  the student + rows; `copies[]` = `{ kind, source_id, target_id, target_name, share_id }`).
- `PATCH /api/relationships/:relId/homework/:id` `{ due_date?, status?: 'cancelled' }`.
- `GET|POST /api/relationships/:relId/lesson-notes` — entries with their draft job; POST `{ notes, title?,
  lesson_at?, draft?: true }`. `POST …/lesson-notes/:logId/draft` — draft homework from an entry.
- `GET /api/relationships/:relId/homework-drafts/:jobId` → the draft view (words with `known`, lessons,
  reader, plan, chat, load now / after). `PUT …/plan` `{ plan }`. `POST …/messages` `{ message }` → 202
  (the agent revises). `POST …/assign` → `{ assignments }`.
- **Taking it back** (`routes/homework-removal.ts`): `DELETE /api/relationships/:relId/shared-decks/:id`
  (`?delete_source=1`), `DELETE …/student-lessons/:lessonId`, `DELETE …/shared-readers/:id`, each with a
  `GET …/removal` preview. Deletes only the student's COPY of what this tutor sent (tombstones reach their
  devices), drops the share row and cancels the assignments that pointed at it (the student's Homework card
  drops them on sync). MCP: `remove_student_deck`, `remove_student_lesson`, `remove_student_reader`.

MCP (tutor, `mcp-server/src/tools/homework.ts`): `get_student_homework`, `assign_homework`,
`update_homework_assignment`, `add_student_lesson_notes`, `get_homework_draft`, `revise_homework_draft`,
`update_homework_draft_plan`, `assign_homework_draft`; and the send tools of §4a, which create assignments too.

## 6. Migration of existing homework

Nothing to convert: every deck / lesson / reader already sent IS long-term (`fsrs`) homework and keeps
working unchanged; `shared_decks`, the library assign and `share-reader` stay as they are. Assignments are
created only from now on (new API, Send homework, drafts, the MCP send tools). Old session-notes jobs (`review = 0`) keep
auto-sending; `submit_session_notes` is unchanged. Migration `0073_homework.sql` only adds the two tables (named `assignments` / `assignment_events` because the
unused legacy reader-homework table `homework_assignments` of migration 0024 still exists; it is left alone),
`tutor_lesson_log.title` and `tutor_note_jobs.review / plan / chat / assigned_at`.

## 7. Decisions (Jerome, 27 Sep 2026)

These were the open questions of the first cut; the code matches each answer.

1. **In `both` mode the one-off pass does NOT count as the first FSRS review.** Counting it would drop every
   word of the pass into long-term review at once — a tsunami of reviews a few days later. The pass writes only
   `assignment_events` (`recordPassEvent`); the words keep their NEW cards and are introduced later at the daily
   budget's pace (a `both` deck copy keeps its normal caps; only a `one_off`-only copy is capped at 0 + 0).
   Tested: `frontend/src/services/homework.test.ts` ("a word pass is not an FSRS review"),
   `worker/src/services/__tests__/homework.test.ts` ("leaves a both / fsrs deck in the FSRS budget").
2. **Overdue one-off items stay overdue** — no expiry and no automatic roll into long-term review, for now.
   They stay on the list, first, labelled *overdue* in red, until done; the tutor can move the date or cancel.
   There is no sweeper or cron touching `assignments.status`.
3. **Draft defaults stay as they are, provisionally**: words `both`, due in 2 days (`DEFAULT_DUE_IN_DAYS`,
   `DEFAULT_MODE` in `shared/homework/plan.ts`); lessons and readers `one_off`; the load gauge's
   light / moderate / heavy thresholds (`LOAD_THRESHOLDS` in `shared/homework/load.ts`: heavy at 2 overdue items,
   40 one-off words or 30 days of long-term words to go; moderate at 1 overdue, 15 words, 4 items or 10 days).
   Expect to tune them once Minghui has used the flow for a few weeks.

## 8. Link homework

A homework kind for things outside the app: a YouTube video, a song, a TV-drama clip, an article. Nothing is
hosted or embedded — the app only links out (a YouTube link shows its public thumbnail, `i.ytimg.com`, no API call).

- **Tutor-first**: a link is created in the TUTOR's account (`homework_links`: title, url, instructions) and nothing
  reaches a student until she sends it. Sending = an assignment `kind: 'link'`, `mode: 'one_off'`,
  `source_id = target_id = <link id>`, due date optional (`null` = no due date), `item_count` 1. The assignment keeps
  a snapshot in `assignments.details` (`{ url, instructions, thumbnail_url }`), so editing or deleting the tutor's
  link never breaks the student's homework; saving an edit offers to update the sent copies (§10).
- **Student**: the link shows on Home's "From <tutor>" card and `/homework` like any item (🔗). `/homework/:id` is
  the link page: title, site, thumbnail, instructions, **Open link ↗** (external browser), then **Mark as done** with
  an optional note back to the tutor. Done = a `done` event with `note` (`assignment_events.note`), offline-first like
  every pass event.
- **Tutor**: the homework library shows its status and the student's note.
- Pure helpers: `shared/homework/link.ts` (`normalizeLinkUrl`, `youtubeVideoId`, `linkThumbnail`, `linkSiteName`,
  `pickLinkHomework`, `cleanLinkNote`).
- API: `GET|POST /api/homework-links` (`{ title, url, instructions? }` → 201 `{ link }`, 400 + `problems`),
  `PUT /api/homework-links/:id` (any subset; `update_student_copies?: boolean | string[]` relationship ids),
  `DELETE /api/homework-links/:id` (soft; sent copies stay). Send with the usual
  `POST /api/relationships/:relId/homework` `{ items: [{ kind: 'link', source_id, mode: 'one_off', due_date? }] }`.
  Student: `POST /api/me/homework/events` events may carry `note` (≤ 1000 chars).
- MCP: `create_link_homework` (creates only), `assign_link_homework` (sends to one or more students).

## 9. The homework library

One row per thing a tutor sent a student — deck copy, lesson, reader, link — built from the share rows plus the
assignments on the same copy (`buildHomeworkLibrary`, `shared/homework/library.ts`). Each row: sent date, due date,
kind, progress % and status — **Completed** (green) · **In progress** (blue; amber when due today / tomorrow) ·
**Overdue** (red) · **Not started** (grey). Progress maths:

| kind | % | complete when |
|---|---|---|
| deck with a pass (one_off / both) | pass words right / words in the pass (all day-parts) | every part done |
| deck, long-term only (fsrs / shared before assignments) | — status **In long-term review** (grey, no %); progress "8 / 20 words met" | never: it is a deck in the queue (§11) |
| lesson | 0 / 100 | completed once (or its assignment done) |
| reader | 0 / 100 | read once (or its assignment done) |
| link | 0 / 100 | the student marked it done |

Overdue = not complete and the open due date (earliest unfinished one-off part) is before today. The Lab app ports
`libraryStatus`, `statusTone`, `filterLibrary`, `mostRecentHomework`, `libraryDueText` (core `HomeworkLibrary.kt`,
parity-tested).

- Pages: `/connections/:relId/homework` (one student) and `/homework-library` (all students), filters by status and
  kind; per row: Open, Edit, Update their copy, Change due date (the row's `due_assignment_id`), Remove (the existing
  take-back flow; a link = cancel). Linked from the student page and the Students dashboard.
- **Most recent homework**: the top of the student page shows `mostRecentHomework` (the newest item + whatever was
  sent within 30 min, max 3) with %, due date and the status colour; the dashboard card shows the newest one compactly.
- Students: `/homework` shows the same status chips on their own items (computed on the device with `libraryStatus`).
- API (tutor): `GET /api/relationships/:relId/homework-library?today=` → `{ items, counts, today }`;
  `GET /api/tutor/homework-library?today=` → `{ students: [{ relationship_id, student_id, student_name }], items, counts, today }`.

## 10. Updating students' copies when the tutor edits

Editing something already sent offers **Also update <student>'s copy** per student, default on — the web deck page
(after a word is added / edited), the lesson editor and reader editor (after Save), the link editor, the Lab's
equivalents and the MCP update tools (`update_student_copies: true`, set only when the tutor asked — it is a send). One API for all of them:

- `GET /api/student-copies?kind=deck|lesson|reader|link&source_id=` → `{ copies: [{ relationship_id, student_id,
  student_name, target_id, share_id, behind }] }` (the caller's own sources only; active relationships).
- `POST /api/student-copies/update` `{ kind, source_id, relationship_ids? }` → `{ updated, results: [{ relationship_id,
  student_name, ok, detail, error? }] }`. Deck = `updateSharedDeckCopy` (new words added, edited text copied, progress
  kept); lesson = the library push-update (same lesson ids, history + FSRS kept); reader = `updateSharedReaderCopy`
  (pages matched by position, the copy's page ids kept, so reading progress survives; pictures share the R2 keys);
  link = the sent assignments' title + details.

## 11. The homework headline counts one-off homework only

Jerome (Oct 2026), after a lesson, saw "Homework 13%": he was 13% through a long-term deck the FSRS budget will
take months to introduce, although he had done every one-off item that week. The old figure blended mastered + ½
started cards + completed lessons over everything the tutor ever sent. Now:

- **The headline** (`summarizeOneOffHomework`, `shared/homework/summary.ts`, unit-tested) counts the ONE-OFF pass of
  `one_off` and `both` assignments (decks, lessons, readers, links) and nothing else. Open = active one-off
  assignments (overdue ones stay open); done = one-off assignments finished in the last 7 days
  (`SUMMARY_WINDOW_DAYS`; by `completed_at`, else the due date), so "2 of 3 done" is about this week. Words:
  **"✓ All done this week"** (nothing open, something finished lately) · "✓ All done" · **"2 of 3 done"** ·
  **"1 overdue · 2 of 3 done"** · "No homework set" (nothing one-off ever sent — never "0%"). The pill says
  "Homework ✓ all done this week" / "Homework 2 of 3 done" / "Homework 1 overdue" (green / blue / red).
- **Where**: the worker puts it on the student overview (`services/tutor-dashboard.ts`: `pills.homework`,
  `homework.one_off`; `pills.homework_percent` / `homework.percent` = the same as 0..100 for older clients), so the
  tutor's dashboard card, the student page's Homework heading, the Lab app and the MCP tools (`list_students`,
  `get_student_overview`, the Students dashboard app) all show the same words. Days are the student's (tz offset).
- **Long-term learning**: a deck sent for long-term review only (fsrs, or shared before assignments) is
  `long_term` (`isLongTermDeck`; a copy whose assignments are all `one_off` is not). On the tutor's student page those
  decks are a separate, quieter **Long-term learning** section — the student's daily budget, then per deck words met,
  ~days to go at the budget and the queue position (#N menu) — "not counted as homework". In the homework library
  they get the neutral status **In long-term review** instead of In progress / a percent. For the student they are
  simply decks in the queue (Home's "Next up", the Decks tab); Home's homework card no longer lists them.
- The Lab app follows the same rules (dashboard pill and student page from the server's summary; core
  `HomeworkLibrary.kt` / `HomeHomework.kt` parity-tested).
