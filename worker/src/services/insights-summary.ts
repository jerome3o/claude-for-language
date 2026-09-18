/**
 * Narrative summary for a tutor: Claude turns the structured insights report
 * (never raw events) into 6–10 short lines in English, then the same in
 * Simplified Chinese with mainland vocabulary.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { InsightsReport } from './insights';

export interface StudentSummaryNarrative {
  narrative_en: string;
  narrative_zh: string;
}

const SYSTEM_PROMPT = `You write short progress notes for a Chinese tutor about one student, from a structured report of the student's flashcard practice since the last lesson.

The tutor is a native speaker from Jilin, mainland China, teaching an English-speaking adult learner. Write for a busy tutor who will skim this in a minute before the next lesson.

Cover, in this order:
1. How much they studied (attempts, days, time, new words started).
2. What they nailed — name a few words.
3. What they are struggling with — name the words, and quote the actual wrong characters they typed next to the correct ones. When a wrong answer looks like a tone or homophone confusion (same pinyin, different character, e.g. 在/再, 他/她/它, 做/作), say so; when it looks like a look-alike character mix-up (e.g. 己/已, 未/末), say so. Do not guess a cause when the evidence is not there.
4. What to revisit next lesson (2–4 concrete items).

Style rules:
- 6 to 10 short lines. One idea per line. Plain words, no headings, no markdown, no bullets symbols other than a leading "- ".
- Never use spaced-repetition jargon: say "forgot" not "lapse", "attempts" not "review events", "kept getting it right" not "stability".
- Do not invent numbers or words that are not in the report. If a section of the report is empty, say so in one line and move on.
- For the Chinese version use 简体中文 and mainland vocabulary (e.g. 软件, 视频, 信息, 复习), natural for a teacher's notes, not a translation of the English word by word.
- Chinese words from the report stay as they are (they are already 简体).

Respond ONLY with valid JSON: {"narrative_en": "...", "narrative_zh": "..."} where each value is the lines joined with "\\n".`;

function isRetryableError(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    return error.status === 429 || error.status === 503 || error.status === 529;
  }
  return false;
}

/** Trim the report to what the narrative needs, so the prompt stays small and stable. */
export function buildSummaryPayload(report: InsightsReport, range: { from: string; to: string }, studentName: string | null) {
  const fmtNote = (n: { hanzi: string; pinyin: string; english: string }) => `${n.hanzi} (${n.pinyin}, ${n.english})`;
  return {
    student: studentName || 'the student',
    range: { from: range.from.slice(0, 10), to: range.to.slice(0, 10) },
    totals: {
      attempts: report.totals.reviews,
      distinct_words: report.totals.unique_notes,
      days_active: report.totals.days_active,
      accuracy_pct: Math.round(report.totals.accuracy * 100),
      forgot_pct: Math.round(report.totals.again_rate * 100),
      minutes: Math.round(report.totals.time_ms / 60000),
      new_words_started: report.totals.new_words_introduced,
      by_card_type: Object.fromEntries(
        Object.entries(report.totals.by_card_type).map(([k, v]) => [k, { attempts: v.attempts, accuracy_pct: Math.round(v.accuracy * 100) }])
      ),
    },
    struggling: report.struggling.slice(0, 12).map((s) => ({
      word: fmtNote(s.note),
      deck: s.note.deck_name,
      attempts: s.attempts,
      forgot: s.again_count,
      hard: s.hard_count,
      forgot_after_knowing: s.forgot_count,
      wrong_typed_answers: s.wrong_answers,
      recordings: s.recordings_count,
    })),
    going_well: report.going_well.slice(0, 12).map((g) => ({
      word: fmtNote(g.note),
      attempts: g.attempts,
      reason: g.reason === 'consistent' ? 'right every time' : `now scheduled ${g.max_interval_days} days out`,
    })),
    also: {
      mini_lessons_completed: report.activity.lessons.map((l) => l.title),
      readers_read: report.activity.readers.map((r) => `${r.title_chinese} / ${r.title_english}`),
      quests_completed: report.activity.quests.map((q) => q.title),
      recordings_made: report.recordings.length,
    },
  };
}

/**
 * Write the narrative. Retries up to 3 times on transient API errors.
 */
export async function writeStudentSummary(
  apiKey: string,
  report: InsightsReport,
  range: { from: string; to: string },
  studentName: string | null
): Promise<StudentSummaryNarrative> {
  const client = new Anthropic({ apiKey, maxRetries: 0 });
  const payload = buildSummaryPayload(report, range, studentName);
  const userPrompt = `Here is the report as JSON:\n\n${JSON.stringify(payload, null, 2)}\n\nWrite the tutor's notes now.`;

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-5',
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text content in AI response');
      }
      const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Could not find JSON in AI response');
      }
      const parsed = JSON.parse(jsonMatch[0]) as Partial<StudentSummaryNarrative>;
      if (typeof parsed.narrative_en !== 'string' || typeof parsed.narrative_zh !== 'string') {
        throw new Error('Summary response missing narrative fields');
      }
      return {
        narrative_en: parsed.narrative_en.trim(),
        narrative_zh: parsed.narrative_zh.trim(),
      };
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error)) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Failed to write summary');
}
