/**
 * THE tool registry of the Claude agent harness: every tool a Claude chat can call is declared ONCE
 * here — its schema, how the loop treats it (`read` = run inline, `write` = collected for the caller,
 * `lesson` = validated inline then collected) and WHICH CONTEXTS may use it. A context lists the names
 * it wants (contexts/*.ts, in the order the model sees them); `bindTools` refuses any name the registry
 * doesn't allow there, so a context can never pick up a tool by accident.
 *
 * `wording`: the per-context schemas each surface had before the harness, kept byte-identical so the
 * move changed no answer (and no cached prefix). Unify them one context at a time later.
 *
 * Executors: tools/read.ts (reads + bump_cards; the memory tools search_my_chats / read_chat in
 * tools/memory.ts — the learner's own earlier chats, under hard token caps). `write` tools (edit / delete the card,
 * create_flashcards) are applied by the caller — routes/ask-claude.ts, services/coach-replies.ts (with
 * its checkpoint, run.ts `applyCheckpointed`), Discuss with Claude's review sheet.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { CARD_STANDARD_SHORT } from '@shared/cards';
import { LESSON_SPEC_INPUT_SCHEMA } from '../../custom-lesson';
import { executeReadTool } from './read';
import type { BoundTool, ContextKind, ToolContext, ToolKind, ToolName } from '../types';

/**
 * The ONE shape of a flashcard every create_flashcards tool accepts (Ask
 * Claude, the Sentence Coach chat, chat "Discuss with Claude"). Mirrors the
 * card standard: a word card needs its explanation AND an example sentence;
 * a sentence card (hanzi is a full sentence) glosses every word instead.
 */
export const FLASHCARD_ITEM_SCHEMA = {
  properties: {
    hanzi: { type: 'string', description: 'Chinese characters (simplified). ONE clean form: no slashes, parentheses, brackets, ellipses or blanks (the server rejects them).' },
    pinyin: { type: 'string', description: 'Pinyin with tone marks (e.g., nǐ hǎo). Use tone marks, NOT tone numbers. Spaces between words, not syllables.' },
    english: { type: 'string', description: 'ONE clear English meaning (the one this card teaches). Other senses go in fun_facts after "Also:".' },
    fun_facts: { type: 'string', description: `REQUIRED in practice — the explanation, 3–6 short lines: every word of a sentence (汉字 (pīnyīn) meaning) then the structure, or every character of a word then how the word is used; then the common mistake / contrast / register and any alternatives kept off the card. Never a critique of the learner or trivia. ${CARD_STANDARD_SHORT}` },
    sentence_clue: { type: 'string', description: 'For a WORD or short phrase card: one short natural example sentence containing the word exactly as written (prefer a single clause; no brackets, slashes, ellipses or blanks). Omit when hanzi is already a full sentence.' },
    sentence_clue_pinyin: { type: 'string', description: 'Pinyin (tone marks) for sentence_clue.' },
    sentence_clue_translation: { type: 'string', description: 'English translation of sentence_clue.' },
  },
  required: ['hanzi', 'pinyin', 'english', 'fun_facts'],
} as const;

/**
 * "⚡ Study it today" for the in-app agents (Ask Claude, the Sentence Coach chat,
 * chat "Discuss with Claude"): bump words the learner ALREADY has to the front of
 * today's study (services/study-bumps.ts, shared/decks/bumps.ts). Runs inline
 * (idempotent, cheap); the result lists what was bumped / already bumped / not found.
 */
export const BUMP_CARDS_TOOL = {
  name: 'bump_cards',
  description:
    "Bump words the learner ALREADY HAS as cards to the front of today's study queue (\"⚡ Study it today\"): their cards come first in today's session, new cards even past the daily limit. Use this INSTEAD of create_flashcards whenever search_cards shows the word already exists, or when the learner asks to study / review / practise an existing word today. Give note_ids (from search_cards) or hanzi (looked up in the learner's notes). Always an explicit list of the words the learner named or asked about — never every word of a sentence that happens to be a card (for a sentence, bump the sentence's own card, or ask which words).",
  input_schema: {
    type: 'object' as const,
    properties: {
      note_ids: { type: 'array', items: { type: 'string' }, description: 'Note ids from search_cards.' },
      hanzi: { type: 'array', items: { type: 'string' }, description: "Words to look up among the learner's notes (exact hanzi)." },
    },
  },
};

type ToolSchemaShape = { name: string; description: string; input_schema: Record<string, unknown> };

export interface ToolEntry {
  kind: ToolKind;
  /** The contexts allowed to use it. */
  contexts: readonly ContextKind[];
  schema: ToolSchemaShape;
  /** The schema a context saw before the harness, where it differs from `schema`. */
  wording?: Partial<Record<ContextKind, ToolSchemaShape>>;
}

/**
 * create_flashcards as the Sentence Coach's chat words it — the deck picked from the learner's decks
 * listed in the context. Also the reader and exercise chats' wording (their cards go where he says).
 */
const DECK_PICKED_CREATE_FLASHCARDS: ToolSchemaShape = {
  name: 'create_flashcards',
  description: "Create new flashcards in one of the user's decks. The user's decks (with ids) are listed in the conversation context.",
  input_schema: {
    type: 'object' as const,
    properties: {
      deck_id: { type: 'string', description: 'Target deck ID (required — pick from the decks listed in the context).' },
      flashcards: {
        type: 'array',
        description: 'Array of flashcards to create',
        items: {
          type: 'object',
          ...FLASHCARD_ITEM_SCHEMA,
        },
      },
    },
    required: ['deck_id', 'flashcards'],
  },
};

export const TOOL_REGISTRY: Record<ToolName, ToolEntry> = {
  edit_current_card: {
    kind: 'write',
    contexts: ['card'],
    schema: {
      name: 'edit_current_card',
      description: `Edit the current flashcard's note — the card described at the start of the conversation ("The user is studying this vocabulary": Chinese = hanzi, Pinyin, English, Notes = fun_facts, Sentence clue = sentence_clue with its pinyin and translation). Only provide the fields you want to change.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          hanzi: { type: 'string', description: 'Updated Chinese characters (simplified). ONE clean form: no slashes, parentheses, brackets, ellipses or blanks (the server rejects them).' },
          pinyin: { type: 'string', description: 'Updated pinyin with tone marks (e.g., nǐ hǎo). Use tone marks, NOT tone numbers.' },
          english: { type: 'string', description: 'Updated English translation' },
          fun_facts: { type: 'string', description: `The explanation: every word of a sentence (汉字 (pīnyīn) meaning) or every character of a word, then usage / common mistake / contrast, and any alternatives kept off the card. ${CARD_STANDARD_SHORT}` },
          sentence_clue: { type: 'string', description: 'A contextual example sentence (in Chinese) that helps disambiguate this word from similar-sounding words. Useful for homophones.' },
          sentence_clue_pinyin: { type: 'string', description: 'Pinyin for the sentence clue' },
          sentence_clue_translation: { type: 'string', description: 'English translation of the sentence clue' },
        },
      },
    },
  },
  create_flashcards: {
    kind: 'write',
    contexts: ['card', 'coach', 'chat_message', 'reader', 'exercise'],
    schema: {
      name: 'create_flashcards',
      description: 'Create new flashcards. By default, cards are added to the current deck. To add cards to a different deck, specify the deck_id. The user\'s available decks are listed in the context.',
      input_schema: {
        type: 'object' as const,
        properties: {
          deck_id: { type: 'string', description: 'Target deck ID to add cards to. If omitted, cards are added to the current deck.' },
          flashcards: {
            type: 'array',
            description: 'Array of flashcards to create',
            items: {
              type: 'object',
              ...FLASHCARD_ITEM_SCHEMA,
            },
          },
        },
        required: ['flashcards'],
      },
    },
    wording: {
      coach: DECK_PICKED_CREATE_FLASHCARDS,
      reader: DECK_PICKED_CREATE_FLASHCARDS,
      exercise: DECK_PICKED_CREATE_FLASHCARDS,
      chat_message: {
        name: 'create_flashcards',
        description: 'Create flashcards for Chinese vocabulary or phrases that the user should learn. Use this when the user asks to create flashcards, or when you identify vocabulary worth learning from the discussion. Each flashcard should have Chinese characters, pinyin with tone marks, English translation, and optional notes.',
        input_schema: {
          type: 'object' as const,
          properties: {
            flashcards: {
              type: 'array',
              description: 'Array of flashcards to create',
              items: {
                type: 'object',
                ...FLASHCARD_ITEM_SCHEMA,
              },
            },
          },
          required: ['flashcards'],
        },
      },
    },
  },
  delete_current_card: {
    kind: 'write',
    contexts: ['card'],
    schema: {
      name: 'delete_current_card',
      description: `Delete the current flashcard's note (the card described at the start of the conversation). Use this only when the user explicitly says the card is a duplicate or should be removed.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          reason: { type: 'string', description: 'Brief reason for deletion' },
        },
      },
    },
  },
  create_custom_lesson: {
    kind: 'lesson',
    contexts: ['card', 'coach'],
    schema: {
      name: 'create_custom_lesson',
      description: 'Create a custom mini lesson that appears in the user\'s next study session (fully offline). A lesson is sections of exercises in any order — use it when the user wants focused practice on a word, pattern, or topic (e.g. drilling this card\'s word in context). Keep lessons short: 1-3 sections, ~4-10 exercises total.',
      input_schema: LESSON_SPEC_INPUT_SCHEMA,
    },
    wording: {
      coach: {
        name: 'create_custom_lesson',
        description: 'Create a custom mini lesson that appears in the user\'s next study session (fully offline). Use when the user is confused about a pattern or wants targeted practice — e.g. contrasting two similar words. Keep lessons short: 1-3 sections, ~4-10 exercises total.',
        input_schema: LESSON_SPEC_INPUT_SCHEMA,
      },
    },
  },
  search_cards: {
    kind: 'read',
    contexts: ['card', 'coach', 'chat_message', 'reader', 'exercise'],
    schema: {
      name: 'search_cards',
      description: 'Search through all flashcards across all decks. Use this to find related vocabulary, check for duplicates, or answer questions about what cards exist.',
      input_schema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Search query — matches against hanzi, pinyin, and english fields' },
        },
        required: ['query'],
      },
    },
    wording: {
      chat_message: {
        name: 'search_cards',
        description: 'Search through the user\'s existing flashcards across all decks. Use this to find related vocabulary, check for duplicates before creating flashcards, or answer questions about what cards the user already has.',
        input_schema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Search query — matches against hanzi, pinyin, and english fields' },
          },
          required: ['query'],
        },
      },
    },
  },
  bump_cards: {
    kind: 'read',
    contexts: ['card', 'coach', 'chat_message', 'reader', 'exercise'],
    schema: BUMP_CARDS_TOOL,
  },
  list_conversations: {
    kind: 'read',
    contexts: ['card'],
    schema: {
      name: 'list_conversations',
      description: 'List previous Ask Claude conversations for the current note or all notes. Returns question previews with timestamps.',
      input_schema: {
        type: 'object' as const,
        properties: {
          note_id: { type: 'string', description: 'Optional note ID to filter conversations. If omitted, lists recent conversations across all notes.' },
          limit: { type: 'number', description: 'Max number of conversations to return (default 10)' },
        },
      },
    },
  },
  get_deck_info: {
    kind: 'read',
    contexts: ['card'],
    schema: {
      name: 'get_deck_info',
      description: 'Get information about the current deck including name, description, card count, and settings.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
  },
  get_note_cards: {
    kind: 'read',
    contexts: ['card', 'coach', 'reader', 'exercise'],
    schema: {
      name: 'get_note_cards',
      description: `Get all cards for a specific note with their current SRS state (ease factor, interval, queue, repetitions). Use this to check detailed card scheduling data or compare cards for a note.`,
      input_schema: {
        type: 'object' as const,
        properties: {
          note_id: { type: 'string', description: 'The note ID to get cards for. Use the current note ID or one found via search_cards.' },
        },
        required: ['note_id'],
      },
    },
    wording: {
      coach: {
        name: 'get_note_cards',
        description: 'Get all cards for a specific note with their current SRS state. Use after search_cards to check detailed scheduling data.',
        input_schema: {
          type: 'object' as const,
          properties: {
            note_id: { type: 'string', description: 'The note ID (find via search_cards).' },
          },
          required: ['note_id'],
        },
      },
    },
  },
  get_note_history: {
    kind: 'read',
    contexts: ['card', 'coach'],
    schema: {
      name: 'get_note_history',
      description: 'Get review history for a note including all card types, ratings, and timing. Use this to understand how well the user knows a card.',
      input_schema: {
        type: 'object' as const,
        properties: {
          note_id: { type: 'string', description: 'The note ID to get history for.' },
        },
        required: ['note_id'],
      },
    },
    wording: {
      coach: {
        name: 'get_note_history',
        description: 'Get review history for a note. Use this to understand how well the user knows a word.',
        input_schema: {
          type: 'object' as const,
          properties: {
            note_id: { type: 'string', description: 'The note ID (find via search_cards).' },
          },
          required: ['note_id'],
        },
      },
    },
  },
  get_deck_progress: {
    kind: 'read',
    contexts: ['card'],
    schema: {
      name: 'get_deck_progress',
      description: 'Get detailed study progress for the current deck including per-note card stats, counts of new/learning/review/mastered cards.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
  },
  get_due_cards: {
    kind: 'read',
    contexts: ['card'],
    schema: {
      name: 'get_due_cards',
      description: 'Get cards that are currently due for review in the current deck or across all decks.',
      input_schema: {
        type: 'object' as const,
        properties: {
          limit: { type: 'number', description: 'Maximum number of cards to return (default 20)' },
        },
      },
    },
  },
  get_overall_stats: {
    kind: 'read',
    contexts: ['card', 'coach'],
    schema: {
      name: 'get_overall_stats',
      description: 'Get overall study statistics: total decks, total cards, cards due today, cards studied today.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
  },
  search_my_chats: {
    kind: 'read',
    contexts: ['general', 'card', 'coach', 'chat_message', 'reader', 'exercise'],
    schema: {
      name: 'search_my_chats',
      description:
        "Search the learner's EARLIER chats with you — every Claude chat in the app (Ask Claude on cards, the Sentence Coach, Discuss with Claude, general chats). Use it when the learner refers to something from before (\"like you told me last week\", \"that word we talked about\") or when an earlier chat would help your answer. Matches chat titles, summaries and messages (Chinese or English words); returns at most 5 chats with a summary and up to 2 short matching excerpts each — then read_chat for more. Call it without announcing it; never mention the tool to the learner.",
      input_schema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Words to look for, in hanzi or English (a word, or e.g. "把 sentences"). Empty = the most recent chats.' },
          limit: { type: 'number', description: 'How many chats (1–5, default 5).' },
        },
        required: ['query'],
      },
    },
  },
  read_chat: {
    kind: 'read',
    contexts: ['general', 'card', 'coach', 'chat_message', 'reader', 'exercise'],
    schema: {
      name: 'read_chat',
      description:
        "Read one of the learner's earlier chats with you: up to 20 messages, each trimmed, with the chat's summary. thread_id comes from search_my_chats or the recent chats list (the short id works). `around` centres the messages on a word or phrase; without it you get the latest messages. Call it without announcing it.",
      input_schema: {
        type: 'object' as const,
        properties: {
          thread_id: { type: 'string', description: 'The chat id (full, or the short id from the recent chats list).' },
          around: { type: 'string', description: 'Optional: a word or phrase to centre on.' },
          max_messages: { type: 'number', description: 'How many messages (1–20, default 12).' },
        },
        required: ['thread_id'],
      },
    },
  },
  list_student_decks: {
    kind: 'read',
    contexts: ['chat_message'],
    schema: {
      name: 'list_student_decks',
      description: 'List the user\'s flashcard decks with card counts. Use this to understand what the user is studying.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
  },
};

/** Is `name` a tool this context may use? */
export function toolAllowed(context: ContextKind, name: string): name is ToolName {
  const entry = (TOOL_REGISTRY as Record<string, ToolEntry | undefined>)[name];
  return !!entry && entry.contexts.includes(context);
}

/** The schema of a tool as one context sees it. */
export function toolSchema(context: ContextKind, name: ToolName): Anthropic.Tool {
  const entry = TOOL_REGISTRY[name];
  return (entry.wording?.[context] ?? entry.schema) as Anthropic.Tool;
}

/**
 * A context's tools bound to the learner: schemas in the context's order, read tools with their
 * executor. Throws on a name the registry doesn't allow in this context (a programming error).
 */
export function bindTools(context: ContextKind, names: readonly ToolName[], ctx: ToolContext): BoundTool[] {
  return names.map((name) => {
    if (!toolAllowed(context, name)) throw new Error(`Tool ${name} is not allowed in the ${context} context`);
    const entry = TOOL_REGISTRY[name];
    return {
      name,
      kind: entry.kind,
      schema: toolSchema(context, name),
      ...(entry.kind === 'read' ? { execute: (input: Record<string, unknown>) => executeReadTool(name, input, ctx) } : {}),
    };
  });
}
