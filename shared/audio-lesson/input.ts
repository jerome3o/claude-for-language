/**
 * What a "New audio lesson" request may carry (POST /api/audio-lessons, the MCP
 * create_audio_lesson tool, both apps' forms) → a clean input or problems.
 */
import { hasHan } from './compile';
import { AUDIO_LESSON_FORMATS, AUDIO_LESSON_INPUT_LIMITS, type AudioLessonFormat, type AudioLessonInput } from './types';

export interface PickedAudioLessonInput {
  format: AudioLessonFormat;
  input: AudioLessonInput;
  /** What the list shows until Claude names the lesson. */
  title: string;
  problems: string[];
}

function text(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function pickAudioLessonInput(body: unknown): PickedAudioLessonInput {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const problems: string[] = [];
  const L = AUDIO_LESSON_INPUT_LIMITS;
  const format = (AUDIO_LESSON_FORMATS as readonly string[]).includes(b.format as string) ? (b.format as AudioLessonFormat) : null;
  if (!format) problems.push('format must be "dialogue" or "sleep"');
  const description = text(b.description);
  const dialogue = text(b.dialogue);
  const source = text(b.text);
  const input: AudioLessonInput = {};
  if (format === 'dialogue') {
    if (!description && !dialogue) problems.push('Describe the situation to practise (or paste a dialogue)');
    if (description.length > L.description) problems.push(`The description is too long (${L.description} characters at most)`);
    if (dialogue.length > L.dialogue) problems.push(`The dialogue is too long (${L.dialogue} characters at most)`);
    if (description) input.description = description;
    if (dialogue) input.dialogue = dialogue;
  } else if (format === 'sleep') {
    if (!source) problems.push('Paste the Chinese text to learn from');
    else if (!hasHan(source)) problems.push('The text has no Chinese in it');
    else if ([...source].filter((c) => hasHan(c)).length < 20) problems.push('The text is too short — paste at least a paragraph');
    if (source.length > L.text) problems.push(`The text is too long (${L.text.toLocaleString('en')} characters at most)`);
    if (source) input.text = source;
  }
  if (b.target_minutes !== undefined && b.target_minutes !== null) {
    const m = Number(b.target_minutes);
    if (!Number.isFinite(m) || m < L.minMinutes || m > L.maxMinutes) problems.push(`target_minutes must be ${L.minMinutes}–${L.maxMinutes}`);
    else input.target_minutes = Math.round(m);
  }
  const given = text(b.title).slice(0, 120);
  if (given) input.title = given;
  const fallback = format === 'sleep' ? [...source].slice(0, 16).join('') : description.slice(0, 80) || 'Dialogue lesson';
  return { format: format ?? 'dialogue', input, title: given || fallback || 'Audio lesson', problems };
}
