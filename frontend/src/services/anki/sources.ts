/**
 * Adapters from the app's data (a deck, a lesson spec, a graded reader) to
 * Anki notes. Pure and synchronous: audio is described as an `AudioRef`
 * that `media.ts` resolves to bytes later, so these can be unit-tested
 * without IndexedDB or the network.
 */

import type { AnkiCardProgress, AnkiNote } from './apkg';
import { CARD_TYPE_ORD } from './models';
import { guidFor } from './hash';
import type { CustomLessonSpec, LessonSentence } from '@shared/lesson';

// ============ Types ============

/** Where a clip comes from; resolved by media.ts. */
export type AudioRef =
  /** An R2 object served from /api/audio/<key> (note audio, sentence clue audio). */
  | { kind: 'r2'; key: string }
  /** Generated TTS for arbitrary text (lesson sentences, reader vocabulary). */
  | { kind: 'tts'; text: string }
  /** A reader page's narration (its own cache key, slower narration speed). */
  | { kind: 'reader-page'; pageId: string; text: string };

/** The Vocabulary/Sentence fields that can carry a clip. */
export type AudioField = 'Audio' | 'SentenceAudio';

export interface SourceNote extends AnkiNote {
  audio?: Partial<Record<AudioField, AudioRef>>;
}

export interface AnkiSource {
  deckName: string;
  description?: string;
  notes: SourceNote[];
}

const APP_TAG = 'chinese-learning';

// ============ Helpers ============

/** Fields are HTML in Anki: escape text and keep line breaks. */
export function htmlField(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>');
}

const CJK_PUNCTUATION = /[，。！？、；：“”‘’「」『』（）《》…,.!?;:()\s]/;

/** A short run of characters with no punctuation reads as a word, a longer
 * one as a sentence. Used to route lesson content to the right note type. */
export function isWordLike(hanzi: string): boolean {
  const t = hanzi.trim();
  return t.length > 0 && t.length <= 4 && !CJK_PUNCTUATION.test(t);
}

/** The app's queue values (frontend/src/types.ts CardQueue). */
const QUEUE_NEW = 0;
const QUEUE_REVIEW = 2;

// ============ Decks ============

export interface DeckSourceNote {
  id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  fun_facts?: string | null;
  context?: string | null;
  sentence_clue?: string | null;
  sentence_clue_pinyin?: string | null;
  sentence_clue_translation?: string | null;
  audio_url?: string | null;
  sentence_clue_audio_url?: string | null;
}

export interface DeckSourceCard {
  note_id: string;
  card_type: 'hanzi_to_meaning' | 'meaning_to_hanzi' | 'audio_to_hanzi';
  queue: number;
  interval: number;
  ease_factor: number;
  repetitions: number;
  lapses: number;
  next_review_at: string | null;
}

export interface DeckToAnkiOptions {
  /** Write the app's cached card state into Anki's scheduling columns. */
  progress?: boolean;
  /** Clock override for tests. */
  now?: number;
}

export function cardProgress(card: DeckSourceCard, now: number): AnkiCardProgress {
  const state: AnkiCardProgress['state'] =
    card.queue === QUEUE_NEW ? 'new' : card.queue === QUEUE_REVIEW ? 'review' : 'learning';
  // ease_factor is a multiplier on cards (2.5); deck settings store percentages (250).
  const ease = card.ease_factor > 10 ? card.ease_factor / 100 : card.ease_factor || 2.5;
  const due = card.next_review_at ? Date.parse(card.next_review_at) : NaN;
  const dueInDays = Number.isFinite(due) ? (due - now) / 86_400_000 : 0;
  return {
    state,
    intervalDays: Math.max(0, card.interval || 0),
    ease,
    reps: card.repetitions || 0,
    lapses: card.lapses || 0,
    dueInDays,
  };
}

export function deckToAnki(
  deck: { name: string; description?: string | null },
  notes: DeckSourceNote[],
  cards: DeckSourceCard[],
  options: DeckToAnkiOptions = {},
): AnkiSource {
  const now = options.now ?? Date.now();
  const cardsByNote = new Map<string, DeckSourceCard[]>();
  if (options.progress) {
    for (const c of cards) {
      const list = cardsByNote.get(c.note_id);
      if (list) list.push(c); else cardsByNote.set(c.note_id, [c]);
    }
  }

  const out: SourceNote[] = [];
  for (const note of notes) {
    if (!note.hanzi?.trim()) continue;
    const notesParts = [note.context ? `Context: ${note.context}` : '', note.fun_facts ?? ''].filter(Boolean);
    const audio: SourceNote['audio'] = {};
    if (note.audio_url) audio.Audio = { kind: 'r2', key: note.audio_url };
    if (note.sentence_clue && note.sentence_clue_audio_url) audio.SentenceAudio = { kind: 'r2', key: note.sentence_clue_audio_url };

    let progress: SourceNote['progress'];
    const noteCards = cardsByNote.get(note.id);
    if (noteCards) {
      progress = {};
      for (const c of noteCards) {
        const ord = CARD_TYPE_ORD[c.card_type];
        if (ord !== undefined) progress[ord] = cardProgress(c, now);
      }
    }

    out.push({
      model: 'vocabulary',
      guid: guidFor('note', note.id),
      fields: {
        Hanzi: htmlField(note.hanzi),
        Pinyin: htmlField(note.pinyin),
        English: htmlField(note.english),
        Sentence: htmlField(note.sentence_clue),
        SentencePinyin: htmlField(note.sentence_clue_pinyin),
        SentenceEnglish: htmlField(note.sentence_clue_translation),
        Notes: htmlField(notesParts.join('\n\n')),
        SourceId: `note:${note.id}`,
      },
      tags: [APP_TAG, 'deck'],
      audio,
      progress,
    });
  }

  return { deckName: deck.name, description: deck.description ?? '', notes: out };
}

// ============ Lessons ============

/** Collector that dedupes by hanzi and routes words vs sentences. */
class NoteCollector {
  private seen = new Set<string>();
  readonly notes: SourceNote[] = [];

  constructor(private sourceId: string, private tags: string[]) {}

  word(hanzi: string, pinyin?: string | null, english?: string | null): void {
    const h = hanzi.trim();
    if (!h || this.seen.has(h)) return;
    this.seen.add(h);
    this.notes.push({
      model: 'vocabulary',
      guid: guidFor('vocab', h),
      fields: {
        Hanzi: htmlField(h),
        Pinyin: htmlField(pinyin),
        English: htmlField(english),
        SourceId: `${this.sourceId}:${h}`,
      },
      tags: this.tags,
      audio: { Audio: { kind: 'tts', text: h } },
    });
  }

  sentence(hanzi: string, pinyin?: string | null, english?: string | null, audio?: AudioRef, guid?: string, sourceId?: string): void {
    const h = hanzi.trim();
    if (!h || this.seen.has(h)) return;
    this.seen.add(h);
    this.notes.push({
      model: 'sentence',
      guid: guid ?? guidFor('sentence', h),
      fields: {
        Chinese: htmlField(h),
        Pinyin: htmlField(pinyin),
        English: htmlField(english),
        SourceId: sourceId ?? `${this.sourceId}:${h}`,
      },
      tags: this.tags,
      audio: { Audio: audio ?? { kind: 'tts', text: h } },
    });
  }

  /** Route by shape: short and unpunctuated → word, otherwise sentence. */
  auto(s: LessonSentence | { hanzi: string; pinyin?: string | null; english?: string | null } | undefined | null): void {
    if (!s?.hanzi) return;
    if (isWordLike(s.hanzi)) this.word(s.hanzi, s.pinyin, s.english);
    else this.sentence(s.hanzi, s.pinyin, s.english);
  }
}

export interface LessonToAnkiOptions {
  /** The lesson / library item id, kept in SourceId for traceability. */
  sourceId?: string;
}

export function lessonToAnki(spec: CustomLessonSpec, options: LessonToAnkiOptions = {}): AnkiSource {
  const collector = new NoteCollector(`lesson:${options.sourceId ?? 'draft'}`, [APP_TAG, 'lesson']);
  for (const section of spec.sections) {
    for (const ex of section.exercises) {
      switch (ex.type) {
        case 'match':
          for (const p of ex.pairs) collector.word(p.hanzi, p.pinyin, p.english);
          break;
        case 'note':
          for (const s of ex.sentences ?? []) collector.auto(s);
          break;
        // Exercises whose answer is a whole sentence by construction (even
        // when it's only a few characters, like 我要咖啡):
        case 'translate':
          collector.sentence(ex.reference_hanzi, ex.reference_pinyin, ex.english);
          break;
        case 'scramble':
          collector.sentence(ex.correct_order.join(''), undefined, ex.english);
          break;
        case 'describe_image':
          collector.sentence(ex.reference_hanzi, ex.reference_pinyin, ex.reference_english);
          break;
        case 'speak':
          if (ex.example) collector.sentence(ex.example.hanzi, ex.example.pinyin, ex.example.english);
          break;
        // Options and listening prompts can be single words (minimal pairs):
        case 'choice':
          collector.auto(ex.options[ex.correct]);
          break;
        case 'listen_choice':
          collector.auto(ex.audio);
          break;
        case 'listen_translate':
          collector.auto(ex.audio);
          break;
      }
    }
  }
  return {
    deckName: `Lessons::${spec.title.trim() || 'Lesson'}`,
    description: spec.description ?? '',
    notes: collector.notes,
  };
}

// ============ Readers ============

export interface ReaderSource {
  id: string;
  title_chinese: string;
  title_english: string;
  pages: Array<{ id: string; page_number: number; content_chinese: string; content_pinyin: string; content_english: string }>;
  vocabulary_used?: Array<{ hanzi: string; pinyin: string; english: string }>;
}

export function readerToAnki(reader: ReaderSource): AnkiSource {
  const collector = new NoteCollector(`reader:${reader.id}`, [APP_TAG, 'reader']);
  const pages = [...reader.pages].sort((a, b) => a.page_number - b.page_number);
  for (const page of pages) {
    collector.sentence(
      page.content_chinese,
      page.content_pinyin,
      page.content_english,
      { kind: 'reader-page', pageId: page.id, text: page.content_chinese },
      guidFor('reader-page', reader.id, String(page.page_number)),
      `reader:${reader.id}:page:${page.page_number}`,
    );
  }
  for (const v of reader.vocabulary_used ?? []) collector.word(v.hanzi, v.pinyin, v.english);
  const title = reader.title_chinese.trim() || reader.title_english.trim() || 'Reader';
  return {
    deckName: `Readers::${title}`,
    description: reader.title_english,
    notes: collector.notes,
  };
}
