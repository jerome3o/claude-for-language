# 汉语学习 - Chinese Language Learning App

A spaced repetition flashcard app specifically designed for learning Mandarin Chinese.

## Features

### Spaced Repetition Learning
Learn Chinese using the proven SM-2 algorithm (same as Anki). Cards are shown at optimal intervals to maximize retention while minimizing study time.

### Three Card Types Per Word/Phrase
Each vocabulary item generates three different card types for comprehensive learning:
1. **See → Speak**: See the Chinese characters (汉字), practice saying them aloud
2. **English → Write**: See the English meaning, type the Chinese characters
3. **Listen → Write**: Hear the audio, type the Chinese characters

### Audio Support
- Automatic audio generation for all cards using text-to-speech
- Record your own pronunciation during study sessions
- Review your recordings to track progress

### AI-Powered Card Generation
Use Claude AI to generate vocabulary decks:
- "Create cards for ordering food at a restaurant"
- "Generate zoo animal vocabulary"
- "Add common greetings and pleasantries"

### Progress Tracking
- Session review showing all cards studied
- Performance metrics over time
- Audio recordings of your pronunciation

## Tech Stack

- **Backend**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2 (audio files)
- **Frontend**: React + Vite
- **AI**: Anthropic Claude API

## Deployment

The app automatically deploys to Cloudflare on every push to `main` via GitHub Actions.

## Development

See [CLAUDE.md](./CLAUDE.md) for development documentation.

---

Built with ❤️ for Chinese learners
