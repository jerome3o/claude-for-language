# Feature Specification

## Overview
A Chinese language learning app using spaced repetition. Students can create decks, study cards, and track their progress. AI assists with card generation.

## Current Scope (MVP)
Single-user student experience. Tutor features deferred for future release.

---

## Core Features

### 1. Notes & Cards System

#### Notes
Notes are the source of truth for vocabulary. Each note contains:
- **Hanzi** (汉字): The Chinese characters
- **Pinyin**: Romanized pronunciation with tone marks
- **English**: English translation/meaning
- **Audio URL**: Link to audio file (generated or uploaded)
- **Fun Facts** (optional): Cultural context, usage notes, mnemonics

#### Generated Cards
From each note, three card types are automatically generated:

| Card Type | Front | Back | User Action |
|-----------|-------|------|-------------|
| `hanzi_to_meaning` | Hanzi displayed | Audio + Pinyin + English | Speak aloud, self-rate |
| `meaning_to_hanzi` | English displayed | Audio + Pinyin + Hanzi | Type hanzi, auto-grade + self-rate |
| `audio_to_hanzi` | Audio plays | Pinyin + Hanzi + English | Type hanzi, auto-grade + self-rate |

When a note is updated, its cards are automatically updated.

### 2. Decks

- User can create multiple decks (e.g., "Restaurant Vocab", "Numbers", "Daily Phrases")
- Each deck contains notes (and their generated cards)
- Study from all decks or select specific ones
- Decks have a name and optional description

### 3. Spaced Repetition (SM-2 Algorithm)

Each card tracks independently:
- **ease_factor**: Starts at 2.5, adjusts based on performance
- **interval**: Days until next review (starts at 1)
- **repetitions**: Count of successful reviews
- **next_review_at**: Timestamp for next scheduled review

Rating options after each card:
- **Again** (0): Forgot completely - reset interval to 1
- **Hard** (1): Struggled - reduce ease factor
- **Good** (2): Remembered - normal interval increase
- **Easy** (3): Too easy - increase interval more

### 4. Study Session

#### Starting a Session
- "Study All" - pulls due cards from all decks
- "Study Deck" - pulls due cards from specific deck
- Option to include new cards (cards never studied)

#### During Study
1. Card front shown (hanzi, english, or audio depending on type)
2. User responds:
   - Speaking cards: User speaks, optionally records audio
   - Typing cards: User types hanzi answer
3. Card back revealed
4. For typing cards: Show if answer was correct
5. User rates: Again / Hard / Good / Easy
6. Next card

#### Session Recording
Each card review records:
- Timestamp
- Card ID
- Rating given
- Time spent on card (seconds)
- User's typed answer (if applicable)
- Audio recording URL (if recorded)

### 5. Session Review

After completing a study session:
- Summary: Cards studied, accuracy, time spent
- List of all cards reviewed with:
  - The card content
  - User's answer
  - Correct answer
  - Rating given
  - Audio recording playback (if exists)

### 6. Progress & Statistics

- Cards due today / upcoming
- Cards studied per day/week
- Average accuracy
- Time spent studying
- Deck-by-deck breakdown

### 7. AI Card Generation

#### Deck Generation
User provides a prompt:
- "Create a deck about animals at the zoo"
- "Generate restaurant ordering vocabulary"

AI generates:
1. Deck name and description
2. Multiple notes with hanzi, pinyin, english, fun facts
3. Audio is auto-generated via gTTS

User can review and edit before saving.

#### Card Suggestions (Edit View)
While editing a deck/note, user can:
- "Suggest related vocabulary"
- "Add common phrases using this word"
- AI generates suggestions that user can accept/edit/reject

---

## Future Features (Tutor System)

### Tutor Capabilities
- View all assigned students
- See student progress and statistics
- Review student audio recordings
- Create/assign decks to specific students
- Edit student's cards with personalized feedback

### Student Assignment
- Tutors can invite students via email
- Students see tutor-assigned decks separately
- Tutor feedback appears on cards

### Authentication
- Cloudflare Zero Trust for login
- Role-based access (student vs tutor)
- Tutor emails configured via environment

---

## API Endpoints

### Decks
- `GET /api/decks` - List all decks
- `POST /api/decks` - Create deck
- `GET /api/decks/:id` - Get deck with notes
- `PUT /api/decks/:id` - Update deck
- `DELETE /api/decks/:id` - Delete deck

### Notes
- `GET /api/decks/:deckId/notes` - List notes in deck
- `POST /api/decks/:deckId/notes` - Create note (auto-generates cards)
- `GET /api/notes/:id` - Get note with cards
- `PUT /api/notes/:id` - Update note (auto-updates cards)
- `DELETE /api/notes/:id` - Delete note and cards

### Cards
- `GET /api/cards/due` - Get due cards (optionally filter by deck)
- `GET /api/cards/:id` - Get single card

### Study
- `POST /api/study/sessions` - Start new study session
- `POST /api/study/sessions/:id/reviews` - Record card review
- `PUT /api/study/sessions/:id/complete` - Complete session
- `GET /api/study/sessions/:id` - Get session with reviews

### AI Generation
- `POST /api/ai/generate-deck` - Generate full deck from prompt
- `POST /api/ai/suggest-cards` - Get card suggestions

### Audio
- `POST /api/audio/generate` - Generate TTS audio for text
- `POST /api/audio/upload` - Upload audio recording
- `GET /api/audio/:id` - Get audio file

### Statistics
- `GET /api/stats/overview` - Overall statistics
- `GET /api/stats/deck/:id` - Deck-specific statistics
