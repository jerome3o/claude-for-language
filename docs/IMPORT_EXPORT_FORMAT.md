# Deck Import/Export Format

The app supports importing and exporting decks as JSON files. This allows:
- Backing up your decks with all progress
- Sharing decks with others
- Importing from Anki (via conversion)

## File Format (`.json`)

```json
{
  "version": 1,
  "exported_at": "2024-01-15T10:30:00Z",
  "deck": {
    "name": "HSK 1 Vocabulary",
    "description": "Basic Chinese vocabulary"
  },
  "notes": [
    {
      "hanzi": "你好",
      "pinyin": "nǐ hǎo",
      "english": "hello",
      "fun_facts": "The most common Chinese greeting...",
      "progress": {
        "interval": 30,
        "ease_factor": 2.5,
        "repetitions": 5
      }
    },
    {
      "hanzi": "谢谢",
      "pinyin": "xiè xie",
      "english": "thank you"
    }
  ]
}
```

## Fields

### Root
- `version`: Format version (currently 1)
- `exported_at`: ISO 8601 timestamp
- `deck`: Deck metadata
- `notes`: Array of vocabulary notes

### Deck
- `name`: Required. Deck name
- `description`: Optional. Deck description

### Note
- `hanzi`: Required. Chinese characters
- `pinyin`: Required. Pinyin with tone marks (nǐ hǎo, not ni3 hao3)
- `english`: Required. English translation
- `fun_facts`: Optional. Additional notes about the word
- `progress`: Optional. SRS progress (if importing with progress)

### Progress
- `interval`: Days until next review (0 = new card)
- `ease_factor`: SM-2 ease factor (default 2.5)
- `repetitions`: Number of successful reviews

## Import Behavior

When importing:
1. A new deck is created with the given name
2. Notes are added to the deck
3. If `progress` is provided:
   - Cards are initialized with the given SRS values
   - `next_review_at` is calculated as: now + interval days
4. TTS audio is generated for each note

## Export Behavior

When exporting:
1. Deck metadata is included
2. All notes with their current content
3. Progress from all three card types is averaged/combined

## Converting from Anki

Use the conversion script:
```bash
python3 scripts/anki_to_json.py input.apkg output.json
```

This extracts notes and progress from Anki's format into our JSON format.

## Anki export (`.apkg`)

Decks, mini lessons (own lessons and library items) and graded readers can be exported as
an Anki package — **Deck → Settings → Export to Anki**, the ⋯ menu of a lesson / library card,
or the **Anki** button on a reader. The file is built entirely in the browser
(`frontend/src/services/anki/`: sql.js for the SQLite database, JSZip for the archive), so it
works offline as long as the audio is already in the device's cache.

### What's in the file

A standard `.apkg`: `collection.anki2` (legacy schema 11, importable by every Anki client),
a `media` index, and the audio clips. One Anki deck per export, named after the source:
the deck's own name, `Lessons::<title>` or `Readers::<title>`. Notes are tagged
`chinese-learning` plus `deck` / `lesson` / `reader`.

### The two note types

**汉语学习 Vocabulary** — fields `Hanzi, Pinyin, English, Audio, Sentence, SentencePinyin,
SentenceEnglish, SentenceAudio, Notes, SourceId` and three card templates that mirror the
app's card types:

| Template | Front | Back |
|---|---|---|
| Hanzi → Meaning | hanzi | pinyin, English, audio, example sentence, notes |
| Meaning → Hanzi | English | hanzi, pinyin, audio, sentence |
| Audio → Hanzi | audio only | hanzi, pinyin, English, sentence |

The Audio → Hanzi card only exists when the note has audio (the model's `req` table and a
`{{#Audio}}…{{/Audio}}` conditional on the front both say so), so words without a clip never
produce a blank card. `Notes` holds the fun facts (and the card context, if any).

**汉语学习 Sentence** — fields `Chinese, Pinyin, English, Audio, SourceId`, one Chinese → English
card. Used for reader pages and for sentences harvested from lessons.

What goes where:
- **Deck**: every note → one Vocabulary note (with its sentence clue and both clips).
- **Lesson**: match pairs → Vocabulary notes; translate references, scramble answers, speak
  examples and picture references → Sentence notes; note sentences, the correct choice option and
  listening prompts → Sentence or Vocabulary by shape (≤ 4 unpunctuated characters counts as a
  word, so minimal pairs like 有 / 又 become word cards). Deduplicated by hanzi.
- **Reader**: each page → one Sentence note with the page narration; `vocabulary_used` →
  Vocabulary notes.

Field values are HTML-escaped. Audio fields hold `[sound:<hash>.mp3]`; media files are named
by a hash of their bytes, so identical clips are stored once.

### Re-exporting updates instead of duplicating

Anki matches on ids, not names, and every id here is deterministic:
- model ids: hash of the note-type name (so keep field and template **names** unchanged —
  changing them makes Anki see a different type and stop updating);
- deck id: hash of the deck name;
- note GUIDs: hash of the source — `note:<note id>` for deck words, `vocab:<hanzi>` /
  `sentence:<hanzi>` for lesson content, `reader-page:<reader id>:<page>` for pages.

Importing a second export therefore updates the existing notes (Anki keeps the newer
modification time) and keeps their review history. The same word appearing in two lessons is
one note in Anki.

### Progress (decks only, off by default)

"Include review progress" writes the app's cached card state into Anki's scheduling columns:
review cards get their interval, due date (relative to today) and ease (`ease_factor × 1000`,
min 1300); learning/relearning cards are approximated as reviews due today with a 1-day
interval; new cards stay new. No review log is exported. This is a one-way approximation —
FSRS state (stability/difficulty) has no Anki equivalent in this format — so leave it off if
you want Anki to start every card fresh.

### Audio

Clips are taken from the IndexedDB audio cache first; uncached ones are fetched (note audio)
or generated (lesson/reader TTS) when online. Offline, missing clips are simply skipped and the
result reports "N missing"; export again online to include them.
