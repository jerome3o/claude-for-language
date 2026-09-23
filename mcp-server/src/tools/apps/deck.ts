/**
 * `review_deck` app: a deck's notes as an editable table (hanzi, pinyin,
 * English, sentence, audio) with add / edit / delete saved note by note, and
 * Send to a student / Update their copy.
 */
import { z } from 'zod';
import { cardTextProblems } from '../../../../shared/cards/standard';
import type { ToolContext } from '../context.js';
import { registerApp } from '../apps.js';
import { appResult, appTool, loadStudents, mediaBase, toStudentPick, withProblems } from './shared.js';
import type { DeckNote, DeckPayload, DeckStudent, NoteSaveResult, ShareDeckResult } from './types.js';

interface ApiNote {
  id: string;
  deck_id: string;
  hanzi: string;
  pinyin: string;
  english: string;
  sentence_clue: string | null;
  sentence_clue_pinyin: string | null;
  sentence_clue_translation: string | null;
  audio_url: string | null;
  fun_facts: string | null;
  created_at: string;
}

interface DeckResponse {
  id: string;
  name: string;
  description: string | null;
  notes: ApiNote[];
}

function toDeckNote(n: ApiNote): DeckNote {
  return {
    id: n.id,
    hanzi: n.hanzi,
    pinyin: n.pinyin,
    english: n.english,
    sentence_clue: n.sentence_clue ?? null,
    sentence_clue_pinyin: n.sentence_clue_pinyin ?? null,
    sentence_clue_translation: n.sentence_clue_translation ?? null,
    audio_url: n.audio_url ?? null,
    fun_facts: n.fun_facts ?? null,
    created_at: n.created_at,
  };
}

async function deckStudents(ctx: ToolContext, deckId: string): Promise<DeckStudent[]> {
  const students = await loadStudents(ctx);
  return students.map((s) => {
    const share = s.homework.decks.find((d) => d.source_deck_id === deckId);
    return {
      ...toStudentPick(s),
      shared: share
        ? {
            shared_deck_id: share.shared_deck_id,
            notes_missing: share.notes_missing,
            cards_total: share.cards_total,
            percent_started: share.percent_started,
          }
        : null,
    };
  });
}

const noteFields = {
  hanzi: z.string().min(1).optional(),
  pinyin: z.string().optional(),
  english: z.string().optional(),
  sentence_clue: z.string().nullable().optional(),
  sentence_clue_pinyin: z.string().nullable().optional(),
  sentence_clue_translation: z.string().nullable().optional(),
  fun_facts: z.string().nullable().optional(),
};

function noteProblems(n: { hanzi?: string; pinyin?: string; english?: string; sentence_clue?: string | null }, requireAll: boolean): string[] {
  const problems: string[] = [];
  const check = (key: 'hanzi' | 'pinyin' | 'english', label: string) => {
    const v = n[key];
    if (v === undefined) {
      if (requireAll) problems.push(`${label} is required`);
    } else if (!v.trim()) problems.push(`${label} cannot be blank`);
  };
  check('hanzi', 'Hanzi');
  check('pinyin', 'Pinyin');
  check('english', 'English');
  // The HARD rules of the card standard (shared/cards): symbols on the card, tone numbers, clause breaks.
  for (const p of cardTextProblems({ hanzi: n.hanzi, pinyin: n.pinyin, sentence_clue: n.sentence_clue })) problems.push(p.message);
  return problems;
}

export function registerDeckApp(ctx: ToolContext): void {
  const resourceUri = registerApp(ctx, 'review_deck');

  appTool(
    ctx,
    'review_deck',
    {
      title: 'Review a deck',
      description:
        'Open a vocabulary deck in the interactive reviewer: a table of its words (hanzi, pinyin, English, example sentence, audio) that the tutor can edit inline, add rows to and delete from, then Send to a student (or Update their copy when they already have it) and ask Claude to add more words. After creating a deck or adding words for a student (or when the tutor asks to see, check, fix or send a deck), open it here. Takes a deck id from list_decks.',
      inputSchema: { deck_id: z.string().describe('The deck id') },
      resourceUri,
    },
    async ({ deck_id }) => {
      const [deck, students] = await Promise.all([
        ctx.api.get<DeckResponse>(`/api/decks/${encodeURIComponent(deck_id)}`),
        deckStudents(ctx, deck_id),
      ]);
      const notes = (deck.notes ?? []).map(toDeckNote);
      const payload: DeckPayload = {
        kind: 'review_deck',
        deck: { id: deck.id, name: deck.name, description: deck.description ?? null, note_count: notes.length },
        notes,
        media_base: mediaBase(ctx),
        students,
      };
      const words = notes.slice(0, 40).map((n) => `${n.hanzi} (${n.pinyin}) — ${n.english}`).join('\n');
      return appResult(
        `Opened deck "${deck.name}" (${notes.length} words) for review.\n${words}${notes.length > 40 ? `\n… and ${notes.length - 40} more` : ''}`,
        payload as unknown as Record<string, unknown>,
      );
    },
  );

  appTool(
    ctx,
    'app_update_note',
    {
      title: 'Update a word',
      description: "Update one note's fields (called by the deck UI). Only the fields passed change.",
      inputSchema: { note_id: z.string(), ...noteFields },
      resourceUri,
      appOnly: true,
    },
    async ({ note_id, ...fields }) => {
      const problems = noteProblems(fields, false);
      if (problems.length > 0) return appResult(`Not saved: ${problems.join('; ')}`, { ok: false, problems } satisfies NoteSaveResult);
      const saved = await withProblems(() => ctx.api.put<ApiNote>(`/api/notes/${encodeURIComponent(note_id)}`, fields));
      if (!saved.ok) return appResult(`Not saved: ${saved.problems.join('; ')}`, { ok: false, problems: saved.problems } satisfies NoteSaveResult);
      const note = toDeckNote(saved.value);
      return appResult(`Updated ${note.hanzi} (${note.pinyin}) — ${note.english}.`, { ok: true, note } satisfies NoteSaveResult);
    },
  );

  appTool(
    ctx,
    'app_add_note',
    {
      title: 'Add a word',
      description: 'Add a note to the deck (called by the deck UI). TTS audio is generated in the background.',
      inputSchema: {
        deck_id: z.string(),
        hanzi: z.string().min(1),
        pinyin: z.string().min(1),
        english: z.string().min(1),
        sentence_clue: z.string().optional(),
        sentence_clue_pinyin: z.string().optional(),
        sentence_clue_translation: z.string().optional(),
        fun_facts: z.string().optional(),
      },
      resourceUri,
      appOnly: true,
    },
    async ({ deck_id, hanzi, pinyin, english, sentence_clue, sentence_clue_pinyin, sentence_clue_translation, fun_facts }) => {
      const problems = noteProblems({ hanzi, pinyin, english }, true);
      if (problems.length > 0) return appResult(`Not added: ${problems.join('; ')}`, { ok: false, problems } satisfies NoteSaveResult);
      // One POST: the create route takes the sentence fields too and
      // generates the word's and the sentence's audio in the background.
      const created = await withProblems(() =>
        ctx.api.post<ApiNote>(`/api/decks/${encodeURIComponent(deck_id)}/notes`, {
          hanzi: hanzi.trim(),
          pinyin: pinyin.trim(),
          english: english.trim(),
          fun_facts: fun_facts?.trim() || undefined,
          sentence_clue: sentence_clue?.trim() || undefined,
          sentence_clue_pinyin: sentence_clue_pinyin?.trim() || undefined,
          sentence_clue_translation: sentence_clue_translation?.trim() || undefined,
        }),
      );
      if (!created.ok) return appResult(`Not added: ${created.problems.join('; ')}`, { ok: false, problems: created.problems } satisfies NoteSaveResult);
      const out = toDeckNote(created.value);
      return appResult(`Added ${out.hanzi} (${out.pinyin}) — ${out.english} to deck ${deck_id}.`, { ok: true, note: out } satisfies NoteSaveResult);
    },
  );

  appTool(
    ctx,
    'app_delete_note',
    {
      title: 'Delete a word',
      description: 'Delete a note and its cards (called by the deck UI).',
      inputSchema: { note_id: z.string() },
      resourceUri,
      appOnly: true,
    },
    async ({ note_id }) => {
      await ctx.api.delete(`/api/notes/${encodeURIComponent(note_id)}`);
      return appResult(`Deleted note ${note_id}.`, { ok: true, note_id });
    },
  );

  appTool(
    ctx,
    'app_share_deck',
    {
      title: 'Send deck to a student',
      description: "Copy this deck into a student's account as homework (called by the deck UI).",
      inputSchema: { relationship_id: z.string(), deck_id: z.string() },
      resourceUri,
      appOnly: true,
    },
    async ({ relationship_id, deck_id }) => {
      const res = await ctx.api.post<{ id: string }>(`/api/relationships/${encodeURIComponent(relationship_id)}/share-deck`, { deck_id });
      const result: ShareDeckResult = { ok: true, shared_deck_id: res.id, message: 'Sent — the deck is now in their app.' };
      return appResult(`Deck ${deck_id} sent to relationship ${relationship_id} (shared deck ${res.id}).`, result as unknown as Record<string, unknown>);
    },
  );

  appTool(
    ctx,
    'app_update_shared_deck',
    {
      title: "Update a student's copy",
      description: "Add the tutor's newer words to a student's copy of a shared deck, keeping their progress (called by the deck UI).",
      inputSchema: { relationship_id: z.string(), shared_deck_id: z.string() },
      resourceUri,
      appOnly: true,
    },
    async ({ relationship_id, shared_deck_id }) => {
      const res = await ctx.api.post<{ added: number; kept: number; audio_filled: number }>(
        `/api/relationships/${encodeURIComponent(relationship_id)}/shared-decks/${encodeURIComponent(shared_deck_id)}/update`,
      );
      const result: ShareDeckResult = {
        ok: true,
        shared_deck_id,
        added: res.added,
        kept: res.kept,
        message: res.added > 0 ? `Added ${res.added} new word${res.added === 1 ? '' : 's'} to their copy (${res.kept} kept).` : 'Their copy already had every word.',
      };
      return appResult(result.message, result as unknown as Record<string, unknown>);
    },
  );
}
