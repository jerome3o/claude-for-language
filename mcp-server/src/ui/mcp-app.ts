/**
 * Study Flashcards MCP App
 * Interactive flashcard viewer for the Chinese Learning app
 */
import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import './mcp-app.css';

// Types matching the server response
interface Note {
  id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  audio_url: string | null;
  fun_facts: string | null;
}

interface Card {
  id: string;
  card_type: 'hanzi_to_meaning' | 'meaning_to_hanzi' | 'audio_to_hanzi';
  note: Note;
  queue: number;
  ease_factor: number;
  interval: number;
}

interface IntervalPreview {
  intervalText: string;
  queue: number;
}

interface StudyData {
  deck: { id: string; name: string };
  cards: Card[];
  counts: { new: number; learning: number; review: number };
  intervalPreviews: Record<number, IntervalPreview>;
}

// Card type display info
const CARD_TYPE_INFO: Record<string, { prompt: string; action: 'speak' | 'type' }> = {
  hanzi_to_meaning: { prompt: 'Say this word aloud', action: 'speak' },
  meaning_to_hanzi: { prompt: 'Type the Chinese characters', action: 'type' },
  audio_to_hanzi: { prompt: 'Type what you hear', action: 'type' },
};

// DOM Elements
const elements = {
  loading: document.getElementById('loading')!,
  error: document.getElementById('error')!,
  errorMessage: document.getElementById('error-message')!,
  studyContainer: document.getElementById('study-container')!,
  complete: document.getElementById('complete')!,
  completeStats: document.getElementById('complete-stats')!,

  // Queue counts
  countNew: document.getElementById('count-new')!,
  countLearning: document.getElementById('count-learning')!,
  countReview: document.getElementById('count-review')!,

  // Card elements
  cardFront: document.getElementById('card-front')!,
  cardBack: document.getElementById('card-back')!,
  cardPrompt: document.getElementById('card-prompt')!,
  cardContent: document.getElementById('card-content')!,
  typingArea: document.getElementById('typing-area')!,
  typeInput: document.getElementById('type-input') as HTMLInputElement,
  playAudioBtn: document.getElementById('play-audio-btn')!,

  // Back elements
  answerDiff: document.getElementById('answer-diff')!,
  answerDisplay: document.getElementById('answer-display')!,
  answerHanzi: document.getElementById('answer-hanzi')!,
  answerPinyin: document.getElementById('answer-pinyin')!,
  answerEnglish: document.getElementById('answer-english')!,
  answerFunFacts: document.getElementById('answer-fun-facts')!,
  playAudioBackBtn: document.getElementById('play-audio-back-btn')!,

  // Actions
  showAnswerBtn: document.getElementById('show-answer-btn')!,
  checkAnswerBtn: document.getElementById('check-answer-btn')!,
  ratingButtons: document.getElementById('rating-buttons')!,
};

// State
let studyData: StudyData | null = null;
let currentCardIndex = 0;
let startTime = 0;
let cardsStudied = 0;
let isSubmitting = false;

// Speech synthesis for audio
function speakChinese(text: string) {
  if ('speechSynthesis' in window) {
    // Cancel any ongoing speech
    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 0.8; // Slightly slower for learning

    // Try to find a Chinese voice
    const voices = speechSynthesis.getVoices();
    const chineseVoice = voices.find(v => v.lang.startsWith('zh'));
    if (chineseVoice) {
      utterance.voice = chineseVoice;
    }

    speechSynthesis.speak(utterance);
  }
}

// Update queue counts display
function updateQueueCounts(counts: { new: number; learning: number; review: number }) {
  elements.countNew.textContent = String(counts.new);
  elements.countLearning.textContent = String(counts.learning);
  elements.countReview.textContent = String(counts.review);
}

// Show error state
function showError(message: string) {
  elements.loading.style.display = 'none';
  elements.studyContainer.style.display = 'none';
  elements.complete.style.display = 'none';
  elements.error.style.display = 'block';
  elements.errorMessage.textContent = message;
}

// Show completion state
function showComplete() {
  elements.studyContainer.style.display = 'none';
  elements.complete.style.display = 'block';
  elements.completeStats.textContent = `You studied ${cardsStudied} card${cardsStudied !== 1 ? 's' : ''}!`;
}

// Render character diff for typed answers
function renderAnswerDiff(userAnswer: string, correctAnswer: string): string {
  const maxLen = Math.max(userAnswer.length, correctAnswer.length);
  let userRow = '';
  let correctRow = '';
  let isFullyCorrect = userAnswer === correctAnswer;

  for (let i = 0; i < maxLen; i++) {
    const userChar = userAnswer[i] || '';
    const correctChar = correctAnswer[i] || '';
    const isMatch = userChar === correctChar;

    if (i < userAnswer.length) {
      const className = isMatch ? 'diff-correct' : 'diff-wrong';
      userRow += `<span class="diff-char ${className}">${userChar}</span>`;
    }
    if (i < correctAnswer.length) {
      const className = isMatch ? 'diff-correct' : 'diff-expected';
      correctRow += `<span class="diff-char ${className}">${correctChar}</span>`;
    }
  }

  if (isFullyCorrect) {
    return `<div class="answer-diff-row">${userRow}</div>`;
  }

  return `
    <div class="answer-diff-row">${userRow}</div>
    <div class="answer-diff-arrow">↓</div>
    <div class="answer-diff-row">${correctRow}</div>
  `;
}

// Display current card (front)
function showCardFront() {
  if (!studyData || currentCardIndex >= studyData.cards.length) {
    showComplete();
    return;
  }

  const card = studyData.cards[currentCardIndex];
  const info = CARD_TYPE_INFO[card.card_type];

  startTime = Date.now();

  // Reset UI
  elements.cardFront.style.display = 'block';
  elements.cardBack.style.display = 'none';
  elements.showAnswerBtn.style.display = info.action === 'speak' ? 'inline-block' : 'none';
  elements.checkAnswerBtn.style.display = info.action === 'type' ? 'inline-block' : 'none';
  elements.ratingButtons.style.display = 'none';
  elements.typingArea.style.display = info.action === 'type' ? 'block' : 'none';
  elements.typeInput.value = '';
  elements.playAudioBtn.style.display = card.card_type === 'audio_to_hanzi' ? 'inline-block' : 'none';

  // Set prompt
  elements.cardPrompt.textContent = info.prompt;

  // Set content based on card type
  switch (card.card_type) {
    case 'hanzi_to_meaning':
      elements.cardContent.innerHTML = `<div class="hanzi">${card.note.hanzi}</div>`;
      break;
    case 'meaning_to_hanzi':
      elements.cardContent.textContent = card.note.english;
      break;
    case 'audio_to_hanzi':
      elements.cardContent.textContent = '🔊';
      // Auto-play audio
      setTimeout(() => speakChinese(card.note.hanzi), 100);
      break;
  }

  // Focus input for typing cards
  if (info.action === 'type') {
    setTimeout(() => elements.typeInput.focus(), 100);
  }

  // Update interval previews
  if (studyData.intervalPreviews) {
    for (let i = 0; i < 4; i++) {
      const preview = studyData.intervalPreviews[i];
      const el = document.getElementById(`interval-${i}`);
      if (el && preview) {
        el.textContent = preview.intervalText;
      }
    }
  }
}

// Show card back (answer)
function showCardBack() {
  if (!studyData) return;

  const card = studyData.cards[currentCardIndex];
  const info = CARD_TYPE_INFO[card.card_type];
  const userAnswer = elements.typeInput.value.trim();

  elements.cardFront.style.display = 'none';
  elements.cardBack.style.display = 'block';
  elements.showAnswerBtn.style.display = 'none';
  elements.checkAnswerBtn.style.display = 'none';
  elements.ratingButtons.style.display = 'block';

  // Show diff for typing cards
  if (info.action === 'type' && userAnswer) {
    elements.answerDiff.innerHTML = renderAnswerDiff(userAnswer, card.note.hanzi);
    elements.answerDiff.style.display = 'block';
    elements.answerHanzi.style.display = 'none';
  } else {
    elements.answerDiff.style.display = 'none';
    elements.answerHanzi.textContent = card.note.hanzi;
    elements.answerHanzi.style.display = 'block';
  }

  elements.answerPinyin.textContent = card.note.pinyin;
  elements.answerEnglish.textContent = card.note.english;

  if (card.note.fun_facts) {
    elements.answerFunFacts.textContent = card.note.fun_facts;
    elements.answerFunFacts.style.display = 'block';
  } else {
    elements.answerFunFacts.style.display = 'none';
  }

  // Play audio on reveal
  speakChinese(card.note.hanzi);
}

// Handle rating submission
async function submitRating(rating: number) {
  if (!studyData || isSubmitting) return;

  const card = studyData.cards[currentCardIndex];
  const timeSpent = Date.now() - startTime;
  const userAnswer = elements.typeInput.value.trim();

  isSubmitting = true;

  // Disable rating buttons
  const buttons = elements.ratingButtons.querySelectorAll('button');
  buttons.forEach(btn => btn.setAttribute('disabled', 'true'));

  try {
    const result = await app.callServerTool({
      name: 'submit_review',
      arguments: {
        card_id: card.id,
        rating,
        time_spent_ms: timeSpent,
        user_answer: userAnswer || undefined,
      },
    });

    // Update counts from response
    if (result.structuredContent) {
      const response = result.structuredContent as { counts?: StudyData['counts']; intervalPreviews?: Record<number, IntervalPreview> };
      if (response.counts) {
        updateQueueCounts(response.counts);
        if (studyData) {
          studyData.counts = response.counts;
        }
      }
      if (response.intervalPreviews && studyData) {
        studyData.intervalPreviews = response.intervalPreviews;
      }
    }

    cardsStudied++;
    currentCardIndex++;
    showCardFront();
  } catch (err) {
    console.error('Failed to submit review:', err);
    // Still advance on error
    cardsStudied++;
    currentCardIndex++;
    showCardFront();
  } finally {
    isSubmitting = false;
    buttons.forEach(btn => btn.removeAttribute('disabled'));
  }
}

// Initialize the app
const app = new App({ name: 'Study Flashcards', version: '1.0.0' });

// Handle tool input (deck_id argument)
app.ontoolinput = (params) => {
  const args = params.arguments as { deck_id?: string } | undefined;
  if (args?.deck_id) {
    elements.loading.querySelector('p')!.textContent = 'Loading flashcards...';
  }
};

// Handle tool result (cards data)
app.ontoolresult = (result: CallToolResult) => {
  elements.loading.style.display = 'none';

  if (result.isError) {
    const errorText = result.content?.[0]?.type === 'text'
      ? (result.content[0] as { type: 'text'; text: string }).text
      : 'Failed to load cards';
    showError(errorText);
    return;
  }

  try {
    const data = result.structuredContent as unknown as StudyData;

    if (!data.cards || data.cards.length === 0) {
      showError('No cards due for review in this deck!');
      return;
    }

    studyData = data;
    currentCardIndex = 0;
    cardsStudied = 0;

    updateQueueCounts(data.counts);
    elements.studyContainer.style.display = 'block';
    showCardFront();
  } catch (err) {
    showError('Failed to parse card data');
  }
};

// Handle host context changes (theme)
app.onhostcontextchanged = (ctx) => {
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme);
  }
  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }
  if (ctx.safeAreaInsets) {
    const { top, right, bottom, left } = ctx.safeAreaInsets;
    document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }
};

app.onerror = (err) => {
  console.error('[Study App] Error:', err);
  showError('An error occurred. Please try again.');
};

// Event listeners
elements.showAnswerBtn.addEventListener('click', showCardBack);
elements.checkAnswerBtn.addEventListener('click', showCardBack);

elements.typeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    showCardBack();
  }
});

elements.playAudioBtn.addEventListener('click', () => {
  if (studyData) {
    const card = studyData.cards[currentCardIndex];
    speakChinese(card.note.hanzi);
  }
});

elements.playAudioBackBtn.addEventListener('click', () => {
  if (studyData) {
    const card = studyData.cards[currentCardIndex];
    speakChinese(card.note.hanzi);
  }
});

// Rating button handlers
document.querySelectorAll('.rating-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const rating = parseInt(btn.getAttribute('data-rating') || '2', 10);
    submitRating(rating);
  });
});

// Load voices when available (needed for some browsers)
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = () => {
    // Voices are now available
  };
}

// Connect to host
app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) {
    if (ctx.theme) applyDocumentTheme(ctx.theme);
    if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  }
});
