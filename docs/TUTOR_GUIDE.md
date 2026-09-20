# 汉语学习 (Chinese Learning) — Guide for Tutors and Students

> 中文版本 / Chinese version: [TUTOR_GUIDE.zh-CN.md](./TUTOR_GUIDE.zh-CN.md)

This guide explains how to use the Chinese Learning app to teach and learn Mandarin
vocabulary. It is written for a **tutor** who wants to set homework and follow their
students' progress, and for the **students** who will study on their phones.

The app lives at **https://chinese-learning-2x9.pages.dev** and works in any browser.
Students mostly use it on a phone; tutors may prefer a laptop for adding vocabulary.

All screenshots in this guide were taken on a phone-sized screen (the editors also
have a laptop-sized shot). The red numbered circles are explained in the text under
each picture.

### What's new (18 Sep 2026)

If you have read this guide before, these are the sections that changed:

**New look**

- A **bottom tab bar** replaces the old avatar menu — Study · Decks · Tutor · Progress ·
  More for students, Students · Decks · Study · More for tutors. Everything that used to
  hide in the dropdown is on the **More** page — [section 3](#3-the-home-screen).
- A **new home screen**: one *Study today's cards* button, a *From your tutor* homework
  card, and a short deck list — [section 3](#3-the-home-screen).
- A **Students dashboard** for tutors — one card per student with what needs attention,
  *Message* and *Send homework* — [section 7](#the-students-dashboard).
- A **simpler study card** (one action row, the rest under ⋯) and a **simpler deck page**
  (Study + ⋯) — [section 5](#5-studying) and [section 6](#6-managing-vocabulary).
- **Chat** tools moved under a ⋯ menu on each message, plus *Help me say it* —
  [section 8](#chat).
- **Invites** start the student with a built-in **Starter Chinese** deck, can carry a
  **welcome message**, and the new student gets a **first-open screen** —
  [section 2](#signing-in) and [section 7](#inviting-a-student).

**Tutor tools**

- **Invite links and QR codes** replace email invitations — [Signing in](#signing-in)
  and [Inviting a student](#inviting-a-student). An [admin page](#for-the-admin-access-requests-and-who-may-invite)
  approves people who tried to sign in without a link.
- **Insights** — a one-page briefing before each lesson, with a **History** explorer, a
  **Recordings** inbox and a **lesson log** — [section 8](#insights-the-pre-lesson-briefing).
- **Lesson Library and the lesson editor** — write mini lessons (with Claude as a
  co-editor), assign them to students and push updates — [section 10](#lesson-library--editor).
- **Reader editor** — edit or hand-write graded readers page by page, with print and
  export — [section 10](#the-reader-editor).
- **Export to Anki** — decks, lessons and readers as `.apkg` files — [section 6](#export-and-import).
- The future-ideas list in [section 15](#15-ideas-for-future-features-not-built-yet)
  was pruned again: tutor notes on recordings now reach the student, and shared decks
  can be updated in place.

---

## Contents

1. [What the app does](#1-what-the-app-does)
2. [Getting started](#2-getting-started)
3. [The home screen, the tab bar and More](#3-the-home-screen)
4. [Core concepts: notes, cards, decks and spaced repetition](#4-core-concepts)
5. [Studying (the student's daily routine)](#5-studying)
6. [Managing vocabulary](#6-managing-vocabulary)
7. [For tutors: inviting students and the Students dashboard](#7-for-tutors-inviting-students-and-the-students-dashboard)
8. [For tutors: chat, homework, Insights and progress](#8-for-tutors-chat-homework-insights-and-progress)
9. [AI helpers: Ask Claude, Sentence Coach, Sentence Breakdown](#9-ai-helpers)
10. [Readers, Mini Lessons, the Lesson Library and Quests](#10-readers-mini-lessons-the-lesson-library-and-quests)
11. [Progress and statistics](#11-progress-and-statistics)
12. [Settings, backups and offline use](#12-settings-backups-and-offline-use)
13. [Claude as your teaching assistant (the MCP connection)](#13-claude-as-your-teaching-assistant-the-mcp-connection)
14. [Suggested weekly workflow for a tutor](#14-suggested-weekly-workflow-for-a-tutor)
15. [Ideas for future features (not built yet)](#15-ideas-for-future-features-not-built-yet)

---

## 1. What the app does

- **Flashcards with spaced repetition.** Every word is tested three ways (see
  characters → say it; see English → type characters; hear audio → type characters).
  A scheduling algorithm (FSRS) decides when each card comes back, so students spend
  their time on the words they are about to forget.
- **Native-sounding audio** is generated automatically for every word and sentence and
  downloads itself to the phone for offline study.
- **Tutor ↔ student connections.** A tutor invites a student with a link, sends them
  homework (a deck of words or a mini lesson), chats with them, and sees exactly what
  they reviewed — including the answers they typed and the pronunciation recordings they
  made — on a **Students dashboard** and in a one-page **Insights** briefing before each
  lesson.
- **AI helpers** (powered by Claude) for generating decks, explaining sentences,
  correcting the student's own sentences, writing graded-reader stories and building
  small lessons and games — and co-editing lessons and readers with you.
- **Works offline.** Study sessions run entirely on the phone; reviews sync later.
- **Export to Anki** for anyone who also uses Anki.

---

## 2. Getting started

### Signing in

The app is **invite-only**. The first time you sign in you need an invite; after that
you sign in normally.

<img src="guide-images/join-page.png" width="300">

**With an invite link (the usual way):** your tutor sends you a link like
`…/join/abc…` or shows you a QR code. Open it on the phone you will study on. The page
shows who invited you and that a deck of words is waiting; tap **Continue with Google**
(1) and pick your Google account. That is the whole sign-up: you land on your first
screen already connected to your tutor, with the decks they chose for you ready to study.

<img src="guide-images/join-inapp.png" width="300">

If you opened the link **inside WeChat** (or another app's built-in browser), Google
sign-in cannot run there. The page says so (1): tap **Copy link** (2) and paste it into
Chrome (Android) or Safari (iPhone), or try **Try opening in Chrome**. The same link
keeps working after you have signed in — opening it again just opens the app.

<img src="guide-images/splash-invite-only.png" width="300">

**Without a link:** open https://chinese-learning-2x9.pages.dev and tap **Sign in with
Google** (2). If your email has been invited (or approved by the admin) you are in.
Otherwise you come back to this screen with the notice *"Ask your tutor for their invite
link"* (1). The attempt is also noted for the admin, who can approve you (see
[section 7](#for-the-admin-access-requests-and-who-may-invite)); after that, simply sign
in again.

Everyone — tutors and students — signs in the same way. There is no separate
"tutor account"; roles are set per connection (section 7). If an invite was sent to
a specific email and you signed in with a different Google account, you will see a
message saying so — switch accounts or ask for a new link.

### Your first screen

<img src="guide-images/first-open.png" width="300">

A student who came in through a tutor's link sees this once, until their first study
session:

1. **Start your first session** — the tutor's name and first homework deck are named
   above it, with an estimate of how long it takes.
2. **Add to home screen** — *Show me* explains how to install the app on this phone
   (Android and iPhone instructions differ; Android Chrome may show a real install
   prompt).
3. **Audio for your words** — nothing to do; the pronunciation clips download by
   themselves.
4. The tutor's **welcome message**, if they wrote one when creating the link.
5. **Reply** opens the chat with the tutor.

After the first study session the normal home screen (section 3) takes over.

### Installing on a phone (recommended for students)

The app is a *progressive web app*, so it can be installed like a normal app:

- **Android (Chrome):** open the site, tap the ⋮ menu → **Add to Home screen** /
  **Install app**.
- **iPhone (Safari):** tap the Share button → **Add to Home Screen**.

Once installed it opens full-screen, keeps working without internet, and remembers
the login. The tutor can see whether a student has installed it (section 7), and can
send the instructions into the chat with one tap (**Send how-to**).

There is also a native Android wrapper (APK) that adds a home-screen widget, a
"Sentence Coach" option in the text-selection menu of any app, and homework
notifications. See [native/README.md](../native/README.md) for how to get it.

### Recommended setup for a new student

1. Open the tutor's invite link on the phone (in Chrome or Safari, not inside WeChat),
   tap **Continue with Google**, then install the app (above). The connection to the
   tutor is already active.
2. If you signed in without a link, open the **Tutor** tab and accept the tutor's
   request (or connect with the tutor by email).
3. Stay on Wi-Fi for a minute the first time — the audio downloads by itself; the
   **Settings** page (More → Settings) shows how many clips are on the phone.
4. Tap **Study today's cards** on the home screen every day.

---

## 3. The home screen

<img src="guide-images/home.png" width="300">

1. **Notifications** — chat messages, connection requests, shared decks.
2. **Your avatar** — opens the **More** page (below).
3. **Study today's cards** — starts a session with every card that is due today, across
   all decks. The line underneath says how many cards and roughly how long ("28 cards due
   · about 10 min").
4. **ⓘ** — the breakdown of today's cards by colour: **blue** new cards, **purple**
   secondary new cards, **orange** learning cards, **green** review cards (explained in
   section 4).
5. **From &lt;tutor&gt;** — the homework card: the newest deck or mini lesson your tutor
   sent, your progress on it in words ("All 24 cards started · 下雪 and 刮风 need work"),
   and the tutor's latest unread message. **Reply** opens the chat; **Open deck** opens
   the deck.
6. **Your decks** — the five decks with the most cards due, each with a thin progress
   bar (green = mastered, blue = seen), the word count and a **pin** to keep a deck at
   the top.
7. **All decks →** — the full list, on the Decks tab.
8. **+ Add a deck** — create an empty deck or let Claude generate one (section 6).
9. The **tab bar**, present on every normal page (it disappears during a study session,
   in the reader and in chat, so the screen is free for the task).

Above the button there is a **streak card** — consecutive days studied, with a heat-map
of the last month.

### The tab bar

| Tab | What it opens |
|-----|---------------|
| **Study** | the home screen above |
| **Decks** | every deck, plus a search box that finds any word across all decks (section 6) |
| **Tutor** | your tutor(s), homework and conversations (section 8) |
| **Progress** | 30-day statistics and daily history (section 11) |
| **More** | everything else — below |

A tutor's tab bar reads **Students · Decks · Study · More** (plus **Progress** if the
tutor also studies). Their **Students** tab is the dashboard in section 7. Under
**Settings → Start on** anyone can choose which tab the app opens on.

### The More page

<img src="guide-images/more.png" width="300">

1. **Your name** — tap to open **Settings** (section 12).
2. **Practice** — **Sentence Coach** (check a sentence you wrote), **Sentence
   Breakdown** (split any sentence into words), **Readers** (short stories at your
   level), **Mini Lessons** (lessons made for you, mixed into study), **Quests** (carry
   out Chinese instructions in a tiny world) — all in sections 9 and 10.
3. **From your tutor** — **Lesson Notes**: paste what the tutor sent after a lesson;
   used as context for the AI features.
4. **Settings** and **Sign out**.
5. **Advanced** (collapsed) — Duplicate Finder, Sentence Coverage, Full Sync, Update
   App and the debug tools. You will rarely need these.

<img src="guide-images/more-tutor.png" width="300">

A tutor's More page has a **Teaching** group (1) with the **Lesson Library** (2)
(section 10), and no *From your tutor* group.

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
per deck (the **Study** button on the deck page) or across all decks (**Study today's
cards** on the home screen).

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

Every card is in one of four queues, and the coloured numbers in the study session's
header (and behind ⓘ on the home screen) count them:

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

Tap **Study today's cards** on the home screen, or **Study · n due** on a deck page.
The session shows every card due today in one sitting, prioritising learning cards
whose timer has expired, then a mix of new and review cards. The header and tab bar
disappear; the session has the whole screen.

### Front of a "Hanzi → Meaning" card

<img src="guide-images/study-front.png" width="300">

1. **Queue counts** for this session (blue + purple + orange + green). The underlined
   number is the queue the current card came from.
2. **Undo** the last rating.
3. The **offline pill** — normally *Auto* (the app notices by itself when the connection
   drops and switches to on-device audio). Tap it to **force offline mode** for the
   train; tap again to go back to automatic.
4. **End session** (✕). Once you have rated at least one card it asks *End session?* and
   shows a recap first (below).
5. The word to say aloud.
6. **Record Your Pronunciation** — records the student saying the word. Recordings are
   saved with the review and the **tutor can listen to them** (section 8).
7. **Skip recording** — go straight to the answer. **Use in Sentence** above it reveals
   an example sentence as a hint.

### Back of the card

<img src="guide-images/study-back.png" width="300">

1. The characters, pinyin and meaning.
2. **From &lt;tutor&gt;: …** — shown when the tutor marked one of your recordings of
   this word *needs work* and left a comment (section 8). It appears once, the next time
   the card comes up, so the tutor's feedback reaches the student without a chat.
3. **Play** — replay the word.
4. **Record again** if the first attempt was poor.
5. **Example sentences** — always there under the meaning: the card's own sentence first,
   then the graded set (easiest → hardest). Every row starts **blank**, so you listen first:
   **▶** on the right plays it, then each tap on the row uncovers the Chinese, then the
   pinyin, then the English (a tap on a fully open row hides it again). **EN** on the left
   flips a row to the reverse exercise: the English goes up alone, you say it in Chinese,
   then tap to check the characters and pinyin. A fully open row also offers *What's going
   on here?* (a word-by-word breakdown) and **+ Add as card**; the first row is tagged
   *From the card*. The list scrolls underneath the buttons, so the ratings never move.
6. **Show all** — opens every sentence for this card (the next card starts blank again).
7. **⋯** next to it — regenerate the set, add five more, ask for custom sentences, or
   clear it (needs internet).
8. **Ask Claude** — ask anything about this word (usage, grammar, similar words). Claude
   can also **edit the current card** and **create a mini lesson** from the chat. Questions
   and answers are saved to the note's history. Needs internet.
9. **Edit card** — fix a typo, add alternative answers, change the sentence.
10. **⋯** — everything else (next picture).
11–14. **Again / Hard / Good / Easy**.

Fun facts, if the note has any, show between the meaning and the sentences.

<img src="guide-images/study-more.png" width="300">

1. The **⋯ sheet**: **Generate fun fact** (Claude writes a memory aid and saves it to the note),
   **Regenerate audio**, **New voice**, **Roleplay** (a practice conversation around this
   word), **Play my recording** (after recording) and, at the bottom, when the card was
   added.

### Typing cards ("Meaning → Hanzi" and "Audio → Hanzi")

<img src="guide-images/study-typing.png" width="300">

1. Type the characters (any keyboard; pinyin input on the phone works well).
2. **Check Answer**.
3. **Multiple Choice** for when the student is stuck (if the options take more than a
   few seconds to build, the card falls back to typing), and **Use in Sentence** for a
   hint.

<img src="guide-images/study-typing-result.png" width="300">

1. The typed answer is compared character by character — wrong characters are shown in
   red above the correct answer, so the student sees exactly which character they mixed
   up. Typed answers are saved and visible to the tutor.
2. **Ask Claude** offers a *Check my answer* chip here, for a second opinion on a
   near-miss.

If a word has several acceptable ways to write it, add them under **Acceptable
alternatives** when editing the card (section 6) and they will be marked correct.

### Between cards

- Every ~8 cards the session may slot in a **Mini Lesson** (if one is waiting) and at the
  end of the session it offers **today's Reader** story (section 10).
- Rating a card **Again** quietly prepares example sentences for it, so they are ready
  when the card returns a minute later.

### Ending early

<img src="guide-images/study-exit.png" width="300">

Tapping ✕ after at least one review shows the session recap — reviews, accuracy, time,
today's totals — with **Keep studying** (1) and **End session** (2). Nothing is lost
either way: every review is saved locally the moment it is rated.

### End of session

When all cards are done the **All Done!** screen shows the same recap and today's
totals — with confetti. A **Study More** button adds 10 bonus new cards for keen
students.

Sessions save every review locally first, so nothing is lost if the connection drops.

---

## 6. Managing vocabulary

### The Decks tab

<img src="guide-images/decks.png" width="300">

1. **Search** — type hanzi, pinyin or English to find a word in any deck; results show
   its recent ratings and let you jump to the deck, edit or delete the card.
2. A **deck card** — name, the four coloured queue counts, a progress bar and a **Study**
   button for just this deck. Tap the name to open the deck page. Pinned decks stay at
   the top.

Below the list: **New Deck**, **Generate** (Claude writes a deck from a description) and
**Analyze** (the Sentence Breakdown tool).

### The deck page

<img src="guide-images/deck-detail.png" width="300">

1. **Study · n due** — study this deck.
2. **⋯** — the deck menu (next picture).
3. **+ Add word** — add a word by hand.

Under the buttons, one **progress block**: the mastery percentage, a bar per card type
(字→义 / 义→字 / 听→字) and when the deck was last studied. Then the **word list** with
the last few ratings for each word (coloured dots) and a mastery percentage. Tap a row
to edit the card.

<img src="guide-images/deck-menu.png" width="300">

1. The ⋯ menu: **Share with tutor** (only if you have a tutor — lets them see your
   progress on this deck), **Settings** (name, daily limits, scheduling), **Generate
   missing audio** (appears when some words have none), **Regenerate audio…** (pick words
   and re-record them with another voice), **Export → JSON**, **Export → Anki (.apkg)**
   and **Delete deck**.

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

Tap a row in the word list. Besides the basic fields you can set:

1. The **⋯** in the header holds **Delete note**.
2. **Acceptable alternatives** — other correct answers for the typing cards, one per line.
3. **Sentence Clue** — an example sentence shown on the card as a hint (with pinyin and
   translation; **Regenerate** lets Claude write one). It gets its own audio.

Further down: the **Sentence Set** (the generated graded sentences — generate more,
delete) and the word's **audio recordings**.

### Deck settings

<img src="guide-images/deck-settings.png" width="300">

Deck page → ⋯ → **Settings**:

1. **Deck Info** — name and description, then a two-sentence reminder of how FSRS
   schedules cards.
2. **Learning** — **New cards per day** (blue budget) and **Secondary cards per day**
   (purple budget), then the learning steps. Advanced scheduling parameters (desired
   retention, interval multipliers, maximum interval) are under *Advanced Settings*; the
   defaults are good for most students.

### Generating a deck with AI

<img src="guide-images/add-deck.png" width="300">

**+ Add a deck** on the home screen opens this sheet: name an empty deck (1) or choose
**Generate with Claude** (2).

<img src="guide-images/generate-deck.png" width="300">

Describe what to learn (1) — "Vocabulary for taking the bus in Changchun", "HSK 2 verbs
about daily routine" — and Claude generates 8–12 words with pinyin, meaning, fun facts
and audio. Review the words afterwards and delete any you don't want. The same page is
behind **Generate** on the Decks tab.

### Search, duplicates and moving words

**Search** lives at the top of the **Decks** tab (above). **Duplicate Finder** (More →
Advanced) scans for the same hanzi added more than once and suggests which copy to keep.

### Export and import

- **More → Settings → Backup → Download Backup** saves everything (decks, notes, review
  history) as a JSON file.
- Decks can be imported from JSON — see [IMPORT_EXPORT_FORMAT.md](./IMPORT_EXPORT_FORMAT.md).

**Export to Anki.** On the deck page, **⋯ → Export → Anki (.apkg)** builds an Anki
package on the phone itself (no server involved, so it works offline once the audio is
cached):

<img src="guide-images/anki-export.png" width="300">

1. **Include audio** — bundles the pronunciation clips (on by default). Clips not yet on
   the device are fetched if you are online; missing ones are simply counted.
2. **Include review progress** — off by default. Turn it on only if you want Anki to start
   from roughly the same schedule instead of treating every card as new.
3. **Export .apkg** — builds the file; a progress bar shows the audio being gathered.

<img src="guide-images/anki-result.png" width="300">

1. The saved file name.
2. What went in — notes, cards and how many audio clips were bundled (or missing).
3. **Done**. Open the file in Anki (desktop, AnkiDroid or AnkiMobile) with **File →
   Import**. Each word becomes one note with the same three cards as here (Hanzi →
   Meaning, Meaning → Hanzi, Audio → Hanzi). Exporting the same deck again later
   **updates** the notes in Anki rather than duplicating them.

Lessons and readers can be exported to Anki too — see section 10.

---

## 7. For tutors: inviting students and the Students dashboard

Everything tutor-related lives on the **Students** tab (called **Tutor** on a student's
phone).

### Inviting a student

Sign-up is invite-only, and inviting new people is switched on per tutor by the admin
(below). Once it is on for you, the Students tab shows **+ Invite student**, which opens
this sheet:

<img src="guide-images/invite-sheet.png" width="300">

1. **Start them with** — the built-in **Starter Chinese** deck (15 everyday words with
   example sentences and audio) is preselected, so a brand-new student always has
   something to study the moment they sign in.
2. Tick any of **your own decks** as well — the student starts with a copy of each. At
   least one deck is required when inviting a student.
3. **Welcome message** (optional) — delivered as your first chat message the moment they
   sign in, and shown on their first screen. Say hello and tell them what to do first.
4. **Options** — see next picture.
5. **Create link**.

<img src="guide-images/invite-options.png" width="300">

Under **Options**:

1. **Our relationship** — leave **I'm their tutor** selected (the default). The other
   choices are **They're my tutor** and **Just let them in** (an account with no
   connection).
2. **Only for this email** — limit the link to one Google account.
3. **Expires** — never, or after 1–90 days.
4. **Allow multiple people to use this link** (for a class), and a **note to self** so
   you remember who the link was for.

<img src="guide-images/invite-link-qr.png" width="300">

1. A **QR code** the student can scan straight from your screen.
2. The **link** with a **Copy** button. On a phone there is also a **Share…** button to
   send it by WhatsApp, WeChat, email, etc.

The student opens the link, taps **Continue with Google**, and is immediately your
student — no request to accept, no email to type. Their first screen names you, your
first homework deck and your welcome message ([section 2](#your-first-screen)). Each
link works once unless you changed that under **Options**.

If the person already has an account, the link still works (it connects you and shares
the decks), or use **Connect by email** instead: enter their email and choose **Tutor**
("I'll teach them") or **Student** ("They'll teach me"). They then see a **Pending
Request** on their Tutor tab and tap **Accept**. Tutors without inviting switched on can
only connect by email with people who already use the app.

The same person can be a tutor to some people and a student of others.

### The Students dashboard

<img src="guide-images/students-dashboard.png" width="300">

Once you have a student, the **Students** tab is a dashboard — one card per student:

1. **+ Invite student** — the sheet above. **Connect by email** is the small link under
   the heading.
2. The **status line** — when they last studied, their streak and today's accuracy.
3. **n words struggling** — words they forgot or mistyped in the last 7 days; tap it to
   open Insights.
4. **🎤 n recordings to hear** — pronunciation recordings you have not marked yet; tap
   it to open the Recordings inbox.
5. **Homework n%** — how far they are through everything you sent them (mastered cards
   count fully, started cards half, completed lessons fully).
6. **Message** — opens your most recent conversation with them directly.
7. **Send homework** — share a deck or assign a lesson (section 8).
8. A **Getting set up** card for a student who has not studied yet — the four steps
   *Signed in · Homework received · Installed the app · First study session*, with
   **Show invite QR again** and **Message**. Their student page has the full checklist
   (section 8).
9. A **pending invite** — a link that has not been used yet, as a muted row: when it was
   created, whether it has been *opened* (someone loaded the page but did not sign in —
   usually the WeChat problem from section 2), **Resend** (shows the QR again) and a
   ⋯ menu with **Copy link**, **Show QR** and **Revoke invite**.
10. **My homework decks** — the decks you have sent, with how many students have each,
    and **+ New homework deck** (write it, generate it from a topic, or paste a word
    list). **Older invite links** at the bottom lists used and expired links.

### For the admin: access requests and who may invite

Only the app's admin account sees **Admin** (More → Advanced). Two things there matter
for tutors:

<img src="guide-images/admin-access-requests.png" width="300">

1. **Access requests** — people who tried to sign in without an invite (the *invite-only*
   screen in section 2). Their name and Google email are listed with how many times they
   tried.
2. **Approve** lets that email in the next time they sign in (**Dismiss** hides the
   request). No link needs to be sent — tell the person to sign in again.
3. **Can invite** — the per-user toggle that gives a tutor the **+ Invite student**
   button. Admins can always invite. Newly created accounts cannot invite until the
   admin switches this on.
4. **All invites** — every link anyone has created, with its state, for auditing or
   revoking.

---

## 8. For tutors: chat, homework, Insights and progress

### The student page

<img src="guide-images/student-page.png" width="300">

Tap a student's name on the dashboard to open their page:

1. The **status line** — last studied, streak, active days this month, and the date of
   your last logged lesson.
2. **Message** — opens the latest conversation (no title to type; a fresh thread can be
   started from the chat's own menu).
3. **Send homework** — below.
4. **Needs attention** — the three words they are struggling with most this week…
5. …each with the rating pattern and, for typing cards, the **exact characters they
   typed**, wrong ones in red (情天 for 晴天). Tap a row for all attempts.
6. **🎤 hear** — the word has a recording you have not listened to yet; plays it right
   here.
7. **Insights · History · Recordings · Progress** — the four detail pages, below.
8. **Homework** — every deck you sent, with a bar (orange = started, green = mastered)
   and "n/24 cards started · n mastered"…
9. …and **Update** when your original deck has words the student's copy does not have
   yet (see *Update their copy* below). Then the student's **mini lessons**, with who
   made them and how they went; **Edit** opens the ones you assigned in the lesson editor,
   **Assign from library** adds another.
10. **Conversations** — every chat thread with this student.
11. **Activity** — the last days with reviews, accuracy and time; **Show 30 days** for the
    whole month.
12. **⋯** — the less common actions (next picture).

<img src="guide-images/student-page-menu.png" width="300">

1. The ⋯ menu: **Decks the student shared with you** (decks the student chose to show
   you from their own deck page), **Progress (30-day summary)**, **Assign from lesson
   library** and **Remove connection**.

### Getting a new student set up

<img src="guide-images/getting-set-up.png" width="300">

A student who has signed in but not studied yet gets a checklist instead of an empty
progress page, so you can tell "never opened the link" from "opened it, got stuck":

1. **Getting set up** — the four steps with a *2 of 4* count.
2. **Installed the app** — whether they use the Android app, a home-screen shortcut or
   just a browser tab, and when they last opened it.
3. **Send how-to** — posts the install instructions (Android app via Obtainium, or
   add-to-home-screen) into your chat with them, in one tap.
4. **Show QR again** — the same invite that created the account, for a student who is
   standing next to you with a new phone.
5. **Copy invite link**, for sending it again.

Below the checklist the page already shows their **Homework** (the decks your invite
copied) and the **Welcome** conversation.

### Chat

<img src="guide-images/chat.png" width="300">

Chat is a simple message thread. On each message:

1. **Reply** — quote the message in your answer.
2. **Play** — read the message aloud with TTS.
3. **⋯** — the other tools (next picture). Long-pressing a message opens the same sheet.
4. **Help me say it** — for a student who does not know what to write: Claude suggests
   three replies in Chinese.
5. **+ Card** — Claude reads the recent conversation and proposes a flashcard (hanzi,
   pinyin, meaning) that can be saved to any of the student's decks.
6. The conversation **⋯** — see below.
7. The message box.

<img src="guide-images/chat-sheet.png" width="300">

The ⋯ sheet on a message from the other person:

1. **Reactions** — tap an emoji.
2. **Translate & make flashcard** (on the student's side; **Make a card from this** on
   the tutor's side).
3. **Word by word** — the sentence split into words with pinyin and meaning.
4. **Discuss with Claude** — open a side discussion about this message.
5. **Copy text**.

On the student's *own* messages the sheet offers **Check my Chinese** instead: Claude
corrects and explains the sentence, with the result shown inline under the message.

<img src="guide-images/chat-header-menu.png" width="300">

1. The header ⋯: **New conversation**, **Add a title** / **Rename conversation** and
   **All conversations**.

Messages arrive in the other person's notification bell and (if email is configured) by
email. Chat polls every few seconds, so it is fine for asynchronous homework questions
but it is not a video-call replacement.

### Sending homework

1. Build the deck on your own account (by hand, with **Generate**, or with **+ New
   homework deck** on the dashboard). A good homework deck is **8–15 words** with example
   sentences. For a grammar point, write a **mini lesson** in the Lesson Library
   (section 10).
2. Tap **Send homework** — on the dashboard card or the student page.

<img src="guide-images/send-homework.png" width="300">

1. **A deck** — your decks, each saying whether it was already sent to this student and
   when, and whether it has newer words than their copy.
2. **A lesson** — your Lesson Library; assigning gives the student their own copy.
3. A deck not yet sent — tap it, confirm **Send** and the student receives a **copy**
   named "&lt;deck name&gt; (from tutor)". It appears on their home screen immediately
   (in the *From you* homework card) and its new cards enter their daily budget. The copy
   is theirs — they can edit it, and your original is unaffected.
4. **Starter Chinese** is offered here too for students who did not get it with the
   invite.

<img src="guide-images/send-homework-update.png" width="300">

A deck that was **already sent** offers **Update their copy (+n)** (1): the words you
added to the original since are added to the student's copy, and their progress on the
other words is kept. **Send a second copy anyway** (2) creates a separate deck instead.
The same **Update** button appears next to the deck under **Homework** on the student
page.

### Insights (the pre-lesson briefing)

**Insights** is the one page to read before a lesson, and it defaults to *since your
last lesson*:

<img src="guide-images/insights.png" width="300">

1. The three tutor pages — **Insights**, **History**, **Recordings** — are one tap apart.
2. **Time range** — *Since last lesson* (with its date), 7, 14 or 30 days, or **Custom**
   dates. *Since last lesson* only works once you have logged a lesson (below); before
   that the page shows the last 14 days. The line underneath states the exact range.
3. **Tiles** — attempts (and how many distinct words), days active, accuracy (and how
   often they forgot), study time, and how many new words they started.
4. **Needs attention** — the words the student forgot or mistyped most, worst first. The
   red chips are the **exact characters they typed** (情天 for 晴天, 在见 for 再见, 快子 for
   筷子), which is usually where a look-alike or tone problem shows itself. *"knew it,
   then forgot"* means the card had graduated and lapsed again.
5. The pills on the right say how often they forgot the word and, with ✎, how many
   typed answers were wrong; 🎤 marks words with recordings.

<img src="guide-images/insights-needs-attention.png" width="300">

Tap a row to see every attempt inline, newest first, with the card type (读 Read / 写
Write / 听 Listen) and rating:

1. For typing cards, the **answer diff**: what they typed on the left with wrong characters
   in red, and the expected characters in blue on the right.
2. **▶** plays the recording made on that attempt (speaking cards).

Below that come **Going well** — words they got right every time, or that are now
scheduled a week or more out — and **Also this period** — mini lessons, readers and
quests completed, and how many recordings they made.

<img src="guide-images/insights-summary.png" width="300">

1. **Write summary** (later **Write a new summary**) — Claude writes 6–10 short lines
   in about ten seconds: how much they studied, what they nailed, what they struggle
   with (naming the words and the wrong characters) and what to revisit next lesson. It
   is written from the numbers above, never from raw data.
2. Toggle between **EN** and **中文** — the same summary is written in both languages,
   so a tutor who prefers Chinese can read it directly.
3. The narrative. Previous summaries stay available in a fold-out below it.
4. **+ Log a lesson** — see next.
5. The **lesson log**: each lesson with its notes; ✕ deletes an entry.

<img src="guide-images/insights-summary-zh.png" width="300">

The same summary after tapping **中文**.

<img src="guide-images/lesson-log.png" width="300">

Logging a lesson takes ten seconds and is worth doing every time:

1. The **date** (today by default).
2. **Notes** — vocab covered, homework, things to practise. Optional, but useful: the
   notes are copied into the student's **Lesson Notes** automatically (prefixed with your
   name and the date), so the daily reader and the other AI helpers pick them up without
   the student having to paste anything.
3. **Save lesson**. The date becomes the new *since last lesson* start for Insights,
   History and Recordings, and appears in the status line on the student page.

### History (every attempt)

<img src="guide-images/history.png" width="300">

**History** lists every attempt, newest first, and loads more as you scroll:

1. **Search** by hanzi, pinyin or English.
2. Filters for **deck**, **card type** and **rating** (e.g. only *Again*).
3. **Range** — since last lesson, 7 / 30 days, a year.
4. **By attempt / By word** — switch to grouping what is loaded by word.
5. Each row shows the typed answer (green when correct; wrong characters struck through
   in red with the expected characters in blue) and a ▶ button when there is a recording.

<img src="guide-images/history-by-word.png" width="300">

1. **By word** groups the loaded attempts by word, worst first.
2. The pill says how many attempts were right.
3. Tap a word to unfold its attempts, with the same answer diff and play buttons for its
   recordings.

### Recordings (the pronunciation inbox)

<img src="guide-images/recordings.png" width="300">

**Recordings** lists the student's pronunciation recordings, unlistened first (the
coloured bar on the left of each card is the rating the student gave themselves):

1. Filter **All / Unlistened / Needs work** and choose the time range.
2. **▶ Play** the recording.
3. Mark it **Listened**.
4. Or **Needs work** — the card turns orange so you find it again next lesson.
5. **+ Note** — a short comment ("刮 is first tone — keep it flat and high"). A note on a
   *needs work* recording is **shown to the student** once, on the back of that card the
   next time it comes up (section 5), so the correction reaches them before the next
   lesson.

Marks and notes are yours (the student's other tutors have their own).

### Following progress (the classic view)

<img src="guide-images/student-progress.png" width="300">

**Progress** shows:

1. **30-Day Summary** — reviews, active days, accuracy (share of non-Again ratings),
   total study time.
2. **Daily Activity** — one row per day. Tap a day to see what was reviewed.

<img src="guide-images/student-day-detail.png" width="300">

The **day detail** lists every card reviewed that day, hardest first, with the rating
dot. Cards with a 📝 icon had a typed answer, cards with a 🎤 icon have a **pronunciation
recording**. Tap a card to open the reviews for that card on that day, where you can
**read the exact characters the student typed** and **play their recording**. Insights
and History (above) show the same information sorted by problem rather than by day.

<img src="guide-images/shared-deck-progress.png" width="300">

Each deck under **Homework** opens its own **progress page**: completion, progress per
card type and the mastery percentage of every word in the deck. Words with a low
percentage after a week are the ones to revisit in class.

### What the student sees

<img src="guide-images/connection-detail-student.png" width="300">

On the student's side, the **Tutor** tab opens the tutor's page with **Message** (1), the
list of **Conversations** (2) and **Homework from your tutor** (3) — the decks you sent.
Students can also share one of *their own* decks with you from the deck page (⋯ →
**Share with tutor**) so that you can see progress on words they collected themselves.

### Lesson notes

<img src="guide-images/lesson-notes.png" width="300">

After a lesson the student can paste whatever you sent them (a vocab list, sentences,
homework instructions — any format) into **Lesson Notes** (More → From your tutor) (1)
and **Save** (2). These notes are used as context by the AI features, for example the
daily reader story will weave in words from the most recent lesson. **Past notes** (3)
also shows the notes you wrote when you **logged a lesson** in Insights, marked *[From
tutor …]* — so if you log lessons with notes, the student does not need to paste anything.

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

**More → Sentence Coach.** The student types a sentence in Chinese (1) and gets it
corrected, critiqued and explained word by word, with alternative ways to say it; or
types English and gets a translation with alternatives. Each result starts a saved
conversation where the student can ask follow-ups, and the coach can add words straight
into a deck. Deep link: `/coach?text=…`; on the Android app, select text anywhere and
choose **Sentence Coach**.

### Sentence Breakdown (Analyze)

<img src="guide-images/analyze.png" width="300">

**More → Sentence Breakdown** (also **Analyze** on the Decks tab). Enter a Chinese (or
English) sentence (1) to see it split into aligned chunks — hanzi, pinyin and English
side by side — with grammar notes on particles and constructions. Any chunk can be
added as a card.

### Practice conversations with Claude

On the **Tutor** tab the student also has **Claude**, an AI conversation partner that is
added automatically. There they can start a **Practice Conversation** with a scenario
("You are ordering food; the waiter only speaks Mandarin"), their role and Claude's
role. Claude replies in Chinese; the chat tools (Check my Chinese, Translate, Help me
say it) help the student keep going. **Roleplay** in a study card's ⋯ menu starts a
role-play around that word.

---

## 10. Readers, Mini Lessons, the Lesson Library and Quests

### Graded readers

<img src="guide-images/readers.png" width="300">

**Readers** (More → Practice) are short illustrated stories that only use words the
student already knows.

1. **Create New** opens the reader editor (below) with an empty story for a tutor to
   write by hand, page by page.
2. **AI Generate** builds one from chosen decks (or from today's due cards). The ⋯ next
   to it has **Import JSON** — bring a reader exported elsewhere into your own list.
3. A reader card: **Read** opens it, **Edit** opens the editor, **Anki** exports it as an
   Anki package (one card per page plus its vocabulary).
4. **n failed generations** — stories the AI could not write (for example the daily
   reader when the connection dropped) are folded into this one row instead of
   cluttering the list.

<img src="guide-images/readers-failed.png" width="300">

Unfolded: one line per failure with a plain-language reason (1), **Retry** and
**Delete**, and **Delete all failed** (2) at the bottom. The raw error is behind *Show
details* if the developer asks for it.

<img src="guide-images/reader-generate.png" width="300">

When generating: choose the **source** (decks vs today's due cards) (1), the **decks** (2),
an optional **topic** (3) and a **difficulty** (4). Generation takes a minute; the reader
appears in the list when ready.

<img src="guide-images/reader-page.png" width="300">

Reading is progressive: the illustration shows first, then **tap to reveal** Chinese,
pinyin and translation, with audio for each page. A **daily reader** is also generated
automatically and offered at the end of each study session, anchored on the latest
lesson notes.

### The reader editor

The reader editor lets a tutor (or student) fix a generated story or write one from
scratch. It has the same shape as the lesson editor: on a phone the bottom tabs switch
between **Edit**, **Preview** and **Claude**; on a laptop the form and the Claude chat sit
side by side.

<img src="guide-images/reader-editor-edit.png" width="300">

1. **Save** — enabled once something changed and there are no problems.
2. The ⋯ menu — read, print, export, raw JSON, delete (below).
3. **Titles** (Chinese with a 🔊 button, English), then difficulty and topic.
4. One card per **page**: ▲▼ reorder, ⧉ duplicates, ✕ deletes. Tap the header to fold or
   unfold a page.
5. **拼音** fills the pinyin automatically from the Chinese (you can still edit it).
6. **Translate** asks Claude for the English.
7. The **Edit / Preview / Claude** tabs (phone only).

<img src="guide-images/reader-editor-page.png" width="300">

Lower in a page card:

1. **Translate** — as above.
2. **Suggest** — Claude drafts an illustration prompt from the page text.
3. **Illustrate** — draws the picture now (the page must have been saved once). New or
   changed prompts are also drawn in the background after **Save**; leave the prompt
   blank for no picture.
4. **+ Insert page after** — add a page in the middle; **+ Add page** at the bottom
   appends one.

Problems (an empty page, a missing translation) show inline and block **Save**.

<img src="guide-images/reader-editor-preview.png" width="300">

1. **Preview** is the real reading view — tap to reveal, page through, nothing recorded.

<img src="guide-images/reader-editor-claude.png" width="300">

Under **Claude**, Claude is a co-editor of *this* story:

1. Ask in plain words — "simplify page 2", "add a page where they go home", "use 刮风
   somewhere". The chips above the box are one-tap starters.
2. Claude answers with a **proposal**: a diff of the pages it would change (~), add (+)
   or remove (−), with the old text struck through and the new text next to it.
3. **Accept** puts the change into the form (or **Reject** it); then **Save**. Claude is
   told what you changed yourself since its last message, so it builds on your edits
   rather than undoing them. Without an internet connection the chat says so and the
   editor still works.
4. The message box.

<img src="guide-images/reader-editor-menu.png" width="300">

1. The ⋯ menu: **Preview**, **Read it**, **Export Markdown** (with a glossary), **Print
   view** (one sheet per page with the picture, pinyin under the hanzi and English
   below), **Export JSON** (re-importable), **Export CSV (Quizlet)**, **Export Anki
   (.apkg)**, *Advanced: raw JSON*, and **Delete reader**.

<img src="guide-images/reader-print.png" width="300">

The print view — the browser's **Print** button makes a PDF or paper copy for
students who like to read on paper.

<img src="guide-images/reader-editor-wide.png" width="600">

On a laptop the form (1) and the Claude chat (2) are side by side, so you can watch a
proposal land in the pages while you read it.

### Mini lessons

<img src="guide-images/mini-lessons.png" width="300">

A mini lesson is a short lesson: teaching notes with example sentences, word-order
scrambles, multiple choice, translation, matching, picture description, speaking, and
listening discrimination (e.g. 有 yǒu vs 又 yòu). Students can ask for one anywhere
Claude is present — "make me a mini lesson on 把 sentences" in Ask Claude or the
Sentence Coach — and tutors assign them with **Send homework → A lesson** (section 8).
Lessons are mixed into study sessions and repeat on the same spaced schedule as cards.
**Mini Lessons** (More → Practice) lists what is waiting and what was completed; tap a
lesson to see its exercises:

1. The status chip — *New*, *Learning*, *Due* — and how often it was studied.
2. **Edit** opens the lesson in the editor (below). A student may edit their own copy of
   an assigned lesson too.

### Lesson Library & editor

**Lesson Library** (More → Teaching) is where a tutor keeps master copies of mini
lessons:

<img src="guide-images/library.png" width="300">

1. **+ New lesson** — draft with Claude or start blank (next picture).
2. The page's ⋯ menu — **Import JSON** for a lesson exported elsewhere.
3. A library card: icon, title, description, how many exercises, how many students
   have it, tags.
4. **Edit** — the lesson editor.
5. **Assign…** — give it to students.
6. The card's ⋯ menu — Duplicate, exports, Archive.

<img src="guide-images/library-new.png" width="300">

1. Describe the lesson in a sentence or two — what it covers, which exercise types you
   want, the level.
2. **Draft with Claude** writes it in about a minute and opens the editor.
3. **or start blank** — an empty lesson in the editor.

<img src="guide-images/library-assign.png" width="300">

1. **Assign…** shows your students as a checklist; students who already have the lesson
   are ticked and greyed out.
2. **Assign to n** — each student gets their own copy, which appears in their study
   sessions and works offline. (**Send homework → A lesson** on the student page does the
   same for one student.)

<img src="guide-images/library-menu.png" width="300">

1. The card's ⋯ menu: **Duplicate**, **Export Markdown** (with an answer key), **Print
   view**, **Export JSON**, **Export CSV (Quizlet)**, **Export Anki (.apkg)** and
   **Archive** (hides the lesson without touching the students' copies).

Tap a library card to open it:

<img src="guide-images/library-item.png" width="300">

1. **Edit** the master copy.
2. **Assign…** to more students.
3. **Print** the lesson.
4. **Anki** — export as an Anki package (words become vocabulary cards, sentences
   become Chinese → English cards).
5. The **Students** table: how many times each student has completed it, their last
   rating and score, whether their copy is **current** or **behind** (you edited the
   library lesson since, or the student edited theirs), and **Open copy** to look at (or
   edit) their copy. When a copy is behind, a **Push update** button overwrites it with
   the library content while keeping the student's history and schedule.
6. **Contents** — the sections and exercises at a glance.

#### The lesson editor

The editor is the same for everyone: a tutor on a library lesson or on a lesson they
assigned, a student on any of their own (`Edit` on the Mini Lessons page).

<img src="guide-images/lesson-editor-edit.png" width="300">

1. **← Back** (it asks before discarding unsaved changes).
2. **Save** — enabled once something changed and there are no problems.
3. The ⋯ menu — preview, duplicate, exports, raw JSON (below).
4. **Icon**, **title** and description.
5. A **section**: its title, exercise count, ▲▼ to reorder sections, ✕ to delete one.
6. An **exercise** row: number, type, a one-line summary; ▶ plays its audio, ▲▼ reorder,
   ⧉ duplicates, ✕ deletes. Tap the row to expand it.
7. **+ Add exercise** — pick one of the nine types.
8. **Edit / Preview / Claude** tabs (phone only).

<img src="guide-images/lesson-editor-exercise.png" width="300">

Inside an exercise (here *Match pairs*), every Chinese field has:

1. **🔊** — hear the text with the app's voice.
2. **拼音** — fill the pinyin automatically. At the bottom of each exercise, **Auto-fill
   missing pinyin** does it for the whole exercise at once.

Problems (a word-order exercise whose tiles don't match the answer, a multiple choice
with one option…) show inline with a red **!** on the row and block **Save** until fixed.

<img src="guide-images/lesson-editor-types.png" width="300">

1. **Add an exercise** lists the nine types, each with a one-line description: Note,
   Word order, Multiple choice, Translate, Match pairs, Describe picture, Speak…
2. …**Listen & pick** (audio plays with the text hidden — built for tone and
   minimal-pair drills like 有/又) and **Listen & translate**.

<img src="guide-images/lesson-editor-preview.png" width="300">

1. **Preview** runs the real exercises exactly as the student sees them — page through
   with ‹ › or the dropdown — and nothing is recorded.

<img src="guide-images/lesson-editor-claude.png" width="300">

Under **Claude** (or beside the form on a laptop), Claude is a co-editor of *this*
lesson:

1. Ask for changes in plain words — "add a listening exercise for 又", "make section 2
   easier", "add pinyin everywhere".
2. Claude answers with a **proposal** shown as a diff: changed (~), added (+) or removed
   (−) exercises, with the fields that differ.
3. **Accept** puts the change into the form (or **Reject** it); press **Save** to keep it.
   Claude is told what you changed yourself since its last message, so it builds on
   your edits rather than undoing them.
4. One-tap starters.
5. The message box. Without an internet connection the chat says so and the editor
   still works.
6. The **Claude** tab.

<img src="guide-images/lesson-editor-menu.png" width="300">

1. The ⋯ menu: **Preview**, **Duplicate**, **Export Markdown** (with an answer key),
   **Print view**, **Export JSON** (re-importable), **Export CSV (Quizlet)**, **Export
   Anki (.apkg)**, *Advanced: raw JSON* (for the technically minded) and **Archive** /
   **Delete lesson**.

<img src="guide-images/lesson-editor-wide.png" width="600">

On a laptop: the form (1) and the Claude chat (2) side by side, and the **Edit /
Preview** switch (3) in the header.

**Export to Anki.** Lessons and readers can leave the app as Anki packages: the ⋯ menu of
a library card or the lesson editor has **Export Anki (.apkg)**, and every reader has an
**Anki** button (on its card in the Readers list and in the reader editor's menu). A
lesson's words become vocabulary cards and its sentences become Chinese → English cards;
a reader gives one card per page plus its vocabulary. Re-exporting updates the same
notes in Anki. The options and result screens are the same as for decks (section 6).

### Quests

<img src="guide-images/quests.png" width="300">

A quest (More → Practice → Quests) is a tiny tile world with a character to walk around.
Each goal is an imperative instruction in Chinese (拿起钥匙, 打开门, 把杯子放在桌子上,
先…然后…) that the student carries out by moving, picking up and using objects —
comprehension is checked by doing, not by answering. Claude builds the whole level from a
topic ("厨房做早饭") and a difficulty. A level that could not be built says so plainly
("Couldn't build this one — tap Retry"). Good as a reward at the end of a session.

---

## 11. Progress and statistics

<img src="guide-images/my-progress.png" width="300">

Students have the same view of themselves that the tutor has of them: the **Progress**
tab with the 30-day summary (1) and the daily list (2), each day opening the list of
cards reviewed and each card its reviews, typed answers and recordings.

On the home screen, the **streak card**, the homework card's progress line and the
per-deck bars give the "am I doing well?" answer at a glance; on the deck page the
progress block shows mastery per skill.

---

## 12. Settings, backups and offline use

<img src="guide-images/settings.png" width="300">

**More → Settings** (or tap your avatar, then your name):

1. **Personal Bio** — a couple of sentences about the student. It is used to personalise
   generated example sentences and stories (mention hobbies, job, family, city).
2. **Audio for your words** — one line saying how many clips are on this phone. Audio
   downloads itself after every sync; a **Download** button only appears when something
   is still missing.
3. **Backup** — download a full JSON backup.
4. **Start on** — which tab the app opens on: **Automatic** (Students for a tutor with
   nothing due, otherwise Study), **Study**, **Decks** or **Students**.
5. **Sign out**.
6. **Advanced** (collapsed) — audio quality, playback quality, the Sentence Coverage
   page (how many words have example sentences, with buttons to generate more), Feature
   Requests, Duplicate Finder, Full Sync, Update App and debug tools.

### Offline use

Study works fully offline once the data has been synced once: card selection, rating,
audio and statistics all run on the phone. The audio clips download in the background
after each sync, so a student who opens the app on Wi-Fi now and then has everything on
the train. Reviews upload in the background when a connection returns; the same account
on another device gets them on its next sync. The study session's offline pill shows
*Auto · online* / *Auto · offline* and can be forced offline by hand (section 5).
Features that need the AI (generation, Ask Claude, Coach, the editors' Claude tab) show a
clear "needs internet" hint rather than hanging.

### Sending feedback

<img src="guide-images/feedback.png" width="300">

The floating **💬** button on every page opens a feedback form. It can attach a
screenshot (which can be annotated) and console logs for bug reports. Tutors: please
use this generously — it goes straight to the developer.

---

## 13. Claude as your teaching assistant (the MCP connection)

The app has an **MCP server** — a connector that lets Claude (on claude.ai or in the Claude
desktop app) see and act on your account: your students, what they studied and found hard,
their recordings, your homework decks, your readers and your lesson library. Once it is
connected you can run a lesson's admin from a chat: *"What did 小明 struggle with since our
last lesson? Write him a short reader about it and send it."*

### Connecting

1. On **claude.ai** open *Settings → Connectors → Add custom connector* and paste
   `https://chinese-learning-mcp.jeromeswannack.workers.dev/mcp`. In the Claude desktop
   app the same address goes in as a remote MCP server.
2. Sign in with the **same Google account** you use in the app. Claude then only sees
   what you can see in the app — your own students, decks, readers and lessons.
3. Start a new chat and ask for your students. The first time, Claude may ask permission
   to use each tool.

### What you can ask for

- **Students** — "List my students." · "Who hasn't studied this week?" · "How is 李华
  getting on with the weather deck?"
- **What a student finds hard** — "What has 小明 struggled with since our last lesson?"
  (the ranked words with the wrong characters he typed) · "Show me his attempts on 点菜."
  · "Write a summary of the last two weeks in 中文 for his parents."
- **Recordings** — "Play me 小明's recordings from this week." · "Mark his 点菜 recording
  as needs work: second tone, not fourth." (the note reaches him on the back of that card)
- **Lesson log and messages** — "Log today's lesson: we did 把 sentences, homework is the
  restaurant deck." · "Send 小明 a message reminding him about Thursday." · "Show me what
  he wrote in the chat."
- **Homework** — "Make a deck of 10 words about ordering food with example sentences and
  send it to 小明." · "Add 词汇 to last week's deck and update his copy." · "Assign the
  weather lesson from my library to 小明 and 李华."
- **Readers and lessons** — "Write a five-page elementary reader about a trip to the
  night market using the words 小明 got wrong, then open it for review." · "Make a mini
  lesson on 了 with a scramble and a listening exercise."
- **New students** — "Create an invite link for a new student with the Starter Chinese
  deck and a welcome message."

### Review windows

For anything worth checking before it goes to a student, Claude can open an **interactive
window** inside the chat:

- **Students dashboard** — the same cards as the app's Students tab (status, struggling
  words, recordings to hear, homework %) with buttons to log a lesson, message the
  student or mark a recording.
- **Reader review** — a generated or hand-written reader page by page: edit the Chinese,
  pinyin and English in place, reorder pages, save, and **Send to student**.
- **Lesson review** — every exercise of a mini lesson, editable; save to your library,
  **Assign** to students, **Push update** to copies they already have.
- **Deck review** — the word table with inline editing; **Send to student** or update their
  copy.

Each window has an **Ask Claude to revise** button: type what you want changed ("make page
3 simpler", "add three more words about drinks") and Claude edits it for you — it sees
your own edits too, so you can go back and forth.

### Good to know

- Everything Claude does is real: a deck or reader you send appears in the student's app
  on their next sync, a lesson-log entry sets the "since last lesson" range in Insights,
  a recording note shows on the student's card.
- Claude cannot see other tutors' students or a student's private conversations with
  other people.
- Be specific with names: if two students are both called 小明, say which relationship or
  give the email.

---

## 14. Suggested weekly workflow for a tutor

1. **Open the Students tab** whenever you have a minute. The pills tell you what needs
   you: *n words struggling* (open Insights), *🎤 n recordings to hear* (open the
   Recordings inbox, mark them *Listened* or *Needs work* with a short note — the note
   reaches the student on their next card), *Homework n%*. A **Getting set up** card
   means a new student is stuck — **Send how-to** or **Message**.
2. **After each lesson**, open the student's page → **Insights** and **Log a lesson**
   with a few lines of notes (new words, homework). They land in the student's Lesson
   Notes automatically and set the "since last lesson" range.
3. **Create the week's homework** on your own account — 8–15 words, pinyin with tone
   marks, a short example sentence in the Sentence Clue field. **+ New homework deck** on
   the dashboard can generate it from a topic or a pasted list; then edit. Add a **mini
   lesson** from the Lesson Library if the week has a grammar point.
4. **Send homework** from the dashboard card: the deck (or **Update their copy** if you
   added words to last week's deck) and the lesson. It shows up in the student's *From
   you* card immediately; confirm in chat if you like.
5. **Before the lesson**, open the student's page: **Needs attention** lists the three
   worst words with the wrong characters typed, and **Insights → Write summary** gives
   the narrative in English or 中文. The deck's progress page shows which words are still
   at 0–30% mastery.
6. Encourage students to use **Ask Claude** and the **Sentence Coach** between lessons and
   to bring the saved conversations to class.
7. If a student is overwhelmed, lower **New cards per day** in the deck settings rather
   than sharing fewer decks — the review queue is what matters.

---

## 15. Ideas for future features (not built yet)

**Nothing in this section exists in the app today.** These are suggestions for what a
tutor-focused version could add, collected while writing this guide. Tutors and students
can vote for or add to them with the in-app feedback button.

Since the first version of this guide, several ideas from this list *have* been built:
a recordings inbox, tutor notes on recordings that reach the student, tutor-authored mini
lessons via the Lesson Library with "push update", updating a shared deck in place, and
a dashboard that shows at a glance which student needs attention. What remains is listed
below.

| Idea | Why it would help |
|------|-------------------|
| **Chinese-language interface** | The UI is English-only. A Simplified-Chinese translation (selectable in Settings) would let tutors from mainland China use the app without any English. |
| **Assignments with due dates** | A shared deck or lesson could carry a due date and a target ("all cards seen by Friday"); the student sees it on the home screen and the tutor sees a checklist of who has finished. |
| **Groups / classes** | Share a deck, a reader or a mini lesson to a whole class at once, and see a class progress table instead of opening each student. |
| **Sharing readers with students** | Readers are per account; a tutor-written reader currently has to be exported as JSON and imported by the student. |
| **Deck templates / library** | Ready-made HSK 1–6 and topic decks (plus tutor-published public decks) that a tutor can copy and adapt, like the Lesson Library but for vocabulary. |
| **Tutor-set study settings** | Let the tutor set daily new-card limits and retention targets on the decks they shared. |
| **Weekly digest email** | An automatic summary to the tutor every Monday: days active, accuracy, weakest words, recordings waiting — essentially the Insights summary, delivered. |
| **Pronunciation scoring** | Compare the student's recording against the reference audio (tone contour / pinyin recognition) and show a score, so tone practice does not depend on the tutor listening to every clip. |
| **Tone and minimal-pair drills** | A dedicated drill mode built from the student's own words (mā/má/mǎ/mà, 买/卖, 有/又) — the listening exercises in mini lessons already do this in a small way. |
| **Handwriting and stroke order** | Trace characters on the screen with stroke-order animation, as an optional fourth card type. |
| **Session notes into chat** | A "send to tutor" button on the All Done screen that posts the session recap (and Ask Claude questions asked) into the chat thread. |
| **Traditional-character toggle** | Show traditional variants alongside simplified for students who need both. |
| **Live lesson mode** | Tutor and student open the same deck together; the tutor flips and rates cards on their screen while the student sees them — useful for online lessons. |
| **Import from a photo or PDF** | Photograph a textbook page or upload a worksheet and have Claude extract the vocabulary into a deck. |
| **Goals and gentle reminders** | "20 minutes a day" goals with a push notification if the day is about to be missed, visible to the tutor as well. |
