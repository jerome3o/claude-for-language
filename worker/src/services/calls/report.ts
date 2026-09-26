/**
 * The lesson report Claude writes after a call: a summary, the vocabulary
 * that came up (as ready-to-save cards that follow the card standard), the
 * learner's mistakes with corrections, and follow-up ideas. Built from the
 * merged transcript of both microphones plus the in-call chat and the
 * whiteboard's text.
 */

import Anthropic from '@anthropic-ai/sdk';
import { CARD_STANDARD, cardTextProblems } from '@shared/cards/standard';
import { mergeTranscript, transcriptToText, type BoardItem, type CallChatMessage } from '@shared/calls';
import type { Env } from '../../types';
import type { CallParticipant, CallRow } from './store';

const MODEL = 'claude-sonnet-5';
/** Roughly 2–3 hours of dense conversation; longer transcripts are trimmed from the middle. */
const MAX_TRANSCRIPT_CHARS = 180_000;

export interface CallReportWord {
  hanzi: string;
  pinyin: string;
  english: string;
  fun_facts?: string;
  sentence_clue?: string;
  sentence_clue_pinyin?: string;
  sentence_clue_translation?: string;
  /** The line of the call it came from. */
  from_call?: string;
}

export interface CallReportCorrection {
  said: string;
  better: string;
  pinyin?: string;
  explanation: string;
}

export interface CallReport {
  summary: string;
  topics: string[];
  vocabulary: CallReportWord[];
  corrections: CallReportCorrection[];
  follow_ups: string[];
  model: string;
  generated_at: string;
}

interface SegmentRow {
  id: string;
  user_id: string;
  start_ms: number;
  end_ms: number;
  text: string;
  translation: string | null;
}

async function roleNames(db: D1Database, call: CallRow, participants: CallParticipant[]): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  let tutorId: string | null = null;
  if (call.relationship_id) {
    const rel = await db
      .prepare('SELECT requester_id, recipient_id, requester_role FROM tutor_relationships WHERE id = ?')
      .bind(call.relationship_id)
      .first<{ requester_id: string; recipient_id: string; requester_role: string }>();
    if (rel) tutorId = rel.requester_role === 'tutor' ? rel.requester_id : rel.recipient_id;
  }
  for (const p of participants) {
    const name = p.name || p.email.split('@')[0];
    names[p.id] = tutorId ? `${name} (${p.id === tutorId ? 'tutor' : 'student'})` : name;
  }
  return names;
}

function trimMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return `${text.slice(0, half)}\n\n[… middle of the lesson omitted for length …]\n\n${text.slice(-half)}`;
}

/** The report, or null when there is nothing to write about (or no API key). */
export async function writeCallReport(env: Env, call: CallRow, participants: CallParticipant[]): Promise<CallReport | null> {
  const rows = await env.DB
    .prepare('SELECT id, user_id, start_ms, end_ms, text, translation FROM call_transcript_segments WHERE call_id = ? ORDER BY start_ms')
    .bind(call.id)
    .all<SegmentRow>();
  const segments = mergeTranscript(rows.results ?? []);
  const chat: CallChatMessage[] = call.chat_json ? JSON.parse(call.chat_json) : [];
  const board: BoardItem[] = call.board_json ? JSON.parse(call.board_json) : [];
  const boardText = board.filter((b) => b.type === 'text').map((b) => (b.type === 'text' ? b.text : '')).filter(Boolean);
  if (segments.length === 0 && chat.length === 0 && boardText.length === 0) return null;
  if (!env.ANTHROPIC_API_KEY) return null;

  const names = await roleNames(env.DB, call, participants);
  const startMs = call.started_at ?? segments[0]?.start_ms ?? 0;
  const transcript = trimMiddle(transcriptToText(segments, names, startMs, { translations: true }), MAX_TRANSCRIPT_CHARS);
  const chatText = chat.map((m) => `${names[m.user_id] || m.name}: ${m.text}`).join('\n');

  const system = `You review a recorded 1:1 Mandarin Chinese lesson between a tutor and a learner and write the learner's lesson report.

The transcript was produced by speech recognition from each person's own microphone, so the speaker labels are reliable but the words may contain recognition errors — especially in code-switched speech (Chinese and English mixed in one sentence). Silently correct obvious recognition errors when you quote; never invent things that were not said.

Write:
- summary: 3–6 sentences in English — what the lesson covered and how the learner did. Address the learner as "you".
- topics: 2–6 short topic labels.
- vocabulary: the words and phrases worth making flashcards of — new or practised items the lesson actually used, most useful first, at most 20. Skip words any beginner already knows (你, 好, 是, 我) unless the lesson focused on them. Each one is a card and MUST follow the card standard below. Put the call line it came from in from_call.
- corrections: things the LEARNER said that were wrong or unnatural, with a better version and a one-line explanation. At most 12. Only real mistakes, not recognition noise.
- follow_ups: 1–4 concrete things to practise before the next lesson.

${CARD_STANDARD}`;

  const user = `Participants: ${Object.values(names).join(', ')}
Lesson title: ${call.title || '(none)'}

TRANSCRIPT (time from the start of the call; translations in brackets where the recogniser gave one):
${transcript || '(no speech was transcribed)'}
${chatText ? `\nIN-CALL CHAT:\n${chatText}` : ''}${boardText.length ? `\nWRITTEN ON THE WHITEBOARD:\n${boardText.join('\n')}` : ''}`;

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    // Sonnet 5 thinks by default; forced tool use needs it off (thinking shares max_tokens).
    thinking: { type: 'disabled' },
    system,
    tools: [
      {
        name: 'lesson_report',
        description: 'Return the lesson report.',
        input_schema: {
          type: 'object' as const,
          properties: {
            summary: { type: 'string' },
            topics: { type: 'array', items: { type: 'string' } },
            vocabulary: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  hanzi: { type: 'string' },
                  pinyin: { type: 'string' },
                  english: { type: 'string' },
                  fun_facts: { type: 'string' },
                  sentence_clue: { type: 'string' },
                  sentence_clue_pinyin: { type: 'string' },
                  sentence_clue_translation: { type: 'string' },
                  from_call: { type: 'string' },
                },
                required: ['hanzi', 'pinyin', 'english'],
              },
            },
            corrections: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  said: { type: 'string' },
                  better: { type: 'string' },
                  pinyin: { type: 'string' },
                  explanation: { type: 'string' },
                },
                required: ['said', 'better', 'explanation'],
              },
            },
            follow_ups: { type: 'array', items: { type: 'string' } },
          },
          required: ['summary', 'topics', 'vocabulary', 'corrections', 'follow_ups'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'lesson_report' },
    messages: [{ role: 'user', content: user }],
  });
  const toolUse = response.content.find((c) => c.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') throw new Error('Claude returned no report');
  return normalizeReport(toolUse.input as Partial<CallReport>, MODEL);
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Keep only well-formed entries; drop vocabulary that breaks a HARD card rule. */
export function normalizeReport(raw: Partial<CallReport>, model: string, now = new Date()): CallReport {
  const vocabulary: CallReportWord[] = [];
  const seen = new Set<string>();
  for (const w of Array.isArray(raw.vocabulary) ? raw.vocabulary : []) {
    const word: CallReportWord = {
      hanzi: str(w?.hanzi),
      pinyin: str(w?.pinyin),
      english: str(w?.english),
      fun_facts: str(w?.fun_facts) || undefined,
      sentence_clue: str(w?.sentence_clue) || undefined,
      sentence_clue_pinyin: str(w?.sentence_clue_pinyin) || undefined,
      sentence_clue_translation: str(w?.sentence_clue_translation) || undefined,
      from_call: str(w?.from_call) || undefined,
    };
    if (!word.hanzi || !word.pinyin || !word.english || seen.has(word.hanzi)) continue;
    if (word.sentence_clue && cardTextProblems({ sentence_clue: word.sentence_clue }).length > 0) {
      word.sentence_clue = word.sentence_clue_pinyin = word.sentence_clue_translation = undefined;
    }
    if (cardTextProblems({ hanzi: word.hanzi }).length > 0) continue;
    seen.add(word.hanzi);
    vocabulary.push(word);
  }
  return {
    summary: str(raw.summary),
    topics: (Array.isArray(raw.topics) ? raw.topics : []).map(str).filter(Boolean).slice(0, 8),
    vocabulary: vocabulary.slice(0, 30),
    corrections: (Array.isArray(raw.corrections) ? raw.corrections : [])
      .map((c) => ({ said: str(c?.said), better: str(c?.better), pinyin: str(c?.pinyin) || undefined, explanation: str(c?.explanation) }))
      .filter((c) => c.said && c.better)
      .slice(0, 20),
    follow_ups: (Array.isArray(raw.follow_ups) ? raw.follow_ups : []).map(str).filter(Boolean).slice(0, 6),
    model,
    generated_at: now.toISOString(),
  };
}
