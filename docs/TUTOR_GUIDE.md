# 汉语学习 (Chinese Learning) — Guide for Tutors and Students

> 中文版本 / Chinese version: [TUTOR_GUIDE.zh-CN.md](./TUTOR_GUIDE.zh-CN.md)

This guide explains how to use the Chinese Learning app to teach and learn Mandarin
vocabulary. It is written for a **tutor** who wants to set homework and follow their
students' progress, and for the **students** who will study on their phones.

The app lives at **https://chinese-learning-2x9.pages.dev** and works in any browser.
Students mostly use it on a phone; tutors may prefer a laptop for adding vocabulary.

All screenshots in this guide were taken on a phone-sized screen. The red numbered
circles are explained in the text under each picture.

---

## Contents

1. [What the app does](#1-what-the-app-does)
2. [Getting started](#2-getting-started)
3. [The home screen](#3-the-home-screen)
4. [Core concepts: notes, cards, decks and spaced repetition](#4-core-concepts)
5. [Studying (the student's daily routine)](#5-studying)
6. [Managing vocabulary](#6-managing-vocabulary)
7. [For tutors: connecting with students](#7-for-tutors-connecting-with-students)
8. [For tutors: chat, homework decks and progress](#8-for-tutors-chat-homework-decks-and-progress)
9. [AI helpers: Ask Claude, Sentence Coach, Sentence Breakdown](#9-ai-helpers)
10. [Readers, Mini Lessons and Quests](#10-readers-mini-lessons-and-quests)
11. [Progress and statistics](#11-progress-and-statistics)
12. [Settings, backups and offline use](#12-settings-backups-and-offline-use)
13. [Suggested weekly workflow for a tutor](#13-suggested-weekly-workflow-for-a-tutor)
14. [Ideas for future features (not built yet)](#14-ideas-for-future-features-not-built-yet)

---

## 1. What the app does

- **Flashcards with spaced repetition.** Every word is tested three ways (see
  characters → say it; see English → type characters; hear audio → type characters).
  A scheduling algorithm (FSRS) decides when each card comes back, so students spend
  their time on the words they are about to forget.
- **Native-sounding audio** is generated automatically for every word and sentence.
- **Tutor ↔ student connections.** A tutor can chat with a student, send them a deck of
  homework words, and see exactly what they reviewed each day — including the answers
  they typed and the pronunciation recordings they made.
- **AI helpers** (powered by Claude) for generating decks, explaining sentences,
  correcting the student's own sentences, writing graded-reader stories and building
  small lessons and games.
- **Works offline.** Study sessions run entirely on the phone; reviews sync later.

---

## 2. Getting started

### Signing in

<img src="guide-images/splash.png" width="300">

The app is **invite-only**. The first time you sign in you need an invite; after that
you sign in normally.

1. **With an invite link (the usual way):** your tutor sends you a link like
   `…/join/abc…` or shows you a QR code. Open it on the phone you will study on,
   tap **Continue with Google** and pick your Google account. That is the whole
   sign-up: you land on the home screen already connected to your tutor, with any
   decks they chose for you ready to study.
2. **Without a link:** open https://chinese-learning-2x9.pages.dev and tap
   **Sign in with Google** (①). If your email has been invited (or approved by the
   admin) you are in. Otherwise you see *"This app is invite-only"* — ask your tutor
   for a link. The attempt is also noted for the admin, who can approve you; then
   simply sign in again.

Everyone — tutors and students — signs in the same way. There is no separate
"tutor account"; roles are set per connection (section 7). If an invite was sent to
a specific email and you signed in with a different Google account, you will see a
message saying so — switch accounts or ask for a new link.

### Installing on a phone (recommended for students)

The app is a *progressive web app*, so it can be installed like a normal app:

- **Android (Chrome):** open the site, tap the ⋮ menu → **Add to Home screen** /
  **Install app**.
- **iPhone (Safari):** tap the Share button → **Add to Home Screen**.

Once installed it opens full-screen, keeps working without internet, and remembers
the login.

There is also a native Android wrapper (APK) that adds a home-screen widget, a
"Sentence Coach" option in the text-selection menu of any app, and homework
notifications. See [native/README.md](../native/README.md) for how to get it.

### Recommended setup for a new student

1. Open the tutor's invite link on the phone, tap **Continue with Google**, then
   install the app (above). The connection to the tutor is already active.
2. If you signed in without a link, go to **Connections** and accept the tutor's
   request (or connect with the tutor by email).
3. Open **Settings → Offline Audio → Download All Audio** while on Wi-Fi.
4. Tap **Study All** on the home screen every day.

---

## 3. The home screen

<img src="guide-images/home.png" width="300">

1. **Profile menu** — your name, Settings and all the extra tools (see below).
2. **Notifications** — chat messages, connection requests, shared decks.
3. **Study streak** — consecutive days studied, with a heat-map of the last month.
4. **Study All** — starts a session with every card that is due today, across all decks.
   The coloured numbers are the queue counts: **blue** new cards, **purple** secondary
   new cards, **orange** learning cards, **green** review cards (explained in section 4).
5. **A deck card** — tap the name to open the deck. The thin bar shows how much of the
   deck has been seen / learned.
6. **Study (n)** — study just this deck.
7. **Pin** — keep a deck at the top of the list.
8. **New Deck** — create an empty deck.
9. **Generate** — have Claude write a deck from a description.
10. **Analyze** — the Sentence Breakdown tool.
11. **Search** — find any word across all decks.
12. **Connections** — tutors and students.

### The profile menu

<img src="guide-images/profile-menu.png" width="300">

1. **Settings** — bio, offline audio, backups, feature requests.
2. **Lesson Notes** — paste what the tutor sent after a lesson; used as context for AI features.
3. **Readers** — short graded stories built from the student's own vocabulary.
4. **Mini Lessons** — small agent-written lessons that appear during study.
5. **Sentence Analysis** — break a sentence into words with aligned pinyin/English.
6. **Sentence Coach** — check and correct a sentence the student wrote.
7. **Quests** — tile-map mini-games driven by Chinese instructions.
8. **Duplicate Finder** — find the same word added twice.
9. **Progress** — 30-day statistics and daily history.

Below those are maintenance items (Full Sync, Update App, debug tools) and Sign out.

---

## 4. Core concepts

### Notes and cards

A **note** is one vocabulary item: hanzi, pinyin (with tone marks — nǐ hǎo, not
ni3 hao3), English meaning, optional notes/fun facts, optional example sentence,
and generated audio.

Each note automatically produces **three cards**, one for each skill:

| Card type | The student sees | The student does |
|-----------|------------------|------------------|
| Hanzi → Meaning | the characters | says the word aloud (optionally records it), then reveals pinyin + meaning and rates themselves |
| Meaning → Hanzi | the English | types the characters; the app compares the answer character by character |
| Audio → Hanzi | hears the word | types the characters |

A **deck** is a group of notes (for example "Week 3 homework — weather"). Study can be
per deck or "Study All".

### Spaced repetition and the four ratings

After every card the student rates how it went:

| Rating | Meaning | What happens |
|--------|---------|--------------|
| **Again** (red) | forgot | shown again in ~1 minute, counts as a lapse |
| **Hard** (orange) | remembered with difficulty | shorter interval |
| **Good** (green) | remembered | normal interval |
| **Easy** (blue) | trivially easy | much longer interval; a new card skips the learning phase |

The buttons show the resulting interval (1m, 10m, 2d, …) so the choice is transparent.
The algorithm is FSRS, a modern scheduler that needs 20–30% fewer reviews than the
classic Anki algorithm for the same retention.

### Queues and daily limits

Every card is in one of four queues, and the coloured numbers all over the app count
them:

- **Blue — New**: never studied. Limited per deck per day (default **20**) so a big deck
  does not overwhelm the student.
- **Purple — Secondary new**: new cards of a word the student has *already started*
  (e.g. the typing card of a word they have seen as characters). Separate daily budget
  (default **10**) so all three skills keep advancing.
- **Orange — Learning**: recently introduced, drilling at minute-scale intervals.
- **Green — Review**: graduated cards due today.

Both limits are set per deck in **Deck Settings** (section 6). A tutor can set them to
whatever suits the student — for a slower student 10 + 5 is a good choice.

---

## 5. Studying

Tap **Study All** or a deck's **Study** button. The session shows every card due today
in one sitting, prioritising learning cards whose timer has expired, then a mix of new
and review cards.

### Front of a "Hanzi → Meaning" card

<img src="guide-images/study-front.png" width="300">

1. **Undo** the last rating.
2. **Offline toggle** — force on-device audio (useful on the train).
3. **End session**.
4. **Queue counts** for this session (blue + purple + orange + green). The underlined
   number is the queue the current card came from.
5. The word to say aloud.
6. **Use in Sentence** — reveals a generated example sentence to help recall.
7. **Record Your Pronunciation** — records the student saying the word. Recordings are
   saved with the review and the **tutor can listen to them** (section 8).
8. **Skip recording** — go straight to the answer.

### Back of the card

<img src="guide-images/study-back.png" width="300">

1. **Record Again** if the first attempt was poor.
2. **Generate Fun Fact** — Claude writes a memory aid / cultural note and saves it to the note.
3. **Generate sentences** — builds a set of graded example sentences for this word
   (easiest → hardest, each with audio). Sentences start hidden: tap to reveal hanzi,
   then pinyin, then English, so they double as a listening exercise. Each sentence has
   a "what's going on here?" breakdown and a **+** button to add it, or any word in it,
   as a new card.
4. **Play Audio** — replay the word.
5. **Ask Claude** — ask anything about this word (usage, grammar, similar words). Claude
   can also **edit the current card** and **create a mini lesson** from the chat. Questions
   and answers are saved to the note's history.
6. **Regenerate audio** with a different voice.
7. **Edit card** (pencil) — fix a typo, add alternatives, add a sentence clue.
8–11. **Again / Hard / Good / Easy**.

### Typing cards ("Meaning → Hanzi" and "Audio → Hanzi")

<img src="guide-images/study-typing.png" width="300">

1. Type the characters (any keyboard; pinyin input on the phone works well).
2. **Check Answer**. There is also a **Multiple Choice** button for when the student is
   stuck, and **Use in Sentence** for a hint.

<img src="guide-images/study-typing-result.png" width="300">

The typed answer is compared character by character — wrong characters are shown in
red above the correct answer, so the student sees exactly which character they mixed
up. Typed answers are saved and visible to the tutor.

If a word has several acceptable ways to write it, add them under **Acceptable
alternatives** when editing the card (section 6) and they will be marked correct.

### Between cards

- Every ~8 cards the session may slot in a **Mini Lesson** (if one is waiting) and at the
  end of the session it offers **today's Reader** story (section 10).
- Rating a card **Again** quietly prepares example sentences for it, so they are ready
  when the card returns a minute later.

### End of session

When all cards are done the **All Done!** screen shows a recap (cards reviewed, time,
rating breakdown) and today's totals — with confetti. A **Study More** button adds 10
bonus new cards for keen students.

Sessions save every review locally first, so nothing is lost if the connection drops.

---

## 6. Managing vocabulary

### The deck page

<img src="guide-images/deck-detail.png" width="300">

1. **Study** this deck (shows how many cards are due).
2. **Share with Tutor** — lets a connected tutor see progress on this deck (section 8).
3. **Settings** — name, description, daily limits and scheduling parameters.
4. **Delete** the deck.
5. **Generate All Audio** — appears if some notes are missing audio.
6. **Completion** — how much of the deck has been seen and mastered.
7. **Progress by card type** — mastered / familiar / learning / new for each of the three skills.
8. **Add Note** — add a word by hand.
9. The **note list** with the last few ratings for each word (coloured dots) and a mastery
   percentage. Tap a row to edit the card.

### Adding a word

<img src="guide-images/add-note.png" width="300">

1. **Hanzi** — simplified characters.
2. **Pinyin with tone marks** (nuǎn huo). Please do not use tone numbers.
3. **English meaning** — keep it short; add part of speech in brackets if useful.
4. **Fun facts / notes** — mnemonics, usage notes, regional notes (e.g. "东北话:
   …"). Optional.

Audio is generated automatically a few seconds after saving. An example sentence is
also queued in the background.

### Editing a card

<img src="guide-images/card-edit.png" width="300">

Tap a row in the note list. Besides the basic fields you can set:

- **Acceptable alternatives** — other correct answers for the typing cards, one per line.
- **Sentence Clue** — an example sentence shown on the card as a hint (with pinyin and
  translation; **Generate** fills them in). It gets its own audio.
- **Sentence Set** — the generated graded sentences (regenerate, delete).

### Deck settings

<img src="guide-images/deck-settings.png" width="300">

1. **Deck Info** — name and description.
2. **Learning** — **New cards per day** (blue budget) and **Secondary cards per day**
   (purple budget). Advanced scheduling parameters (desired retention, interval
   multipliers, maximum interval) are further down; the defaults are good for most
   students.

### Generating a deck with AI

<img src="guide-images/generate-deck.png" width="300">

Describe what to learn ("Vocabulary for taking the bus in Changchun", "HSK 2 verbs
about daily routine") and Claude generates 8–12 words with pinyin, meaning, fun facts
and audio. Review the words afterwards and delete any you don't want.

### Search, duplicates and moving words

<img src="guide-images/search.png" width="300">

**Search** (top bar) finds a word in any deck by hanzi, pinyin or English and shows its
recent ratings; from a result you can jump to the deck, edit or delete the card.

**Duplicate Finder** (profile menu) scans for the same hanzi added more than once and
suggests which copy to keep.

### Export and import

- **Settings → Export Data → Download Backup** saves everything (decks, notes, review
  history) as a JSON file.
- Decks can be imported from JSON — see [IMPORT_EXPORT_FORMAT.md](./IMPORT_EXPORT_FORMAT.md).

---

## 7. For tutors: connecting with students

Everything tutor-related lives under **Connections** in the top bar.

### Inviting a student

<img src="guide-images/connections-invite.png" width="300">

Sign-up is invite-only, and inviting new people is switched on per tutor by the
admin. Once it is on for you, **Connections** shows a **+ Invite student** button:

1. Leave **I'm their tutor** selected (it is the default). The other choices are
   **They're my tutor** and **Just let them in** (an account with no connection).
2. Optionally tick **Share these decks when they join** — the student starts with a
   copy of each ticked deck, so their very first screen has something to study.
3. Tap **Create link**. You get a link with a **Copy** button, a QR code the student
   can scan from your screen, and **Share…** to send it by WhatsApp, WeChat, email, etc.

The student opens the link, taps **Continue with Google**, and is immediately your
student — no request to accept, no email to type. Each link works once unless you
change that under **Options**, where you can also limit the link to one email address,
set an expiry, and add a note to yourself. **Invites I've sent** lists every link with
its state (unused / used by … / expired / revoked) and a **Revoke** button.

If the person already has an account, the link still works (it connects you and
shares the decks), or use **Connect by email** instead: enter their email and choose
**Tutor** ("I'll teach them") or **Student** ("They'll teach me"). They then see a
**Pending Request** on their Connections page and tap **Accept**. Tutors without
inviting switched on can only connect by email with people who already use the app.

The same person can be a tutor to some people and a student of others.

### The Connections page

<img src="guide-images/connections-tutor.png" width="300">

1. **My Students** — everyone you teach. Tap a row to open the connection.

(Students see the mirror image — **My Tutors** — plus **Claude**, an AI conversation
partner that is added automatically.)

<img src="guide-images/connection-detail-tutor.png" width="300">

Opening a student shows:

1. **New Chat** — start a conversation thread.
2. **Share Deck** — copy one of your decks to the student (homework).
3. **View Progress** — the student's statistics and daily history.
4. **Decks You Shared** — each has its own progress page.

Further down: **Student's Shared Decks** (decks the student has chosen to show you)
and a **Remove Connection** button.

---

## 8. For tutors: chat, homework decks and progress

### Chat

<img src="guide-images/chat.png" width="300">

Chat is a simple message thread, with learning tools attached to each message:

1. **+ Card** — Claude reads the recent conversation and proposes a flashcard (hanzi,
   pinyin, meaning) that can be saved to any of the student's decks.
2. **Check my Chinese (✓?)** — on the student's own messages: Claude corrects and
   explains the sentence.
3. **Play audio** — read the message aloud with TTS.
4. **Translate & make flashcard (abc)** — translate a message and turn a word in it into a card.
5. **Discuss with Claude (💬)** — open a side discussion about this message.
6. Message box. 7. **Send**. Each message can also be **replied to** and given an emoji
   **reaction**; the **?** button at the bottom-left is "I don't know what to say" and
   suggests replies.

Messages arrive in the other person's notification bell and (if email is configured) by
email. Chat polls every few seconds, so it is fine for asynchronous homework questions
but it is not a video-call replacement.

### Sharing a homework deck

1. Build the deck on your own account (by hand, with **Generate**, or by importing).
   A good homework deck is **8–15 words** with example sentences.
2. Open the student under **Connections** → **Share Deck** and pick the deck.

<img src="guide-images/share-deck.png" width="300">

The student receives a **copy** named "&lt;deck name&gt; (from tutor)". It appears on their
home screen immediately and its new cards enter their daily budget. The copy is theirs
— they can edit it, and your original is unaffected. If you later change the original,
share it again (it creates a new copy — see the ideas section for a planned
improvement).

### Following progress

<img src="guide-images/student-progress.png" width="300">

**View Progress** shows:

1. **30-Day Summary** — reviews, active days, accuracy (share of non-Again ratings),
   total study time.
2. **Daily Activity** — one row per day. Tap a day to see what was reviewed.

<img src="guide-images/student-day-detail.png" width="300">

The **day detail** lists every card reviewed that day, hardest first, with the rating
dot. Cards with a 📝 icon had a typed answer, cards with a 🎤 icon have a **pronunciation
recording**. Tap a card to open the reviews for that card on that day, where you can
**read the exact characters the student typed** and **play their recording**. This is the
most useful page for spotting tone problems and character mix-ups before the next
lesson.

<img src="guide-images/shared-deck-progress.png" width="300">

Each shared deck has its own **progress page**: completion, progress per card type and
the mastery percentage of every word in the deck. Words with a low percentage after a
week are the ones to revisit in class.

### Insights (the pre-lesson briefing)

Opening a student now shows **Insights** as the main button. It is the one page to read
before a lesson, and it defaults to *since your last lesson*:

- **Time range** — chips for *Since last lesson*, 7, 14 or 30 days, or a custom pair of
  dates. *Since last lesson* only appears once you have logged a lesson (see below).
- **Tiles** — attempts, days active, accuracy (and how often they forgot), study time,
  and how many new words they started.
- **Needs attention** — the words the student forgot or mistyped most, worst first. The
  red chips are the **exact characters they typed** (在见 for 再见, 己经 for 已经), which is
  usually where a tone or look-alike problem shows itself. 🎤 means there is a
  recording. Tap a row to see every attempt inline, with a play button for each recording.
- **Going well** — words they got right every time, or that are now scheduled a week or
  more out.
- **Also this period** — mini lessons, readers and quests completed, and how many
  recordings they made.
- **Summary** — tap **Write summary** and Claude writes 6–10 short lines (about ten
  seconds): how much they studied, what they nailed, what they struggle with (naming the
  words and the wrong characters), and what to revisit next lesson. Toggle between
  **EN** and **中文**. Previous summaries stay available below.
- **Lessons** — **Log a lesson** with the date and optional notes. The date becomes the
  new "since last lesson" start, and the notes are copied into the student's **Lesson
  Notes** automatically (prefixed with your name and the date), so the daily reader and
  the other AI helpers pick them up without the student having to paste anything.

Two more pages sit in the row under Insights:

- **History** — every attempt, newest first, with a sticky filter bar (search, deck, card
  type, rating, range). Each row shows the typed answer with wrong characters struck
  through in red and the expected characters in blue, plus a play button for recordings.
  Switch **By attempt / By word** to group what is loaded by word.
- **Recordings** — the student's pronunciation recordings, unlistened first. Play each
  one and mark it **Listened** or **Needs work**, optionally with a note for yourself
  (notes are not shown to the student yet). Filter by *all / unlistened / needs work*.

### What the student sees

<img src="guide-images/connection-detail-student.png" width="300">

On the student's side, the connection page has **New Chat** (1), the list of
**Conversations** (2) and the **Shared Decks** they received (3). Students can also share
one of *their own* decks with you from the deck page (**Share with Tutor**) so that you
can see progress on words they collected themselves.

### Lesson notes

<img src="guide-images/lesson-notes.png" width="300">

After a lesson the student can paste whatever you sent them (a vocab list, sentences,
homework instructions — any format) into **Lesson Notes** (1) and **Save** (2). These
notes are used as context by the AI features, for example the daily reader story will
weave in words from the most recent lesson. Tutors may want to end each lesson by
sending the student a short list to paste here.

---

## 9. AI helpers

All AI features need an internet connection; they fail with a clear message when offline.

### Ask Claude (during study)

Available on the back of every card (section 5). Typical questions: "What's the
difference between 刮风 and 有风?", "Give me two more example sentences", "Is this
word used in the northeast?". Claude can edit the current card (e.g. add a better
sentence) or create a mini lesson on the spot — the student approves each change.

### Sentence Coach

<img src="guide-images/coach.png" width="300">

The student types a sentence in Chinese (1) and gets it corrected, critiqued and
explained word by word, with alternative ways to say it; or types English and gets a
translation with alternatives. Each result starts a saved conversation where the
student can ask follow-ups, and the coach can add words straight into a deck.
Deep link: `/coach?text=…`; on the Android app, select text anywhere and choose
**Sentence Coach**.

### Sentence Breakdown (Analyze)

<img src="guide-images/analyze.png" width="300">

Enter a Chinese (or English) sentence (1) to see it split into aligned chunks — hanzi,
pinyin and English side by side — with grammar notes on particles and constructions.
Any chunk can be added as a card.

### Practice conversations with Claude

Under **Connections → Claude** the student can start a **Practice Conversation** with a
scenario ("You are ordering food; the waiter only speaks Mandarin"), their role and
Claude's role. Claude replies in Chinese; the chat tools (check my Chinese, translate,
"what could I say?") help the student keep going. The 🎭 button on a study card starts a
role-play around that word.

---

## 10. Readers, Mini Lessons and Quests

### Graded readers

<img src="guide-images/readers.png" width="300">

**Readers** (profile menu) are short illustrated stories that only use words the student
already knows. **AI Generate** (1) builds one from chosen decks (or from today's due
cards); **Create New** lets a tutor write one by hand, page by page. Tap a reader (2) to
read it, or **Edit** to open the reader editor.

The **reader editor** works like the lesson editor: title fields at the top, then one card per
page with the Chinese (🔊 to hear it, **拼音** to fill the pinyin automatically), the pinyin,
the English (**Translate** asks Claude) and an illustration prompt (**Suggest** drafts one,
**Illustrate** draws it once the page is saved; new or changed prompts are also drawn in the
background after **Save**). ▲▼ reorder pages, ⧉ duplicates, ✕ deletes, and "+ Insert page
after" adds one in the middle. Problems (an empty page, a missing translation) show inline
and block **Save**. **Preview** is the real reading view — tap to reveal, nothing recorded.
Beside the form (or under the **Claude** tab on a phone) Claude is a co-editor of *this*
story: "simplify page 2", "add a page where they go home", "use 刮风 somewhere" — it answers
with a **proposal** shown as a diff of the pages that you **Accept** or **Reject**, then
**Save**. The ⋯ menu has **Export** as Markdown (with a glossary), **Print view** (one sheet
per page with the picture, pinyin under the hanzi, English below), JSON (re-importable) and
CSV for Quizlet, plus the raw JSON under *Advanced*. The Readers page's ⋯ menu has
**Import JSON** to bring a reader exported elsewhere into your own list.

<img src="guide-images/reader-generate.png" width="300">

When generating: choose the **source** (decks vs today's due cards) (1), the **decks** (2),
an optional **topic** (3) and a **difficulty** (4). Generation takes a minute; the reader
appears in the list when ready.

<img src="guide-images/reader-page.png" width="300">

Reading is progressive: the illustration shows first, then **tap to reveal** Chinese,
pinyin and translation, with audio for each page. A **daily reader** is also generated
automatically and offered at the end of each study session, anchored on the latest
lesson notes.

### Mini lessons

<img src="guide-images/mini-lessons.png" width="300">

A mini lesson is a short, agent-authored lesson: teaching notes with example sentences,
word-order scrambles, multiple choice, translation, matching, picture description,
speaking, and listening discrimination (e.g. 有 yǒu vs 又 yòu). Ask for one anywhere
Claude is present — "make me a mini lesson on 把 sentences" in Ask Claude or the
Sentence Coach. Lessons are mixed into study sessions and repeat on the same spaced
schedule as cards. This page lists what is waiting and what was completed. Every lesson
has an **Edit** button that opens the lesson editor (below).

### Lesson library & editor

**Lesson Library** (profile menu → 📚 Lesson Library) is where a tutor keeps master copies
of mini lessons. **New lesson** opens a sheet: describe the lesson in a sentence or two and
let Claude draft it (about a minute), or start blank. Each card has **Edit**, **Assign…**
and a ⋯ menu (Duplicate, Export as Markdown / Print view / JSON / CSV for Quizlet, Archive);
the page's ⋯ menu has **Import JSON** for a lesson exported elsewhere.

**Assign…** shows your students as a checklist (students who already have the lesson are
ticked and greyed out). Assigning gives each student their own copy, which appears in their
study sessions and works offline; the student may also edit their copy. Tap a library card
to see the **assignments table**: how many times each student has completed it, their last
rating and score, and whether their copy is still the same as your library version. When
you edit the library lesson afterwards, a **Push update** button overwrites the students'
copies with the new content while keeping their history and schedule.

The **editor** is the same for everyone (tutor on a library lesson or a lesson they
assigned; student on any of their own): a simple form — icon, title, description, then
sections of exercises. Tap an exercise to expand it, use ▲▼ to reorder, ⧉ to duplicate,
✕ to delete, **+ Add exercise** to pick one of the nine types (each with a one-line
description). Chinese fields have a 🔊 play button and a **拼音** button that fills the pinyin
automatically; "Auto-fill missing pinyin" does it for a whole exercise. Problems (a word-order
exercise whose tiles don't match, a multiple choice with one option…) show inline and block
**Save** until fixed. **Preview** runs the real exercises exactly as the student sees them,
nothing recorded. The ⋯ menu holds Print view, the exports and, under *Advanced*, the raw
JSON.

Beside the form (or under the **Claude** tab on a phone) is a chat where Claude is a
co-editor of *this* lesson: ask for changes in plain words — "add a listening exercise for
又", "make section 2 easier", "add pinyin everywhere" — and Claude answers with a
**proposal** shown as a diff (added / removed / changed exercises) that you **Accept** or
**Reject**. Accepting puts the change into the form; press **Save** to keep it. Claude is
told what you changed yourself since its last message, so it builds on your edits rather
than undoing them.

On the student's connection page, tutors also see a **Mini Lessons** section listing the
student's lessons (assigned by you, by another tutor, or made by the student) with their
progress, and an "Assign from library" shortcut.

### Quests

<img src="guide-images/quests.png" width="300">

A quest is a tiny tile world with a character to walk around. Each goal is an imperative
instruction in Chinese (拿起钥匙, 打开门, 把杯子放在桌子上, 先…然后…) that the student
carries out by moving, picking up and using objects — comprehension is checked by doing,
not by answering. Claude builds the whole level from a topic ("厨房做早饭") and a
difficulty. Good as a reward at the end of a session.

---

## 11. Progress and statistics

<img src="guide-images/my-progress.png" width="300">

Students have the same view of themselves that the tutor has of them: **My Progress**
(profile menu) with the 30-day summary (1) and the daily list (2), each day opening the
list of cards reviewed and each card its reviews, typed answers and recordings.

On the home screen, the **streak card** and the per-deck progress bars give the "am I
doing well?" answer at a glance; on the deck page the **Completion** and **Progress by
card type** blocks show mastery per skill.

---

## 12. Settings, backups and offline use

<img src="guide-images/settings.png" width="300">

1. **Personal Bio** — a couple of sentences about the student. It is used to personalise
   generated example sentences and stories (mention hobbies, job, family, city).
2. **Offline Audio** — how many audio clips are stored on the device, and **Download All
   Audio** to fetch everything for offline study. Also audio-quality tools.
3. **Example Sentences** — the Sentence Coverage page: how many words already have
   example sentences and buttons to generate more in the background.
4. **Export Data** — download a full JSON backup.
5. **Feature Requests** — the list of feedback the user has sent.

### Offline use

Study works fully offline once the data has been synced once: card selection, rating,
audio (if downloaded) and statistics all run on the phone. Reviews upload in the
background when a connection returns; the same account on another device gets them on
its next sync. Features that need the AI (generation, Ask Claude, Coach) show a clear
"requires internet" message rather than hanging.

### Sending feedback

<img src="guide-images/feedback.png" width="300">

The floating **💬** button on every page opens a feedback form. It can attach a
screenshot (which can be annotated) and console logs for bug reports. Tutors: please
use this generously — it goes straight to the developer.

---

## 13. Suggested weekly workflow for a tutor

1. **After each lesson**, send the student the new words (any format) and ask them to
   paste them into **Lesson Notes**.
2. **Create a homework deck** for the week on your own account — 8–15 words, pinyin with
   tone marks, a short example sentence in the Sentence Clue field. **Generate** can draft
   it from a description in a few seconds; then edit.
3. **Share** it with the student under Connections. Confirm in chat that it arrived.
4. **Mid-week**, open **View Progress**: check the active days, then open a day and listen
   to a few 🎤 recordings and read the 📝 typed answers. Note tone errors and character
   mix-ups for the next lesson.
5. **Before the lesson**, open the shared deck's progress page: words still at 0–30%
   mastery are the ones to drill together.
6. Encourage students to use **Ask Claude** and the **Sentence Coach** between lessons and
   to bring the saved conversations to class.
7. If a student is overwhelmed, lower **New cards per day** in the deck settings rather
   than sharing fewer decks — the review queue is what matters.

---

## 14. Ideas for future features (not built yet)

**Nothing in this section exists in the app today.** These are suggestions for what a
tutor-focused version could add, collected while writing this guide. Tutors and students
can vote for or add to them with the in-app feedback button.

| Idea | Why it would help |
|------|-------------------|
| **Chinese-language interface** | The UI is English-only. A Simplified-Chinese translation (selectable in Settings) would let tutors from mainland China use the app without any English. |
| **Assignments with due dates** | A shared deck could carry a due date and a target ("all cards seen by Friday"); the student sees it on the home screen and the tutor sees a checklist of who has finished. |
| **Groups / classes** | Share a deck, a reader or a mini lesson to a whole class at once, and see a class progress table instead of opening each student. |
| **Tutor-authored mini lessons** | Let the tutor create a mini lesson (or ask Claude to draft one) and push it to a student, instead of only the student requesting them. |
| **Recordings inbox** | One page listing a student's newest pronunciation recordings with a "listened / needs work" mark and a quick text or voice comment back to the student. |
| **Tutor comments on reviews** | Leave a note on a specific review ("second tone, not fourth") that the student sees the next time the card appears. |
| **Update a shared deck in place** | When the tutor edits the original deck, offer "push changes" so the student's copy gets new words and fixes without losing progress. |
| **Deck templates / library** | Ready-made HSK 1–6 and topic decks (plus tutor-published public decks) that a tutor can copy and adapt. |
| **Tutor-set study settings** | Let the tutor set daily new-card limits and retention targets on the decks they shared. |
| **Weekly digest email** | An automatic summary to the tutor every Monday: days active, accuracy, weakest words, recordings waiting. |
| **Pronunciation scoring** | Compare the student's recording against the reference audio (tone contour / pinyin recognition) and show a score, so tone practice does not depend on the tutor listening to every clip. |
| **Tone and minimal-pair drills** | A dedicated drill mode built from the student's own words (mā/má/mǎ/mà, 买/卖, 有/又) — the listening exercises in mini lessons already do this in a small way. |
| **Handwriting and stroke order** | Trace characters on the screen with stroke-order animation, as an optional fourth card type. |
| **Session notes into chat** | A "send to tutor" button on the All Done screen that posts the session recap (and Ask Claude questions asked) into the chat thread. |
| **Traditional-character toggle** | Show traditional variants alongside simplified for students who need both. |
| **Live lesson mode** | Tutor and student open the same deck together; the tutor flips and rates cards on their screen while the student sees them — useful for online lessons. |
| **Import from a photo or PDF** | Photograph a textbook page or upload a worksheet and have Claude extract the vocabulary into a deck. |
| **Goals and gentle reminders** | "20 minutes a day" goals with a push notification if the day is about to be missed, visible to the tutor as well. |
