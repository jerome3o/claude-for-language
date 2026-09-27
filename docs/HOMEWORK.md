# Homework: assignments, due dates and the one-off pass

Status: the model, the student side and direct assigning (Send homework, MCP) are live; the tutor's lesson-notes →
draft → review flow (§4 steps 1–3) follows in a second PR. The tutor UX is deliberately a first cut — Jerome will
give feedback.

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
    at the end of the pass until they are right. Done when every item has a `right` event.
  - lesson / reader: complete it once (a `done` event). The existing player records its usual completion
    event too, so in `both` mode the pass is the first FSRS review.
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
- **Home**: a *Homework* card lists the one-off items not yet done — overdue first, then by due date — each
  with its label, "12 words · 5 left" and **Start**. Nothing due → the card is not shown.
- **`/homework`**: all items (to do / done), **`/homework/:id`**: the pass. Deck: the word (tap ▶ for
  audio), *Show* reveals pinyin / meaning / sentence, then *Not yet* / *Got it*; a progress line; a
  celebration at the end, and for a one-off-only deck *Add these words to my daily review*. Lesson: the
  regular lesson player. Reader: the regular reader.
- FSRS enrolment is whatever the tutor chose; the student can still add a one-off deck to daily review.

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
4. **Homework section**: the one-off assignments with due labels and progress (overdue in red), plus the
   long-term decks / lessons as before. *Send homework* (deck or library lesson) gets the same mode + due
   date choice.

## 5. API

Student:
- `GET /api/me/homework` → `{ assignments, events }` (all non-deleted assignments, newest 500; events of
  active ones).
- `POST /api/me/homework/events` `{ events: [{ id, assignment_id, item_id, result, created_at }] }` →
  `{ accepted, assignments }` (recomputed rows).

Tutor (relationship's tutor only):
- `GET /api/relationships/:relId/homework?today=YYYY-MM-DD` → `{ assignments, load }`.
- `POST /api/relationships/:relId/homework` `{ items: [{ kind, source_id, mode, due_date?, split_days?,
  priority?, exclude_hanzi? }] }` → `{ assignments }` (copies to the student + rows).
- `PATCH /api/relationships/:relId/homework/:id` `{ due_date?, status?: 'cancelled' }`.
- `GET|POST /api/relationships/:relId/lesson-notes` — entries with their draft job; POST `{ notes, title?,
  lesson_at?, draft?: true }`. `POST …/lesson-notes/:logId/draft` — draft homework from an entry.
- `GET /api/relationships/:relId/homework-drafts/:jobId` → the draft view (words with `known`, lessons,
  reader, plan, chat, load now / after). `PUT …/plan` `{ plan }`. `POST …/messages` `{ message }` → 202
  (the agent revises). `POST …/assign` → `{ assignments }`.

MCP (tutor, `mcp-server/src/tools/homework.ts`): `get_student_homework`, `assign_homework`,
`update_homework_assignment`, `add_student_lesson_notes`, `get_homework_draft`, `revise_homework_draft`,
`update_homework_draft_plan`, `assign_homework_draft`.

## 6. Migration of existing homework

Nothing to convert: every deck / lesson / reader already sent IS long-term (`fsrs`) homework and keeps
working unchanged; `shared_decks`, the library assign and `share-reader` stay as they are. Assignments are
created only from now on (new API, Send homework, drafts). Old session-notes jobs (`review = 0`) keep
auto-sending; `submit_session_notes` is unchanged. Migration `0073_homework.sql` only adds the two tables (named `assignments` / `assignment_events` because the
unused legacy reader-homework table `homework_assignments` of migration 0024 still exists; it is left alone),
`tutor_lesson_log.title` and `tutor_note_jobs.review / plan / chat / assigned_at`.

## 7. Open questions for Jerome

- `both` for a deck: the pass does not write FSRS reviews, so the words are introduced again at the
  budget's pace. Should a *Got it* in the pass count as the first FSRS review instead?
- Should overdue one-off items ever expire / roll into long-term review automatically?
- Default modes in a draft: words `both` (due in 2 days), lesson and reader `one_off`. Right defaults?
