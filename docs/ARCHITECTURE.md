# Technical Architecture

## System Overview

```
┌─────────────────┐     ┌──────────────────────────────────────┐
│                 │     │         Cloudflare Edge              │
│    Browser      │────▶│  ┌─────────────────────────────┐    │
│  (React App)    │     │  │     Cloudflare Worker       │    │
│                 │◀────│  │       (API Server)          │    │
└─────────────────┘     │  └──────────┬──────────────────┘    │
                        │             │                        │
                        │    ┌────────┴────────┐              │
                        │    │                 │              │
                        │    ▼                 ▼              │
                        │  ┌─────┐         ┌─────┐           │
                        │  │ D1  │         │ R2  │           │
                        │  │(SQL)│         │(Blob)│          │
                        │  └─────┘         └─────┘           │
                        └──────────────────────────────────────┘
                                      │
                                      │ API calls
                                      ▼
                        ┌─────────────────────────┐
                        │    Anthropic Claude     │
                        │    (Card Generation)    │
                        └─────────────────────────┘
```

## Database Schema (D1)

### users
For future tutor feature. Single implicit user for MVP.
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  role TEXT DEFAULT 'student', -- 'student' | 'tutor'
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### decks
```sql
CREATE TABLE decks (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

### notes
```sql
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL,
  hanzi TEXT NOT NULL,
  pinyin TEXT NOT NULL,
  english TEXT NOT NULL,
  audio_url TEXT,
  fun_facts TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
);
```

### cards
```sql
CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  card_type TEXT NOT NULL, -- 'hanzi_to_meaning' | 'meaning_to_hanzi' | 'audio_to_hanzi'
  -- SM-2 fields
  ease_factor REAL DEFAULT 2.5,
  interval INTEGER DEFAULT 0,
  repetitions INTEGER DEFAULT 0,
  next_review_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);
```

### study_sessions
```sql
CREATE TABLE study_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  deck_id TEXT, -- NULL means all decks
  started_at TEXT DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  cards_studied INTEGER DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (deck_id) REFERENCES decks(id)
);
```

### card_reviews
```sql
CREATE TABLE card_reviews (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  rating INTEGER NOT NULL, -- 0=again, 1=hard, 2=good, 3=easy
  time_spent_ms INTEGER,
  user_answer TEXT,
  recording_url TEXT,
  reviewed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES study_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (card_id) REFERENCES cards(id)
);
```

## R2 Bucket Structure

```
chinese-learning-audio/
├── generated/           # TTS-generated audio
│   └── {note_id}.mp3
└── recordings/          # User recordings
    └── {review_id}.webm
```

## SM-2 Algorithm Implementation

```typescript
interface SM2Result {
  easeFactor: number;
  interval: number;
  repetitions: number;
  nextReviewAt: Date;
}

function calculateSM2(
  rating: 0 | 1 | 2 | 3,
  currentEaseFactor: number,
  currentInterval: number,
  currentRepetitions: number
): SM2Result {
  let easeFactor = currentEaseFactor;
  let interval: number;
  let repetitions: number;

  if (rating < 2) {
    // Failed - reset
    repetitions = 0;
    interval = 1;
  } else {
    // Passed
    repetitions = currentRepetitions + 1;

    if (repetitions === 1) {
      interval = 1;
    } else if (repetitions === 2) {
      interval = 6;
    } else {
      interval = Math.round(currentInterval * easeFactor);
    }
  }

  // Adjust ease factor based on rating
  easeFactor = easeFactor + (0.1 - (3 - rating) * (0.08 + (3 - rating) * 0.02));
  easeFactor = Math.max(1.3, easeFactor); // Minimum 1.3

  const nextReviewAt = new Date();
  nextReviewAt.setDate(nextReviewAt.getDate() + interval);

  return { easeFactor, interval, repetitions, nextReviewAt };
}
```

## Audio Generation Flow

### TTS Generation (gTTS)
Since Cloudflare Workers can't run Python/gTTS directly, we have options:

**Option A: External TTS Service (Recommended)**
Use a TTS API like:
- Google Cloud Text-to-Speech
- Amazon Polly
- Azure Speech Service

**Option B: Browser-based TTS**
Use Web Speech API on client side, but quality varies.

**Current Implementation**: Use Google Cloud TTS API (or similar) called from the Worker.

```typescript
async function generateAudio(text: string, language: string = 'zh-CN'): Promise<Blob> {
  // Call TTS API
  // Upload to R2
  // Return URL
}
```

### User Recording Flow
1. Browser MediaRecorder API captures audio
2. Audio blob uploaded to `/api/audio/upload`
3. Worker stores in R2, returns URL
4. URL saved with card_review

## AI Card Generation

### Prompt Structure
```typescript
const systemPrompt = `You are a Chinese language learning expert. Generate vocabulary cards for Mandarin Chinese learners.

For each vocabulary item, provide:
- hanzi: Chinese characters
- pinyin: Romanized pronunciation with tone numbers (e.g., "ni3 hao3")
- english: Clear English translation
- fun_facts: Optional cultural context, usage notes, or memory aids

Return as JSON array.`;

const userPrompt = `Generate 10 vocabulary items about: ${topic}

Focus on practical, commonly-used words and phrases.
Include a mix of single characters and multi-character words/phrases.`;
```

### Response Format
```json
{
  "deck_name": "Zoo Animals",
  "deck_description": "Common animals you might see at a zoo",
  "notes": [
    {
      "hanzi": "熊猫",
      "pinyin": "xiong2 mao1",
      "english": "panda",
      "fun_facts": "China's national treasure. The name literally means 'bear cat'."
    }
  ]
}
```

## Frontend Architecture

### Page Structure
```
/                     # Home - dashboard with due cards, recent activity
/decks                # List all decks
/decks/new            # Create new deck
/decks/:id            # View/edit deck and its notes
/decks/:id/notes/new  # Add note to deck
/notes/:id/edit       # Edit note
/study                # Study session (select deck or all)
/study/session/:id    # Active study session
/study/review/:id     # Review completed session
/stats                # Statistics dashboard
/generate             # AI deck generation
```

### State Management
Using React Query for server state:
- Automatic caching and invalidation
- Optimistic updates for smooth UX
- Background refetching

### Audio Handling
```typescript
// Recording
const useAudioRecorder = () => {
  const [recording, setRecording] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);

  const startRecording = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder.current = new MediaRecorder(stream);
    // ...
  };

  return { recording, startRecording, stopRecording, audioBlob };
};

// Playback
const useAudioPlayer = (url: string) => {
  const audio = useRef(new Audio(url));
  const play = () => audio.current.play();
  return { play, pause, isPlaying };
};
```

## Deployment

### GitHub Actions Workflow
```yaml
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4

      - name: Install dependencies
        run: npm ci

      - name: Build frontend
        run: npm run build:frontend

      - name: Deploy Worker
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT }}
```

### Environment Configuration
Worker environment variables (in wrangler.toml or Cloudflare dashboard):
- `ANTHROPIC_API_KEY`: For AI generation
- D1 binding: `DB`
- R2 binding: `AUDIO_BUCKET`

## Security Considerations

### Current (MVP)
- No authentication (single user assumed)
- CORS configured for frontend origin only

### Future (with Auth)
- Cloudflare Zero Trust for authentication
- JWT validation in Worker
- Role-based route protection
- User data isolation

## Performance Optimizations

1. **Edge Computing**: Worker runs at edge, low latency globally
2. **D1 Caching**: D1 has automatic query caching
3. **R2 CDN**: Audio served from Cloudflare CDN
4. **React Query**: Client-side caching reduces API calls
5. **Lazy Loading**: Audio loaded on demand, not upfront
