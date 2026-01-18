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
